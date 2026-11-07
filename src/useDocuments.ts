import { t } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { cacheRemoteDocument, clearPrivateCache, getLocal, listLocal, removeLocal, setLocal } from './storage';
import { baseName } from './knowledge';
import { readProperties } from './components/PropertiesPanel';
import type { NoteDocument, NoteSummary } from './types';
export type Draft = NoteDocument & {
    dirty: boolean;
    blocked?: boolean;
    isNew?: boolean;
};
export function useDocuments(onSaved: (note: NoteDocument) => void, onError: (error: unknown, note: Draft) => void) {
    const [documents, setDocuments] = useState<Record<string, Draft>>({});
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [offline, setOffline] = useState(!navigator.onLine);
    const ref = useRef<Record<string, Draft>>({});
    const queues = useRef(new Map<string, Promise<boolean>>());
    const callbacks = useRef({ onSaved, onError });
    callbacks.current = { onSaved, onError };
    const offlineRef = useRef(offline);
    offlineRef.current = offline;
    const cacheWarning = useRef(false);
    const put = useCallback((note: Draft) => {
        ref.current = { ...ref.current, [note.path]: note };
        setDocuments(ref.current);
        void setLocal(`doc:${note.path}`, note).catch(() => { if (!cacheWarning.current) {
            cacheWarning.current = true;
            callbacks.current.onError(new Error(t("Could not store the draft in this browser. Keep this tab open until it is saved to the server.")), note);
        } });
    }, []);
    const remove = useCallback((path: string) => { const next = { ...ref.current }; delete next[path]; ref.current = next; setDocuments(next); void removeLocal(`doc:${path}`); }, []);
    const clear = useCallback(async () => { ref.current = {}; setDocuments({}); await clearPrivateCache(); }, []);
    const recover = useCallback(async () => {
        const cached = await listLocal<Draft>('doc:').catch(() => []);
        const dirty = cached.filter((note) => note && typeof note.path === 'string' && typeof note.content === 'string' && note.dirty);
        const next = { ...ref.current };
        for (const note of dirty)
            next[note.path] = { ...note, blocked: false };
        ref.current = next;
        setDocuments(next);
        return dirty.length;
    }, []);
    const load = useCallback(async (path: string) => {
        if (ref.current[path]?.dirty)
            return ref.current[path];
        try {
            const note = await api.note(path);
            const draft = { ...note, dirty: false };
            put(draft);
            return draft;
        }
        catch (error) {
            const cached = ref.current[path] || await getLocal<Draft>(`doc:${path}`);
            if (cached && (!(error as Error & {
                status?: number;
            }).status || !navigator.onLine)) {
                put(cached);
                setOffline(true);
                return cached;
            }
            throw error;
        }
    }, [put]);
    const edit = useCallback((path: string, content: string) => { const current = ref.current[path]; if (current)
        put({ ...current, content, dirty: true, ...(current.blocked && !navigator.onLine ? { blocked: false } : {}) }); }, [put]);
    const create = useCallback(async (path: string, content: string) => {
        try {
            const note = await api.create(path, content);
            put({ ...note, dirty: false });
            callbacks.current.onSaved(note);
            return note;
        }
        catch (error) {
            if ((error as Error & {
                status?: number;
            }).status)
                throw error;
            const note: Draft = { path, content, body: content, kind: path.endsWith('.canvas') ? 'canvas' : path.endsWith('.base') ? 'base' : 'markdown', properties: readProperties(content), title: baseName(path), tags: [], aliases: [], links: [], size: new TextEncoder().encode(content).length, mtime: Date.now(), hash: 'new', isNew: true, dirty: true };
            put(note);
            setOffline(true);
            callbacks.current.onSaved(note);
            return note;
        }
    }, [put]);
    const save = useCallback(async (path: string): Promise<boolean> => {
        const existing = queues.current.get(path);
        if (existing)
            return existing;
        const first = ref.current[path];
        if (!first?.dirty)
            return true;
        if (first.blocked)
            return false;
        if (!navigator.onLine || offlineRef.current) {
            await setLocal(`doc:${path}`, first);
            return true;
        }
        const task = (async () => {
            setSaving((current) => new Set([...current, path]));
            try {
                let draft = ref.current[path];
                while (draft?.dirty && !draft.blocked) {
                    const snapshot = draft;
                    const saved = snapshot.isNew ? await api.create(snapshot.path, snapshot.content) : await api.save(snapshot);
                    const current = ref.current[path];
                    if (!current)
                        return true;
                    put({ ...saved, content: current.content, dirty: current.content !== snapshot.content });
                    callbacks.current.onSaved(saved);
                    draft = ref.current[path];
                }
                return !draft?.blocked;
            }
            catch (error) {
                const current = ref.current[path];
                if (!(error as Error & {
                    status?: number;
                }).status) {
                    setOffline(true);
                    return false;
                }
                if (current) {
                    put({ ...current, blocked: true });
                    if (current.isNew && (error as Error & {
                        status?: number;
                    }).status === 409) {
                        const remote = await api.note(path);
                        callbacks.current.onError(Object.assign(new Error(t("A document already exists at this path.")), { status: 409, data: { current: remote } }), current);
                    }
                    else
                        callbacks.current.onError(error, current);
                }
                return false;
            }
            finally {
                queues.current.delete(path);
                setSaving((current) => { const next = new Set(current); next.delete(path); return next; });
            }
        })();
        queues.current.set(path, task);
        return task;
    }, [put]);
    useEffect(() => {
        if (offline)
            return;
        const dirty = Object.values(documents).filter((note) => note.dirty && !note.blocked);
        if (!dirty.length)
            return;
        const timer = window.setTimeout(() => { for (const note of dirty)
            void save(note.path); }, 800);
        return () => clearTimeout(timer);
    }, [documents, save, offline]);
    useEffect(() => {
        function unload(event: BeforeUnloadEvent) { if (Object.values(ref.current).some((note) => note.dirty)) {
            event.preventDefault();
            event.returnValue = '';
        } }
        function flush() { if (document.visibilityState === 'hidden')
            for (const note of Object.values(ref.current))
                if (note.dirty)
                    void save(note.path); }
        const online = () => { offlineRef.current = false; setOffline(false); for (const note of Object.values(ref.current))
            if (note.dirty && !note.blocked)
                void save(note.path); };
        const offline = () => { offlineRef.current = true; setOffline(true); };
        window.addEventListener('beforeunload', unload);
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        document.addEventListener('visibilitychange', flush);
        return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', flush); };
    }, [save]);
    const reconcile = useCallback(async (files: NoteSummary[]) => {
        if (offlineRef.current)
            return;
        for (const file of files) {
            const current = ref.current[file.path];
            if (current && !current.dirty && current.mtime !== file.mtime && /\.(md|canvas|base)$/i.test(file.path)) {
                const remote = await api.note(file.path);
                if (!ref.current[file.path]?.dirty)
                    put({ ...remote, dirty: false });
            }
        }
    }, [put]);
    const prefetch = useCallback(async (files: NoteSummary[]) => {
        const pending = files.filter((file) => /\.(md|canvas|base)$/i.test(file.path));
        let cursor = 0;
        await Promise.all(Array.from({ length: 3 }, async () => { while (cursor < pending.length && navigator.onLine) {
            const file = pending[cursor++];
            try {
                const existing = await getLocal<Draft>(`doc:${file.path}`);
                if (existing?.dirty || existing?.mtime === file.mtime || ref.current[file.path]?.dirty)
                    continue;
                const remote = await api.note(file.path);
                if (!ref.current[file.path]?.dirty)
                    await cacheRemoteDocument({ ...remote, dirty: false });
            }
            catch { /* Opened documents still remain available offline. */ }
        } }));
    }, []);
    const connected = useCallback(() => { if (offlineRef.current) {
        offlineRef.current = false;
        setOffline(false);
    } }, []);
    useEffect(() => {
        if (!offline)
            return;
        let checking = false;
        const timer = window.setInterval(async () => {
            if (!navigator.onLine || checking)
                return;
            checking = true;
            try {
                const session = await api.session();
                if (session.authenticated)
                    connected();
                else
                    window.dispatchEvent(new Event('notesprig:auth-required'));
            }
            catch { /* Retain local drafts and retry after network recovery. */ }
            finally {
                checking = false;
            }
        }, 1500);
        return () => clearInterval(timer);
    }, [offline, connected]);
    return { documents, ref, saving, offline, load, edit, save, put, remove, clear, recover, create, reconcile, prefetch, connected };
}
