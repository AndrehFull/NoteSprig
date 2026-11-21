import { scopedKey, currentContext } from './workspace';
import type { ReferenceContext } from '../shared/board-schema.mjs';
import { sameContext, sameWorkspace, boardScope } from '../shared/board-schema.mjs';
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
    const generation = useRef(0);
    const activeScope = useRef<string|undefined>(undefined);
    const loads = useRef(new Map<string,number>());
    const matchesWorkspace = (expected:ReferenceContext, captured = generation.current) => {
        try {return captured===generation.current&&sameWorkspace(expected,currentContext())&&(!activeScope.current||activeScope.current===boardScope(expected));}catch{return false;}
    };
    const assertWorkspace = (expected:ReferenceContext, captured = generation.current) => {
        if (!matchesWorkspace(expected,captured)) throw new Error('The workspace changed. Preserve drafts before reopening it.');
    };
    const documentKey = (note:Pick<Draft,'path'|'workspaceContext'>) => `workspace:${boardScope(note.workspaceContext||currentContext())}:doc:${note.path}`;
    const put = useCallback((value: Draft) => {
        const note = { ...value, workspaceContext:value.workspaceContext||currentContext() };
        assertWorkspace(note.workspaceContext);
        ref.current = { ...ref.current, [note.path]: note };
        setDocuments(ref.current);
        void setLocal(documentKey(note), note).catch(() => { if (!cacheWarning.current) {
            cacheWarning.current = true;
            callbacks.current.onError(new Error(t("Could not store the draft in this browser. Keep this tab open until it is saved to the server.")), note);
        } });
    }, []);
    const remove = useCallback((path: string) => { const note=ref.current[path];const next = { ...ref.current }; delete next[path]; ref.current = next; setDocuments(next); void removeLocal(note?documentKey(note):scopedKey(`doc:${path}`)); }, []);
    const clear = useCallback(async () => { generation.current++;ref.current = {}; setDocuments({}); await clearPrivateCache(); }, []);
    const activateWorkspace = useCallback(() => {
        const next=boardScope(currentContext());if(activeScope.current===next)return;
        generation.current++;activeScope.current=next;ref.current={};queues.current=new Map();loads.current.clear();cacheWarning.current=false;setDocuments({});setSaving(new Set());
    }, []);
    const recover = useCallback(async () => {
        const context=currentContext(),captured=generation.current;
        const cached = await listLocal<Draft>(scopedKey('doc:'));assertWorkspace(context,captured);
        if(cached.some(note=>note?.dirty&&(typeof note.path!=='string'||typeof note.content!=='string'||!note.workspaceContext||!sameWorkspace(note.workspaceContext,context))))throw new Error('A stored draft requires explicit workspace recovery.');
        const dirty = cached.filter((note) => note && typeof note.path === 'string' && typeof note.content === 'string' && note.dirty);
        const next = { ...ref.current };
        for (const note of dirty)
            next[note.path] = { ...note, blocked: false };
        ref.current = next;
        setDocuments(next);
        return dirty.length;
    }, []);
    const load = useCallback(async (path: string, referenceContext?: ReferenceContext) => {
        const workspace=currentContext(),captured=generation.current;
        const ticket=(loads.current.get(path)||0)+1;loads.current.set(path,ticket);
        if(referenceContext&&!sameContext(referenceContext,workspace))throw new Error(t('Reference review required'));
        if (ref.current[path]?.dirty) {
            if(referenceContext&&!sameContext(ref.current[path].referenceContext,referenceContext))throw new Error(t('Reference review required'));
            return ref.current[path];
        }
        try {
            const note = await api.note(path,referenceContext);
            assertWorkspace(workspace,captured);
            const draft = { ...note, workspaceContext:workspace, ...(referenceContext ? { referenceContext } : {}), dirty: false };
            if(loads.current.get(path)!==ticket)return ref.current[path]||draft;
            put(draft);
            return draft;
        }
        catch (error) {
            assertWorkspace(workspace,captured);
            const cached = ref.current[path] || await getLocal<Draft>(scopedKey(`doc:${path}`));
            assertWorkspace(workspace,captured);
            if(referenceContext&&(!(cached?.referenceContext&&sameContext(cached.referenceContext,referenceContext))||(error as {status?:number}).status))throw error;
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
        const workspace=currentContext(),captured=generation.current;
        try {
            const note = await api.create(path, content);
            assertWorkspace(workspace,captured);put({ ...note, workspaceContext:workspace, dirty: false });
            callbacks.current.onSaved(note);
            return note;
        }
        catch (error) {
            assertWorkspace(workspace,captured);
            if ((error as Error & {
                status?: number;
            }).status)
                throw error;
            const note: Draft = { path, content, body: content, kind: path.endsWith('.canvas') ? 'canvas' : path.endsWith('.base') ? 'base' : 'markdown', properties: readProperties(content), title: baseName(path), tags: [], aliases: [], links: [], size: new TextEncoder().encode(content).length, mtime: Date.now(), hash: 'new', isNew: true, dirty: true,workspaceContext:workspace };
            put(note);
            setOffline(true);
            callbacks.current.onSaved(note);
            return note;
        }
    }, [put]);
    const save = useCallback(async (path: string): Promise<boolean> => {
        const queue=queues.current;
        const existing = queue.get(path);
        if (existing)
            return existing;
        const first = ref.current[path];
        if (!first?.dirty)
            return true;
        if (first.blocked)
            return false;
        const captured=generation.current,workspace=first.workspaceContext||currentContext();
        try {assertWorkspace(workspace,captured);}catch{return false;}
        if (!navigator.onLine || offlineRef.current) {
            await setLocal(documentKey(first), first);
            return true;
        }
        const task = (async () => {
            setSaving((current) => new Set([...current, path]));
            try {
                let draft = ref.current[path];
                while (draft?.dirty && !draft.blocked) {
                    const snapshot = draft;
                    assertWorkspace(workspace,captured);
                    const saved = snapshot.isNew ? await api.create(snapshot.path, snapshot.content, snapshot.workspaceContext) : await api.save(snapshot);
                    assertWorkspace(workspace,captured);
                    const current = ref.current[path];
                    if (!current)
                        return true;
                    put({ ...saved, workspaceContext:snapshot.workspaceContext, ...(snapshot.referenceContext?{referenceContext:snapshot.referenceContext}:{}), content: current.content, dirty: current.content !== snapshot.content });
                    callbacks.current.onSaved(saved);
                    draft = ref.current[path];
                }
                return !draft?.blocked;
            }
            catch (error) {
                if(!matchesWorkspace(workspace,captured))return false;
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
                queue.delete(path);
                if(matchesWorkspace(workspace,captured))setSaving((current) => { const next = new Set(current); next.delete(path); return next; });
            }
        })();
        queue.set(path, task);
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
        const workspace=currentContext(),captured=generation.current;
        if (offlineRef.current)
            return;
        // Reference-bound notes cannot rely on a timestamp to detect an
        // occupied-path reuse. Revalidate them on every file-index refresh.
        const guarded = new Set(Object.values(ref.current).filter((note) => !note.dirty && note.referenceContext).map((note) => note.path));
        for (const path of guarded) {
            const current = ref.current[path];
            if (!current?.referenceContext)
                continue;
            try {
                const remote = await api.note(path, current.referenceContext);
                assertWorkspace(workspace,captured);
                if (ref.current[path] === current && !current.dirty)
                    put({ ...remote, workspaceContext:workspace, referenceContext:current.referenceContext, dirty:false });
            }
            catch (error) {
                if (current.referenceContext && (error as {status?:number}).status === 409) {
                    callbacks.current.onError(error,current);
                    continue;
                }
                throw error;
            }
        }
        for (const file of files) {
            const current = ref.current[file.path];
            if (guarded.has(file.path))
                continue;
            if (current && !current.dirty && current.mtime !== file.mtime && /\.(md|canvas|base)$/i.test(file.path)) {
                try {
                    const remote = await api.note(file.path,current.referenceContext);assertWorkspace(workspace,captured);
                    if (ref.current[file.path]===current&&!current.dirty)put({ ...remote, workspaceContext:workspace, ...(current.referenceContext?{referenceContext:current.referenceContext}:{}), dirty: false });
                }catch(error){if(current.referenceContext&&(error as {status?:number}).status===409){callbacks.current.onError(error,current);continue;}throw error;}
            }
        }
    }, [put]);
    const prefetch = useCallback(async (files: NoteSummary[]) => {
        const workspace=currentContext(),captured=generation.current;
        const pending = files.filter((file) => /\.(md|canvas|base)$/i.test(file.path));
        let cursor = 0;
        await Promise.all(Array.from({ length: 3 }, async () => { while (cursor < pending.length && navigator.onLine) {
            const file = pending[cursor++];
            try {
                const existing = await getLocal<Draft>(scopedKey(`doc:${file.path}`));
                if (existing?.dirty || existing?.mtime === file.mtime || ref.current[file.path]?.dirty)
                    continue;
                const referenceContext=ref.current[file.path]?.referenceContext||existing?.referenceContext;
                const remote = await api.note(file.path,referenceContext);
                assertWorkspace(workspace,captured);
                if (!ref.current[file.path]?.dirty)
                    await cacheRemoteDocument({ ...remote, workspaceContext:workspace, ...(referenceContext?{referenceContext}:{}), dirty: false }, `workspace:${boardScope(workspace)}:doc:${remote.path}`);
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
    return { documents, ref, saving, offline, load, edit, save, put, remove, clear, recover, create, reconcile, prefetch, connected, activateWorkspace };
}
