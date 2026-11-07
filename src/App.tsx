import { t, useLanguage, translateMessage } from './i18n';
import { LanguageSelector } from './components/LanguageSelector';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type SetStateAction, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, CalendarDays, Check, ChevronDown, ChevronRight, Command, FilePlus2, Files, FileText, FolderInput, FolderOpen, Hash, Link2, ListTree, LockKeyhole, LogOut, Pin, Columns2, Rows2, WifiOff, Wifi, History, Table2, LayoutDashboard, Upload, FolderPlus, Network, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Plus, Search, Settings2, Tag, Trash2, X, } from 'lucide-react';
import { applyTemplate, formatDate, defaultVaultSettings, type VaultSettings } from './templates';
import { TemplatesModal } from './components/TemplatesModal';
import { getLocal, setLocal } from './storage';
import { api } from './api';
import { BRAND } from './brand';
import { baseName, parentPath, resolveTargets, type KnowledgeNode } from './knowledge';
import { normalizeTarget } from './markdown';
import { useDocuments, type Draft } from './useDocuments';
import { ComposerModal } from './components/ComposerModal';
import { BasesView } from './components/BasesView';
import { readProperties as readPropertiesForBase, writeProperties } from './components/PropertiesPanel';
import { AudioRecorder, SlidesView, WebView } from './components/CoreExtras';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RichPreview } from './components/RichPreview';
import { resolveAsset } from './paths';
const MarkdownEditor = lazy(() => import('./components/MarkdownEditor'));
import { CanvasView } from './components/CanvasView';
import { AttachmentView, HistoryModal, TrashModal } from './components/Recovery';
import { FileTree } from './components/FileTree';
import { GraphView } from './components/GraphView';
import { CommandPicker, type Choice } from './components/CommandPicker';
import { readSidebarWidth, SidebarResizer } from './components/SidebarResizer';
import { CreateNoteModal, Login, Modal, PropertiesModal, TextActionModal } from './components/NoteTools';
import type { NoteDocument, NoteSummary, SearchItem } from './types';
type Tab = {
    id: string;
    kind: 'note' | 'canvas' | 'base' | 'attachment' | 'web' | 'graph' | 'local' | 'empty';
    path?: string;
    pinned?: boolean;
};
type ModalState = {
    kind: 'create';
    title: string;
} | {
    kind: 'rename' | 'properties' | 'delete';
    note: Draft;
} | {
    kind: 'ambiguous';
    title: string;
    candidates: NoteSummary[];
} | {
    kind: 'conflict';
    note: Draft;
    remote: NoteDocument;
} | {
    kind: 'commands' | 'switcher' | 'settings' | 'trash';
} | {
    kind: 'canvas-create' | 'base-create' | 'folder-create';
    initial?: string;
} | {
    kind: 'history';
    note: Draft;
} | {
    kind: 'file-rename' | 'file-delete';
    path: string;
    folder: boolean;
} | {
    kind: 'templates';
} | {
    kind: 'slides';
    note: Draft;
} | {
    kind: 'web-create';
} | {
    kind: 'merge';
    note: Draft;
} | {
    kind: 'extract';
    note: Draft;
    selection: {
        from: number;
        to: number;
        text: string;
    };
} | {
    kind: 'import';
    files: File[];
} | null;
const globalGraph: Tab = { id: 'graph', kind: 'graph' };
function storedList(key: string): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
    }
    catch {
        return [];
    }
}
function readWorkspace(): {
    tabs: Tab[];
    selected: string;
    secondary: string | null;
    split: 'right' | 'down';
    modes: Record<string, 'live' | 'source' | 'read'>;
} {
    try {
        const data = JSON.parse(localStorage.getItem('notesprig.workspace') || '{}');
        const tabs = Array.isArray(data.tabs) ? data.tabs.filter((tab: Tab) => tab && typeof tab.id === 'string' && ['note', 'canvas', 'base', 'attachment', 'web', 'graph', 'local', 'empty'].includes(tab.kind)) : [globalGraph];
        return { tabs: tabs.length ? tabs : [globalGraph], selected: typeof data.selected === 'string' ? data.selected : 'graph', secondary: typeof data.secondary === 'string' ? data.secondary : null, split: data.split === 'down' ? 'down' : 'right', modes: data.modes || {} };
    }
    catch {
        return { tabs: [globalGraph], selected: 'graph', secondary: null, split: 'right', modes: {} };
    }
}
function App() {
    const language = useLanguage();
    useEffect(() => {
        const send = () => navigator.serviceWorker?.controller?.postMessage({ type: 'SET_LANGUAGE', language });
        send(); navigator.serviceWorker?.addEventListener('controllerchange', send);
        return () => navigator.serviceWorker?.removeEventListener('controllerchange', send);
    }, [language]);
    const [authenticated, setAuthenticated] = useState<boolean | null>(null);
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [files, setFiles] = useState<NoteSummary[]>([]);
    const uploadInput = useRef<HTMLInputElement>(null);
    const zipInput = useRef<HTMLInputElement>(null);
    const initialWorkspace = useRef(readWorkspace());
    const [tabs, setTabs] = useState<Tab[]>(initialWorkspace.current.tabs);
    const [selectedTab, setSelectedTab] = useState(initialWorkspace.current.selected);
    const [secondaryTab, setSecondaryTab] = useState<string | null>(initialWorkspace.current.secondary);
    const [splitDirection, setSplitDirection] = useState<'right' | 'down'>(initialWorkspace.current.split);
    const [focusedGroup, setFocusedGroup] = useState<'primary' | 'secondary'>('primary');
    const focusedRef = useRef<'primary' | 'secondary'>('primary');
    const [viewModes, setViewModes] = useState<Record<string, 'live' | 'source' | 'read'>>(initialWorkspace.current.modes);
    const [contextPath, setContextPath] = useState('');
    const [reference, setReference] = useState<{
        path: string;
        fragment: string;
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [recordingBusy, setRecordingBusy] = useState(false);
    const [leftOpen, setLeftOpen] = useState(true);
    const [rightOpen, setRightOpen] = useState(() => !window.matchMedia('(max-width: 1000px)').matches);
    const [leftTab, setLeftTab] = useState<'files' | 'search' | 'bookmarks'>('files');
    const [rightTab, setRightTab] = useState<'links' | 'outline' | 'tags'>('links');
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
    const [searchBusy, setSearchBusy] = useState(false);
    const [modal, setModal] = useState<ModalState>(null);
    const [notice, setNotice] = useState('');
    const [bookmarks, setBookmarks] = useState(() => storedList('notesprig.bookmarks'));
    const [history, setHistory] = useState<{
        paths: string[];
        index: number;
    }>({ paths: [], index: -1 });
    const [theme, setTheme] = useState(() => localStorage.getItem('notesprig.theme') || 'dark');
    const [readableWidth, setReadableWidth] = useState(() => localStorage.getItem('notesprig.readableWidth') !== 'false');
    const [leftWidth, setLeftWidth] = useState(() => readSidebarWidth('notesprig.leftWidth', 247));
    const [rightWidth, setRightWidth] = useState(() => readSidebarWidth('notesprig.rightWidth', 266));
    const [vaultSettings, setVaultSettings] = useState<VaultSettings>(defaultVaultSettings);
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState('');
    const importInput = useRef<HTMLInputElement>(null);
    const init = useRef(false);
    const navigation = useRef(0);
    const refreshNotes = useCallback(async () => {
        try {
            const [list, entries] = await Promise.all([api.notes(), api.files()]);
            const pending = Object.values(docs.ref.current).filter((note) => note.isNew);
            const combined = [...list, ...pending.filter((draft) => !list.some((note) => note.path === draft.path))];
            setNotes((current) => JSON.stringify(current) === JSON.stringify(combined) ? current : combined);
            setFiles((current) => JSON.stringify(current) === JSON.stringify(entries) ? current : entries);
            void setLocal('notes', combined);
            void setLocal('files', entries);
            docs.connected();
            void docs.reconcile(entries).catch(() => { });
            return combined;
        }
        catch (error) {
            if (!(error as Error & {
                status?: number;
            }).status) {
                const list = await getLocal<NoteSummary[]>('notes');
                const entries = await getLocal<NoteSummary[]>('files');
                if (list) {
                    const pending = Object.values(docs.ref.current).filter((note) => note.isNew);
                    const combined = [...list, ...pending.filter((note) => note.kind !== 'canvas' && !list.some((file) => file.path === note.path))];
                    setNotes(combined);
                    if (entries)
                        setFiles([...entries, ...pending.filter((note) => !entries.some((file) => file.path === note.path))]);
                    return combined;
                }
            }
            throw error;
        }
    }, []);
    const treeFiles = useMemo(() => [...notes, ...files.filter((file) => file.kind !== 'markdown')], [notes, files]);
    const onSaved = useCallback((note: NoteDocument) => {
        const { path, title, aliases, tags, links, mtime, size, propertyError, kind } = note;
        setFiles((current) => { const summary = { path, title, aliases, tags, links, mtime, size, propertyError, kind }; const next = current.some((item) => item.path === path) ? current.map((item) => item.path === path ? summary : item) : [...current, summary]; void setLocal('files', next); return next; });
        if (kind === 'markdown' || !kind)
            setNotes((current) => { const summary = { path, title, aliases, tags, links, mtime, size, propertyError, kind }; const next = current.some((item) => item.path === path) ? current.map((item) => item.path === path ? summary : item) : [...current, summary]; void setLocal('notes', next); return next; });
    }, []);
    const onSaveError = useCallback((error: unknown, note: Draft) => {
        if ((error as Error & {
            status?: number;
        }).status === 401) {
            setAuthenticated(false);
            return;
        }
        const conflict = error as Error & {
            status?: number;
            data?: {
                current?: NoteDocument;
            };
        };
        if (conflict.status === 409 && conflict.data?.current)
            setModal({ kind: 'conflict', note, remote: conflict.data.current });
        else
            setNotice(error instanceof Error ? error.message : t("Could not save the note."));
    }, []);
    const docs = useDocuments(onSaved, onSaveError);
    const tab = tabs.find((item) => item.id === (focusedGroup === 'secondary' && secondaryTab ? secondaryTab : selectedTab)) || globalGraph;
    function setMode(action: SetStateAction<'live' | 'source' | 'read'>) { const tabId = focusedRef.current === 'secondary' && secondaryTab ? secondaryTab : selectedTab; const id = `${focusedRef.current}:${tabId}`; setViewModes((current) => ({ ...current, [id]: typeof action === 'function' ? action(current[id] || current[tabId] || 'live') : action })); }
    function focusGroup(group: 'primary' | 'secondary') { focusedRef.current = group; setFocusedGroup(group); }
    function selectTab(id: string) {
        if (focusedRef.current === 'secondary' && secondaryTab)
            setSecondaryTab(id);
        else
            setSelectedTab(id);
    }
    const active = (tab.kind === 'note' || tab.kind === 'canvas' || tab.kind === 'base') && tab.path ? docs.documents[tab.path] : null;
    const context = active && active.kind !== 'markdown' ? docs.documents[contextPath] : active || docs.documents[contextPath];
    const isGraph = tab.kind === 'graph' || tab.kind === 'local';
    function showTab(next: Tab) {
        navigation.current++;
        setLoading(false);
        if (active)
            void docs.save(active.path);
        setTabs((current) => current.some((item) => item.id === next.id) ? current : [...current, next]);
        selectTab(next.id);
    }
    async function openNote(path: string, record = true) {
        if (active && active.path !== path)
            void docs.save(active.path);
        const ticket = ++navigation.current;
        setLoading(true);
        try {
            const kind = /\.canvas$/i.test(path) ? 'canvas' : /\.base$/i.test(path) ? 'base' : /\.md$/i.test(path) ? 'note' : 'attachment';
            if (kind !== 'attachment')
                await docs.load(path);
            if (ticket !== navigation.current)
                return;
            const next: Tab = { id: `${kind}:${path}`, kind, path };
            setTabs((current) => current.some((item) => item.id === next.id) ? current : [...current, next]);
            selectTab(next.id);
            if (kind === 'note' && /\.md$/i.test(path)) {
                setContextPath(path);
                localStorage.setItem('notesprig.lastNote', path);
            }
            if (record)
                setHistory((current) => current.paths[current.index] === path ? current : { paths: [...current.paths.slice(0, current.index + 1), path], index: current.index + 1 });
            if (window.matchMedia('(max-width: 700px)').matches)
                setLeftOpen(false);
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : t("Could not open the note."));
        }
        finally {
            if (ticket === navigation.current)
                setLoading(false);
        }
    }
    async function closeTab(closing: Tab) {
        if (closing.pinned) {
            setNotice(t("Unpin the tab before closing it."));
            return;
        }
        if (closing.path && !(await docs.save(closing.path)))
            return;
        if (secondaryTab === closing.id) {
            setSecondaryTab(null);
            focusGroup('primary');
        }
        const remaining = tabs.filter((item) => item.id !== closing.id);
        setTabs(remaining.length ? remaining : [{ id: 'empty', kind: 'empty' }]);
        if (selectedTab === closing.id)
            setSelectedTab(remaining.at(-1)?.id || 'empty');
    }
    function showGraph(local = false) {
        const path = active?.path || contextPath;
        if (local && !path) {
            setNotice(t("Open a note to see its local graph."));
            return;
        }
        showTab(local ? { id: `local:${path}`, kind: 'local', path } : globalGraph);
    }
    async function beginApp() {
        setAuthenticated(true);
        try {
            sessionStorage.setItem('notesprig.unlocked', 'true');
            const configuration = await api.settings().catch(() => getLocal<VaultSettings>('settings'));
            if (configuration) {
                setVaultSettings({ ...defaultVaultSettings, ...configuration } as VaultSettings);
                void setLocal('settings', configuration);
            }
            const recovered = await docs.recover();
            if (recovered)
                setNotice(t("{v0} draft(s) recovered from this browser.", { v0: recovered }));
            const list = await refreshNotes();
            await Promise.all(tabs.filter((tab) => tab.path && ['note', 'canvas', 'base'].includes(tab.kind)).map((tab) => docs.load(tab.path!).catch(() => { })));
            void api.files().then((entries) => docs.prefetch(entries)).catch(() => { });
            const last = localStorage.getItem('notesprig.lastNote');
            if (last && list.some((note) => note.path === last)) {
                await docs.load(last);
                setContextPath(last);
            }
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : t("Could not load the vault."));
        }
    }
    useEffect(() => {
        if (init.current)
            return;
        init.current = true;
        api.session().then((session) => {
            if (session.authenticated)
                void beginApp();
            else
                setAuthenticated(false);
        }).catch(() => {
            if (sessionStorage.getItem('notesprig.unlocked') === 'true')
                void beginApp();
            else
                setAuthenticated(false);
        });
    }, []);
    useEffect(() => { const handler = () => setAuthenticated(false); window.addEventListener('notesprig:auth-required', handler); return () => window.removeEventListener('notesprig:auth-required', handler); }, []);
    useEffect(() => {
        if (authenticated)
            localStorage.setItem('notesprig.workspace', JSON.stringify({ tabs, selected: selectedTab, secondary: secondaryTab, split: splitDirection, modes: viewModes }));
    }, [tabs, selectedTab, secondaryTab, splitDirection, viewModes, authenticated]);
    useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('notesprig.theme', theme); }, [theme]);
    useEffect(() => { localStorage.setItem('notesprig.readableWidth', String(readableWidth)); }, [readableWidth]);
    useEffect(() => { localStorage.setItem('notesprig.bookmarks', JSON.stringify(bookmarks)); }, [bookmarks]);
    useEffect(() => { localStorage.setItem('notesprig.leftWidth', String(leftWidth)); localStorage.setItem('notesprig.rightWidth', String(rightWidth)); }, [leftWidth, rightWidth]);
    useEffect(() => {
        if (!authenticated)
            return;
        const refresh = () => { void refreshNotes().catch(() => { }); };
        window.addEventListener('focus', refresh);
        const timer = window.setInterval(refresh, 15000);
        return () => { window.removeEventListener('focus', refresh); clearInterval(timer); };
    }, [authenticated, refreshNotes]);
    useEffect(() => {
        if (!search.trim() || leftTab !== 'search') {
            setSearchResults([]);
            setSearchBusy(false);
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setSearchBusy(true);
            try {
                const result = await api.search(search.trim());
                if (!cancelled)
                    setSearchResults(result.items);
            }
            catch (error) {
                if (!cancelled)
                    setNotice(error instanceof Error ? error.message : t("Search failed."));
            }
            finally {
                if (!cancelled)
                    setSearchBusy(false);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [leftTab, search]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey))
                return;
            const key = event.key.toLowerCase();
            if (modal)
                return;
            if (key === 'g') {
                event.preventDefault();
                showGraph();
            }
            else if (key === 'p') {
                event.preventDefault();
                setModal({ kind: 'commands' });
            }
            else if (key === 'o') {
                event.preventDefault();
                setModal({ kind: 'switcher' });
            }
            else if (key === 'n') {
                event.preventDefault();
                setModal({ kind: 'create', title: '' });
            }
            else if (key === 's') {
                event.preventDefault();
                if (active) {
                    docs.put({ ...active, blocked: false });
                    void docs.save(active.path);
                }
            }
            else if (event.shiftKey && key === 'f') {
                event.preventDefault();
                showSearch();
            }
            else if (key === 'e') {
                event.preventDefault();
                setMode((value) => value === 'read' ? 'live' : 'read');
            }
            else if (key === 't') {
                event.preventDefault();
                showTab({ id: `empty:${Date.now()}`, kind: 'empty' });
            }
            else if (key === 'w') {
                event.preventDefault();
                void closeTab(tab);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    });
    function showSearch(value?: string) {
        setLeftOpen(true);
        setLeftTab('search');
        if (value !== undefined)
            setSearch(value);
        window.setTimeout(() => document.querySelector<HTMLInputElement>('.search-input')?.focus(), 30);
    }
    async function createNote(value: string) {
        const clean = value.trim().replaceAll('\\', '/').replace(/\.md$/i, '');
        if (!clean || clean.split('/').some((segment) => !segment.trim() || segment.startsWith('.') || /[<>:"|?*\u0000-\u001f]/.test(segment)))
            throw new Error(t("Enter a valid name or path."));
        const created = await docs.create(`${clean}.md`, `# ${baseName(clean)}\n\n`);
        await refreshNotes();
        setModal(null);
        await openNote(created.path);
        setMode('live');
    }
    async function saveContent(content: string) {
        if (modal?.kind !== 'properties')
            return;
        const path = modal.note.path;
        docs.edit(path, content);
        if (await docs.save(path))
            setModal(null);
    }
    async function renameNote(value: string) {
        if (modal?.kind !== 'rename')
            return;
        const path = `${value.trim().replace(/\.md$/i, '')}.md`;
        await moveFile(modal.note.path, path);
        setModal(null);
        await openNote(path);
    }
    async function deleteNote(note: Draft) {
        try {
            if (!(await docs.save(note.path)))
                return;
            await api.trash(note.path);
            docs.remove(note.path);
            setTabs((current) => { const remaining = current.filter((item) => item.path !== note.path); return remaining.some((item) => item.id === 'graph') ? remaining : [globalGraph, ...remaining]; });
            setSelectedTab('graph');
            setContextPath('');
            setModal(null);
            await refreshNotes();
            setNotice(t("Note moved to trash."));
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : t("Could not delete the note."));
        }
    }
    async function openLink(raw: string, origin = active?.path || '', kind: 'wiki' | 'markdown' = 'wiki') {
        if (/\.(canvas|png|jpe?g|gif|svg|webp|avif|pdf|mp3|wav|ogg|m4a|mp4|webm|txt|csv|json)(?:#|$)/i.test(raw)) {
            await openNote(resolveAsset(raw, origin, treeFiles.map((file) => file.path)));
            return;
        }
        const candidates = resolveTargets(raw, origin, notes, kind);
        if (candidates.length === 1) {
            await openNote(candidates[0].path);
            if (raw.includes('#')) {
                setReference({ path: candidates[0].path, fragment: raw.split('#').slice(1).join('#') });
                const id = `note:${candidates[0].path}`;
                setViewModes((current) => ({ ...current, [`${focusedRef.current}:${id}`]: 'read' }));
            }
        }
        else if (candidates.length > 1)
            setModal({ kind: 'ambiguous', title: raw, candidates });
        else
            setModal({ kind: 'create', title: normalizeTarget(raw) });
    }
    function openGraphNode(node: KnowledgeNode) {
        if (node.kind === 'tag') {
            showSearch(node.label);
            return;
        }
        if (node.path)
            void openNote(node.path);
        else
            void openLink(node.target || node.label, node.origin);
    }
    async function handlePreviewClick(event: ReactMouseEvent<HTMLElement>) {
        const anchor = (event.target as HTMLElement).closest('a');
        if (!anchor)
            return;
        const href = anchor.getAttribute('href') || '';
        if (href.startsWith('#ob-file=')) {
            event.preventDefault();
            await openNote(decodeURIComponent(href.slice(9)));
        }
        else if (href.startsWith('#ob-note=')) {
            event.preventDefault();
            await openLink(decodeURIComponent(href.slice(9)));
        }
        else if (/\.md(?:#.*)?$/i.test(href) && !/^[a-z]+:/i.test(href)) {
            event.preventDefault();
            await openLink(href, active?.path, 'markdown');
        }
        else if (href.startsWith('#')) {
            event.preventDefault();
            setReference({ path: active?.path || '', fragment: href.slice(1) });
        }
        else if (/^https?:/i.test(href)) {
            event.preventDefault();
            window.open(href, '_blank', 'noopener,noreferrer');
        }
    }
    async function dailyNote() {
        const now = new Date();
        const date = formatDate(now, vaultSettings.dailyFormat);
        const path = `${vaultSettings.dailyFolder ? `${vaultSettings.dailyFolder}/` : ''}${date}.md`;
        try {
            if (!treeFiles.some((file) => file.path === path)) {
                const template = vaultSettings.dailyTemplate ? (await docs.load(vaultSettings.dailyTemplate)).content : '# {{title}}\n\n';
                const note = await docs.create(path, applyTemplate(template, baseName(path), now));
                docs.put({ ...note, ...((note as Draft).isNew ? { isNew: true, dirty: true } : { dirty: false }) });
                await refreshNotes();
            }
            await openNote(path);
        }
        catch (error) {
            setNotice((error as Error).message);
        }
    }
    async function openComposer(path = active?.path) {
        if (!path || !/\.md$/i.test(path)) {
            setNotice(t("Open a Markdown note to merge."));
            return;
        }
        if (docs.offline) {
            setNotice(t("Reconnect to merge notes."));
            return;
        }
        for (const document of Object.values(docs.ref.current))
            if (document.dirty && (!(await docs.save(document.path)) || docs.ref.current[document.path]?.dirty))
                return;
        setModal({ kind: 'merge', note: await docs.load(path) });
    }
    async function openExtraction() {
        if (!active || !/\.md$/i.test(active.path)) {
            setNotice(t("Open a Markdown note to extract text."));
            return;
        }
        if (docs.offline) {
            setNotice(t("Reconnect to extract an excerpt."));
            return;
        }
        const selection = (await import('./components/MarkdownEditor')).getEditorSelection(active.path);
        if (!selection) {
            setNotice(t("Select an excerpt in the editor first."));
            return;
        }
        if (!(await docs.save(active.path)))
            return;
        setModal({ kind: 'extract', note: docs.ref.current[active.path], selection });
    }
    async function insertTemplate(path: string) {
        if (!active || !/\.md$/i.test(active.path))
            throw new Error(t("Open a Markdown note before inserting a template."));
        const template = await docs.load(path);
        const text = applyTemplate(template.content, baseName(active.path));
        const editor = await import('./components/MarkdownEditor');
        if (!editor.insertIntoEditor(active.path, text))
            docs.edit(active.path, `${docs.ref.current[active.path].content}\n${text}`);
        setModal(null);
    }
    async function moveFile(from: string, to: string) {
        if (docs.offline)
            throw new Error(t("Reconnect to reorganize vault files."));
        for (const document of Object.values(docs.ref.current))
            if (document.dirty && (!(await docs.save(document.path)) || docs.ref.current[document.path]?.dirty))
                throw new Error(t("Resolve pending changes before moving files."));
        const result = await api.rename(from, to, true);
        if (from === result.path)
            return;
        const mapping = result.moved || { [from]: to };
        const mapPath = (path: string) => mapping[path] || path;
        const mapTab = (tab: Tab): Tab => tab.path && mapping[tab.path] ? { ...tab, path: mapPath(tab.path), id: `${tab.kind === 'local' ? 'local' : tab.kind}:${mapPath(tab.path)}` } : tab;
        const tabIds = Object.fromEntries(tabs.map((tab) => [tab.id, mapTab(tab).id]));
        for (const path of [...Object.keys(mapping), ...result.updated])
            docs.remove(path);
        setTabs((current) => current.map(mapTab));
        setSelectedTab((id) => tabIds[id] || id);
        setSecondaryTab((id) => id ? tabIds[id] || id : null);
        setContextPath((path) => mapPath(path));
        setBookmarks((current) => current.map(mapPath));
        setHistory((current) => ({ ...current, paths: current.paths.map(mapPath) }));
        await refreshNotes();
        await Promise.all(tabs.filter((tab) => tab.path && (mapping[tab.path] || result.updated.includes(tab.path)) && (tab.kind === 'note' || tab.kind === 'canvas' || tab.kind === 'base')).map((tab) => docs.load(mapPath(tab.path!))));
        setNotice(t("File moved. References updated in {v0} document(s).", { v0: result.updated.length }));
    }
    function fileAction(action: string, path: string, folder: boolean) {
        if (action === 'new') {
            setModal({ kind: 'create', title: `${path}/` });
            return;
        }
        if (action === 'base') {
            setModal({ kind: 'base-create', initial: t("{v0}/Untitled", { v0: path }) });
            return;
        }
        if (action === 'canvas') {
            setModal({ kind: 'canvas-create', initial: t("{v0}/Untitled", { v0: path }) });
            return;
        }
        if (action === 'folder') {
            setModal({ kind: 'folder-create', initial: `${path}/` });
            return;
        }
        if (action === 'rename' || action === 'delete') {
            setModal({ kind: action === 'rename' ? 'file-rename' : 'file-delete', path, folder });
            return;
        }
        if (action === 'bookmark') {
            setBookmarks((current) => current.includes(path) ? current : [...current, path]);
            return;
        }
        if (action === 'download') {
            window.location.href = `/api/download?path=${encodeURIComponent(path)}`;
            return;
        }
        if (action === 'merge') {
            void openComposer(path).catch((error: Error) => setNotice(error.message));
            return;
        }
        if (action === 'history') {
            void docs.load(path).then((note) => setModal({ kind: 'history', note })).catch((error: Error) => setNotice(error.message));
            return;
        }
        if (action === 'duplicate')
            void (async () => {
                try {
                    const extension = path.match(/\.[^/.]+$/)?.[0] || '';
                    const stem = path.slice(0, path.length - extension.length);
                    let target = t("{v0} copy{v1}", { v0: stem, v1: extension }), number = 2;
                    while (treeFiles.some((file) => file.path === target))
                        target = t("{v0} copy {v1}{v2}", { v0: stem, v1: number++, v2: extension });
                    if (/\.(md|canvas|base)$/i.test(path)) {
                        const note = await docs.load(path);
                        await docs.create(target, note.content);
                    }
                    else {
                        const response = await fetch(`/api/download?path=${encodeURIComponent(path)}`);
                        if (!response.ok)
                            throw new Error(t("Could not duplicate."));
                        await api.upload(new File([await response.blob()], target.split('/').at(-1)!), target);
                    }
                    await refreshNotes();
                    await openNote(target);
                }
                catch (error) {
                    setNotice((error as Error).message);
                }
            })();
    }
    async function trashFile(path: string) {
        for (const note of Object.values(docs.ref.current))
            if ((note.path === path || note.path.startsWith(`${path}/`)) && note.dirty && (!(await docs.save(note.path)) || docs.ref.current[note.path]?.dirty))
                throw new Error(t("Sync the draft before moving it to trash."));
        await api.trash(path);
        for (const note of Object.values(docs.ref.current))
            if (note.path === path || note.path.startsWith(`${path}/`))
                docs.remove(note.path);
        setTabs((current) => { const next = current.filter((tab) => !tab.path || (tab.path !== path && !tab.path.startsWith(`${path}/`))); return next.some((tab) => tab.id === 'graph') ? next : [globalGraph, ...next]; });
        setSelectedTab('graph');
        setSecondaryTab(null);
        focusGroup('primary');
        setContextPath('');
        setModal(null);
        await refreshNotes();
        setNotice(t("File moved to trash."));
    }
    async function uploadAttachments(selected: File[]) {
        const links: string[] = [];
        try {
            for (const file of selected) {
                const path = `${vaultSettings.attachmentFolder ? `${vaultSettings.attachmentFolder}/` : ''}${file.name}`;
                await api.upload(file, path);
                links.push(`${/\.(png|jpe?g|gif|svg|webp|avif|pdf|mp3|wav|ogg|m4a|mp4|webm)$/i.test(file.name) ? '!' : ''}[[${path}]]`);
            }
            await refreshNotes();
            return links.join('\n');
        }
        catch (error) {
            setNotice((error as Error).message);
            throw error;
        }
    }
    async function importFolder(files: File[]) {
        setImporting(true);
        let created = 0, skipped = 0, failed = 0;
        try {
            for (const [index, file] of files.entries()) {
                const relative = file.webkitRelativePath.split('/').slice(1).join('/') || file.name;
                setImportProgress(`${index + 1} de ${files.length}: ${relative}`);
                try {
                    if (/\.(md|canvas|base)$/i.test(file.name))
                        await api.create(relative, await file.text());
                    else
                        await api.upload(file, relative);
                    created++;
                }
                catch (error) {
                    if ((error as Error & {
                        status?: number;
                    }).status === 409)
                        skipped++;
                    else
                        failed++;
                }
            }
            await refreshNotes();
            setModal(null);
            showGraph();
            setNotice(t("Import: {v0} notes added, {v1} already exist{v2}.", { v0: created, v1: skipped, v2: failed ? t(", {v0} not imported", { v0: failed }) : '' }));
        }
        finally {
            setImporting(false);
            setImportProgress('');
        }
    }
    async function logout() {
        if (recordingBusy) {
            setNotice(t("Finish and save the recording before signing out."));
            return;
        }
        for (const doc of Object.values(docs.ref.current))
            if (doc.dirty && !(await docs.save(doc.path)))
                return;
        if (Object.values(docs.ref.current).some((doc) => doc.dirty)) {
            setNotice(t("There are pending offline changes. Reconnect to sync before signing out."));
            return;
        }
        await api.logout();
        await docs.clear();
        localStorage.removeItem('notesprig.workspace');
        setNotes([]);
        setAuthenticated(false);
        setTabs([globalGraph]);
        setSelectedTab('graph');
    }
    function goHistory(delta: number) {
        const index = history.index + delta;
        if (index < 0 || index >= history.paths.length)
            return;
        setHistory((current) => ({ ...current, index }));
        void openNote(history.paths[index], false);
    }
    const backlinks = useMemo(() => context ? notes.filter((note) => note.path !== context.path && note.links.some((link) => {
        const candidates = resolveTargets(link.target, note.path, notes, link.kind);
        return candidates.length === 1 && candidates[0].path === context.path;
    })) : [], [context, notes]);
    const headings = useMemo(() => (context?.content.replace(/```[^]*?```|~~~[^]*?~~~/g, '') || '').split('\n').map((line) => line.match(/^(#{1,6})\s+(.+?)\s*#*$/)).filter((match): match is RegExpMatchArray => Boolean(match)), [context?.content]);
    const tagCounts = useMemo(() => {
        const result = new Map<string, number>();
        for (const note of notes)
            for (const tag of note.tags)
                result.set(tag, (result.get(tag) || 0) + 1);
        return [...result].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }, [notes]);
    const commands: Choice[] = [
        { id: 'graph', label: t("Graph: open global view"), shortcut: 'Ctrl+G', run: () => showGraph() },
        { id: 'local', label: t("Graph: open this note's local graph"), run: () => showGraph(true) },
        { id: 'new', label: t("Create new note"), shortcut: 'Ctrl+N', run: () => setModal({ kind: 'create', title: '' }) },
        { id: 'open', label: t("Open a note"), shortcut: 'Ctrl+O', run: () => setModal({ kind: 'switcher' }) },
        { id: 'daily', label: t("Open today's daily note"), run: () => { void dailyNote(); } },
        { id: 'search', label: t("Search all files"), shortcut: 'Ctrl+Shift+F', run: () => showSearch() },
        { id: 'mode', label: t("Toggle reading and editing"), shortcut: 'Ctrl+E', run: () => setMode((value) => value !== 'read' ? 'read' : 'live') },
        { id: 'left', label: t("Toggle files panel"), run: () => setLeftOpen((value) => !value) },
        { id: 'right', label: t("Toggle connections panel"), run: () => setRightOpen((value) => !value) },
        { id: 'slides', label: t("Slides: present this note"), run: () => {
                if (active && active.kind !== 'canvas')
                    setModal({ kind: 'slides', note: active });
            } },
        { id: 'web', label: t("Open web viewer"), run: () => setModal({ kind: 'web-create' }) },
        { id: 'base', label: t("Bases: create a new property base"), run: () => setModal({ kind: 'base-create' }) },
        { id: 'canvas', label: t("Canvas: create a new canvas"), run: () => setModal({ kind: 'canvas-create' }) },
        { id: 'folder', label: t("Create new folder"), run: () => setModal({ kind: 'folder-create' }) },
        { id: 'split-right', label: t("Split pane to the right"), run: () => { setSplitDirection('right'); setSecondaryTab(tab.id); } },
        { id: 'split-down', label: t("Split pane below"), run: () => { setSplitDirection('down'); setSecondaryTab(tab.id); } },
        { id: 'merge', label: t("Composer: merge this note into another"), run: () => { void openComposer().catch((error: Error) => setNotice(error.message)); } },
        { id: 'extract', label: t("Composer: extract selection to a new note"), run: () => { void openExtraction().catch((error: Error) => setNotice(error.message)); } },
        { id: 'templates', label: t("Insert template"), run: () => setModal({ kind: 'templates' }) },
        { id: 'trash', label: t("Open trash and recover files"), run: () => setModal({ kind: 'trash' }) },
        { id: 'history', label: t("Open version history"), run: () => {
                if (active)
                    setModal({ kind: 'history', note: active });
            } },
        { id: 'upload', label: t("Add attachments"), run: () => uploadInput.current?.click() },
        { id: 'export', label: t("Export vault as ZIP"), run: () => { window.location.href = '/api/export'; } },
        { id: 'zip', label: t("Import vault from ZIP"), run: () => zipInput.current?.click() },
        { id: 'settings', label: t("Open settings"), run: () => setModal({ kind: 'settings' }) },
        { id: 'import', label: t("Import a Markdown notes folder"), run: () => importInput.current?.click() },
    ];
    const words = active?.content.trim().split(/\s+/).filter(Boolean).length || 0;
    function renderContent(viewTab: Tab, group: 'primary' | 'secondary' = 'primary') {
        const tab = viewTab;
        const active = (tab.kind === 'note' || tab.kind === 'canvas' || tab.kind === 'base') && tab.path ? docs.documents[tab.path] : null;
        const mode = viewModes[`${group}:${tab.id}`] || viewModes[tab.id] || 'live';
        const isGraph = tab.kind === 'graph' || tab.kind === 'local';
        return (tab.kind === 'base' && active ? <BasesView content={active.content} files={treeFiles} onChange={(content) => docs.edit(active.path, content)} onOpen={(path) => void openNote(path)} load={docs.load} onNotice={setNotice} onPropertyChange={async (path, key, value) => {
                const note = await docs.load(path);
                docs.edit(path, writeProperties(note.content, { ...readPropertiesForBase(note.content), [key]: value }));
                if (!(await docs.save(path)))
                    throw new Error(t("Could not sync the property."));
                await refreshNotes();
            }}/> : tab.kind === 'web' && tab.path ? <WebView initialUrl={tab.path}/> : isGraph ? <><div className="graph-toolbar"><div><Network size={16}/><span>{tab.kind === 'local' ? t("Connections for {v0}", { v0: baseName(tab.path || '') }) : t("All notes in the vault")}</span></div><div><button className={`mode-button ${tab.kind === 'graph' ? 'active' : ''}`} onClick={() => showGraph()}>{t("Global")}</button><button className={`mode-button ${tab.kind === 'local' ? 'active' : ''}`} onClick={() => showGraph(true)} disabled={!contextPath}>{t("Local")}</button></div></div><GraphView key={tab.id} notes={notes} files={treeFiles} focusPath={tab.kind === 'local' ? tab.path : undefined} onOpen={openGraphNode}/></> : tab.kind === 'canvas' && active ? <CanvasView key={active.path} path={active.path} value={active.content} onChange={(value) => docs.edit(active.path, value)} files={treeFiles} onOpen={(path) => void openNote(path)} onNotice={setNotice} onLink={(target, origin, kind) => void openLink(target, origin, kind)} onUpload={async (files) => {
                const paths: string[] = [];
                for (const file of files) {
                    const path = `${vaultSettings.attachmentFolder ? `${vaultSettings.attachmentFolder}/` : ''}${file.name}`;
                    await api.upload(file, path);
                    paths.push(path);
                }
                await refreshNotes();
                return paths;
            }}/> : tab.kind === 'attachment' && tab.path ? <AttachmentView path={tab.path}/> : active ? <>
          <div className="document-toolbar"><div className="document-nav"><button className="mini-icon" disabled={history.index <= 0} aria-label={t("Previous note")} onClick={() => goHistory(-1)}><ArrowLeft size={16}/></button><button className="mini-icon" disabled={history.index >= history.paths.length - 1} aria-label={t("Next note")} onClick={() => goHistory(1)}><ArrowRight size={16}/></button></div><div className="breadcrumbs"><span>{parentPath(active.path) || t("My vault")}</span><ChevronRight size={13}/><strong>{baseName(active.path)}</strong></div><div className="document-actions"><button className={`icon-button compact ${bookmarks.includes(active.path) ? 'active' : ''}`} title={t("Bookmark note")} aria-label={t("Bookmark note")} onClick={() => setBookmarks((current) => current.includes(active.path) ? current.filter((path) => path !== active.path) : [...current, active.path])}><Bookmark size={16}/></button><button className="icon-button compact" aria-label={t("Open local graph")} title={t("Open local graph")} onClick={() => showGraph(true)}><Network size={16}/></button><button className={`mode-button ${mode === 'live' ? 'active' : ''}`} onClick={() => setMode('live')} title={t("Edit (Ctrl+E)")}><Pencil size={14}/>{" " + t("Live Preview")}</button><button className={`mode-button ${mode === 'source' ? 'active' : ''}`} onClick={() => setMode('source')}>{t("Source")}</button><button className={`mode-button ${mode === 'read' ? 'active' : ''}`} onClick={() => setMode('read')}><BookOpen size={14}/>{" " + t("Read")}</button><button className="icon-button compact" title={t("Rename note")} aria-label={t("Rename note")} onClick={() => setModal({ kind: 'rename', note: active })}><FilePlus2 size={15}/></button><button className="icon-button compact" title={t("Version history")} aria-label={t("Version history")} onClick={async () => {
                if (await docs.save(active.path))
                    setModal({ kind: 'history', note: docs.ref.current[active.path] });
            }}><History size={15}/></button><button className="icon-button compact" title={t("Attach file")} aria-label={t("Attach file")} onClick={() => uploadInput.current?.click()}><Upload size={15}/></button><button className="icon-button compact danger-action" title={t("Move to trash")} aria-label={t("Move to trash")} onClick={() => setModal({ kind: 'delete', note: active })}><Trash2 size={15}/></button></div></div>
          <div className={`document-body ${mode === 'read' ? 'reading-mode' : ''}`}>{mode !== 'read' ? <div className="editor-pane"><div className="editor-heading"><h1>{baseName(active.path)}</h1></div><PropertiesPanel content={active.content} onChange={(value) => docs.edit(active.path, value)} onEdit={() => setModal({ kind: 'properties', note: active })}/><div className="codemirror-wrap"><Suspense fallback={<p className="muted editor-loading">{t("Loading editor\u2026")}</p>}><MarkdownEditor key={active.path} path={active.path} value={active.content} live={mode === 'live'} files={treeFiles} onOpen={(target, kind) => void openLink(target, active.path, kind)} onChange={(value) => docs.edit(active.path, value)} onUpload={(files) => uploadAttachments(files)}/></Suspense></div></div> : <article className="reading-pane" onClick={(event) => void handlePreviewClick(event)}><div className="reading-header"><h1>{baseName(active.path)}</h1></div><PropertiesPanel content={active.content} onChange={(value) => docs.edit(active.path, value)} onEdit={() => setModal({ kind: 'properties', note: active })}/><RichPreview content={active.content} path={active.path} files={treeFiles} onTask={(value) => docs.edit(active.path, value)} fragment={reference?.path === active.path ? reference.fragment : undefined}/></article>}</div>
          <div className="note-status"><span className={active.blocked ? 'save-error' : ''}>{docs.saving.has(active.path) ? t("Saving\u2026") : active.blocked ? t("Save failed \u00B7 Ctrl+S to retry") : active.dirty ? t("Pending changes") : <><Check size={12}/>{" " + t("Saved")}</>}</span></div>
        </> : <section className="welcome-state"><FileText size={34}/><h1>{t("New tab")}</h1><p>{t("Open a note, explore its connections, or start writing.")}</p><button onClick={() => setModal({ kind: 'switcher' })}><Files size={17}/>{" " + t("Open note") + " "}<kbd>Ctrl+O</kbd></button><button onClick={() => setModal({ kind: 'create', title: '' })}><FilePlus2 size={17}/>{" " + t("Create note") + " "}<kbd>Ctrl+N</kbd></button><button onClick={() => showGraph()}><Network size={17}/>{" " + t("Graph view") + " "}<kbd>Ctrl+G</kbd></button></section>);
    }
    if (authenticated === null)
        return <main className="boot-screen"><Network size={25}/><span>{t("Opening vault\u2026")}</span></main>;
    if (!authenticated)
        return <Login onLogin={() => void beginApp()}/>;
    return <div className={`app-shell ${readableWidth ? 'readable-width' : ''}`} style={{ '--left-width': `${leftWidth}px`, '--right-width': `${rightWidth}px` } as CSSProperties}>
    <input className="folder-input" type="file" ref={importInput} multiple {...{ webkitdirectory: '' }} aria-label={t("Select Markdown folder")} onChange={(event) => {
            const files = [...(event.target.files || [])].filter((file) => /\.(md|canvas|base|png|jpe?g|gif|webp|svg|avif|pdf|mp3|wav|ogg|m4a|mp4|webm|txt|csv|json)$/i.test(file.name) && !file.webkitRelativePath.split('/').slice(1).some((part) => part.startsWith('.')));
            if (files.length)
                setModal({ kind: 'import', files });
            else
                setNotice(t("No Markdown files were found in this folder."));
            event.target.value = '';
        }}/>
    <input ref={uploadInput} className="folder-input" type="file" multiple aria-label={t("Select attachments")} onChange={(event) => {
            const selected = [...(event.target.files || [])];
            event.target.value = '';
            void (async () => {
                try {
                    const links: string[] = [];
                    for (const file of selected) {
                        const path = `${vaultSettings.attachmentFolder ? `${vaultSettings.attachmentFolder}/` : ''}${file.name}`;
                        await api.upload(file, path);
                        links.push(`${/\.(png|jpe?g|gif|svg|webp|avif|pdf|mp3|wav|ogg|m4a|mp4|webm)$/i.test(file.name) ? '!' : ''}[[${path}]]`);
                    }
                    if (active && active.kind !== 'canvas')
                        docs.edit(active.path, `${docs.ref.current[active.path].content}\n\n${links.join('\n')}\n`);
                    await refreshNotes();
                    setNotice(t("{v0} attachment(s) added.", { v0: selected.length }));
                }
                catch (error) {
                    setNotice((error as Error).message);
                }
            })();
        }}/>
    <input ref={zipInput} className="folder-input" type="file" accept=".zip" aria-label={t("Select vault ZIP")} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file)
                void api.importZip(file).then(async (result) => { await refreshNotes(); setNotice(t("{v0} files imported; {v1} skipped.", { v0: result.imported, v1: result.skipped.length })); }).catch((error: Error) => setNotice(error.message));
        }}/>
    <header className="titlebar"><span>{BRAND.name}</span><span>{t("My vault")}</span><span>{docs.offline ? <><WifiOff size={11}/>{" " + t("Offline \u00B7 local changes")}</> : <><Wifi size={11}/>{" " + t("Connected")}</>}<LockKeyhole size={11}/>{" " + t("Personal")}</span></header>
    <div className="workspace">
      <nav className="ribbon" aria-label={t("Tools")}>
        <button className="icon-button" onClick={() => setLeftOpen(!leftOpen)} title={t("Toggle explorer")} aria-label={t("Toggle explorer")}>{leftOpen ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button>
        <div className="ribbon-separator"/>
        <button className="icon-button" onClick={() => setModal({ kind: 'switcher' })} title={t("Open note (Ctrl+O)")} aria-label={t("Open note")}><Files size={19}/></button>
        <button className={`icon-button ${isGraph ? 'active' : ''}`} onClick={() => showGraph()} title={t("Open global graph (Ctrl+G)")} aria-label={t("Open global graph")}><Network size={20}/></button>
        <button className="icon-button" onClick={() => setModal({ kind: 'create', title: '' })} title={t("New note (Ctrl+N)")} aria-label={t("New note")}><FilePlus2 size={19}/></button>
        <button className="icon-button" aria-label={t("New base")} title={t("New base")} onClick={() => setModal({ kind: 'base-create' })}><Table2 size={19}/></button><button className="icon-button" aria-label={t("New Canvas")} title={t("New Canvas")} onClick={() => setModal({ kind: 'canvas-create' })}><LayoutDashboard size={19}/></button><button className="icon-button" onClick={() => void dailyNote()} title={t("Daily note")} aria-label={t("Daily note")}><CalendarDays size={19}/></button>
        <button className="icon-button" onClick={() => setModal({ kind: 'commands' })} title={t("Command palette (Ctrl+P)")} aria-label={t("Command palette")}><Command size={19}/></button>
        <AudioRecorder onStateChange={setRecordingBusy} onNotice={setNotice} onRecorded={async (file) => {
            const target = active && /\.md$/i.test(active.path) ? active.path : undefined;
            const link = await uploadAttachments([file]);
            if (target && docs.ref.current[target])
                docs.edit(target, `${docs.ref.current[target].content}\n\n${link}\n`);
            setNotice(t("Recording saved to the vault."));
        }}/><div className="ribbon-spacer"/><button className="icon-button" aria-label={t("Open trash")} title={t("Trash")} onClick={() => setModal({ kind: 'trash' })}><Trash2 size={18}/></button>
        <button className="icon-button" onClick={() => void logout()} title={t("Sign out")} aria-label={t("Sign out")}><LogOut size={18}/></button>
        <button className="icon-button" onClick={() => setModal({ kind: 'settings' })} title={t("Settings")} aria-label={t("Settings")}><Settings2 size={19}/></button>
      </nav>
      {leftOpen && <aside className="left-sidebar" aria-label={t("Explorer")}>
        <SidebarResizer side="left" width={leftWidth} onResize={setLeftWidth}/>
        <div className="sidebar-tabs"><button className={leftTab === 'files' ? 'active' : ''} onClick={() => setLeftTab('files')} aria-label={t("Files")} title={t("Files")}><Files size={17}/></button><button className={leftTab === 'search' ? 'active' : ''} onClick={() => showSearch()} aria-label={t("Search")} title={t("Search")}><Search size={17}/></button><button className={leftTab === 'bookmarks' ? 'active' : ''} onClick={() => setLeftTab('bookmarks')} aria-label={t("Bookmarks")} title={t("Bookmarks")}><Bookmark size={17}/></button></div>
        {leftTab === 'files' ? <><div className="explorer-toolbar"><strong>{t("My vault") + " "}<ChevronDown size={13}/></strong><button className="mini-icon" aria-label={t("New folder")} title={t("New folder")} onClick={() => setModal({ kind: 'folder-create' })}><FolderPlus size={15}/></button><button className="mini-icon" aria-label={t("Import Markdown folder")} title={t("Import Markdown folder")} onClick={() => importInput.current?.click()}><FolderInput size={16}/></button><button className="mini-icon" onClick={() => setModal({ kind: 'create', title: '' })} aria-label={t("Create note")} title={t("Create note")}><FilePlus2 size={16}/></button></div><div className="sidebar-content">{treeFiles.length ? <FileTree notes={treeFiles} activePath={active?.path} onOpen={(path) => void openNote(path)} onAction={fileAction} onMove={(from, to) => void moveFile(from, to).catch((error: Error) => setNotice(error.message))}/> : <div className="empty-sidebar"><FolderOpen size={24}/><span>{t("Your vault is empty.")}</span><button onClick={() => setModal({ kind: 'create', title: '' })}>{t("Create first note")}</button></div>}</div></> : leftTab === 'bookmarks' ? <div className="sidebar-content"><div className="sidebar-section-title">{t("BOOKMARKS")}</div>{bookmarks.filter((path) => treeFiles.some((note) => note.path === path)).map((path) => <button className="tree-file" key={path} onClick={() => void openNote(path)}><Bookmark size={14}/><span>{baseName(path)}</span></button>)}{!bookmarks.length && <p className="detail-empty">{t("Bookmark a note using the icon in the editor toolbar.")}</p>}</div> : <div className="sidebar-content search-pane"><div className="search-box"><Search size={15}/><input aria-label={t("Search notes")} className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search notes\u2026")}/></div><div className="search-meta">{searchBusy ? 'Buscando…' : search ? t("{v0} matches", { v0: searchResults.reduce((sum, item) => sum + item.count, 0) }) : t("Search all files")}</div><div className="search-results">{searchResults.map((item) => <button className="search-result" key={item.path} onClick={() => void openNote(item.path)}><span className="search-result-title">{baseName(item.path)}<small>{item.count}</small></span><span className="search-result-path">{item.path}</span>{item.snippets.slice(0, 2).map((snippet, index) => <span className="search-result-snippet" key={index}>{snippet}</span>)}</button>)}</div></div>}
        <div className="sidebar-bottom"><span>{notes.length}{" " + t("notes")}</span><button onClick={() => void refreshNotes().catch((error: Error) => setNotice(error.message))}>{t("Refresh files")}</button></div>
      </aside>}
      <div className={`pane-groups split-${splitDirection}`}><main className={`editor-workspace ${focusedGroup === 'primary' ? 'focused-pane' : ''}`} onPointerDownCapture={() => focusGroup('primary')}>
        <div className="workspace-tabbar"><div className="workspace-tabs" role="tablist" aria-label={t("Open tabs")}>{tabs.map((item) => <div className={`workspace-tab ${selectedTab === item.id ? 'selected' : ''}`} key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/x-notesprig-tab', item.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/x-notesprig-tab');
                if (!id || id === item.id)
                    return;
                setTabs((current) => {
                    const moving = current.find((entry) => entry.id === id);
                    if (!moving)
                        return current;
                    const remaining = current.filter((entry) => entry.id !== id);
                    remaining.splice(remaining.findIndex((entry) => entry.id === item.id), 0, moving);
                    return remaining;
                });
            }}><button role="tab" aria-selected={selectedTab === item.id} onClick={() => {
                if ((item.kind === 'note' || item.kind === 'canvas' || item.kind === 'base' || item.kind === 'attachment') && item.path)
                    void openNote(item.path);
                else
                    showTab(item);
            }} title={item.path || t("Global graph")}>{item.kind === 'graph' || item.kind === 'local' ? <Network size={15}/> : <FileText size={14}/>}<span>{item.kind === 'graph' ? t("Global graph") : item.kind === 'local' ? t("Graph: {v0}", { v0: baseName(item.path || '') }) : item.kind === 'empty' ? t("New tab") : baseName(item.path || '')}</span>{item.path && docs.documents[item.path]?.dirty && <i className="unsaved-dot"/>}</button><button className={`tab-pin ${item.pinned ? 'pinned' : ''}`} title={item.pinned ? t("Unpin tab") : t("Pin tab")} aria-label={`${item.pinned ? t("Unpin") : t("Pin")} ${item.path ? baseName(item.path) : t("Global graph")}`} onClick={() => setTabs((current) => current.map((entry) => entry.id === item.id ? { ...entry, pinned: !entry.pinned } : entry))}><Pin size={12}/></button><button className="tab-close" aria-label={t("Close {v0}", { v0: item.kind === 'graph' ? t("Global graph") : item.path ? baseName(item.path) : t("tab") })} onClick={() => void closeTab(item)}><X size={13}/></button></div>)}</div><button className="icon-button" aria-label={t("New tab")} title={t("New tab (Ctrl+T)")} onClick={() => showTab({ id: `empty:${Date.now()}`, kind: 'empty' })}><Plus size={16}/></button><button className="icon-button" aria-label={t("Split right")} title={t("Split right")} onClick={() => { setSplitDirection('right'); setSecondaryTab(selectedTab); }}><Columns2 size={16}/></button><button className="icon-button" aria-label={t("Split below")} title={t("Split below")} onClick={() => { setSplitDirection('down'); setSecondaryTab(selectedTab); }}><Rows2 size={16}/></button><button className="icon-button right-toggle" aria-label={t("Toggle right panel")} onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button></div>
        {renderContent(tabs.find((item) => item.id === selectedTab) || globalGraph)}
        {loading && <div className="loading-overlay"><span className="spinner"/>{" " + t("Opening note\u2026")}</div>}
      </main>
      {secondaryTab && <><div className="pane-divider"/><main className={`editor-workspace secondary-pane ${focusedGroup === 'secondary' ? 'focused-pane' : ''}`} onPointerDownCapture={() => focusGroup('secondary')}><div className="workspace-tabbar"><select aria-label={t("Secondary pane tab")} value={secondaryTab} onChange={(event) => setSecondaryTab(event.target.value)}>{tabs.map((item) => <option key={item.id} value={item.id}>{item.path ? baseName(item.path) : item.kind === 'graph' ? t("Global graph") : t("New tab")}</option>)}</select><button className="icon-button right-toggle" aria-label={t("Close split")} onClick={() => { setSecondaryTab(null); focusGroup('primary'); }}><X size={16}/></button></div>{renderContent(tabs.find((item) => item.id === secondaryTab) || globalGraph, 'secondary')}</main></>}
      </div>
      {rightOpen && <aside className="right-sidebar" aria-label={t("Connections panel")}><SidebarResizer side="right" width={rightWidth} onResize={setRightWidth}/><div className="sidebar-tabs"><button className={rightTab === 'links' ? 'active' : ''} onClick={() => setRightTab('links')} title={t("Backlinks and local graph")} aria-label={t("Backlinks and local graph")}><Link2 size={17}/></button><button className={rightTab === 'outline' ? 'active' : ''} onClick={() => setRightTab('outline')} title={t("Note outline")} aria-label={t("Note outline")}><ListTree size={17}/></button><button className={rightTab === 'tags' ? 'active' : ''} onClick={() => setRightTab('tags')} title={t("Tags")} aria-label={t("Tags")}><Tag size={17}/></button></div><div className="right-sidebar-scroll">
        {rightTab === 'tags' ? <section className="detail-section"><h3>{t("Tags") + " "}<span>{tagCounts.length}</span></h3>{tagCounts.map(([tag, count]) => <button className="tag-item" key={tag} onClick={() => showSearch(`#${tag}`)}><Hash size={13}/><span>{tag}</span><small>{count}</small></button>)}{!tagCounts.length && <p className="detail-empty">{t("Add #tags to notes to organize your vault.")}</p>}</section> : rightTab === 'outline' ? <section className="detail-section"><h3>{t("Outline")}</h3>{headings.map((heading, index) => <button key={index} className="outline-item" style={{ paddingLeft: (heading[1].length - 1) * 12 + 8 }} onClick={async () => {
                        if (context) {
                            await openNote(context.path);
                            setViewModes((current) => ({ ...current, [`${focusedRef.current}:note:${context.path}`]: 'read' }));
                            setTimeout(() => document.querySelectorAll('.markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4, .markdown-preview h5, .markdown-preview h6')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                        }
                    }}>{heading[2]}</button>)}{!headings.length && <p className="detail-empty">{t("Note headings will appear here.")}</p>}</section> : <>
          <section className="detail-section local-graph-section"><h3>{t("Local graph")}<button className="mini-icon" aria-label={t("Expand local graph")} disabled={!context} onClick={() => showGraph(true)}><Network size={15}/></button></h3>{context ? <GraphView key={context.path} notes={notes} files={treeFiles} focusPath={context.path} compact onOpen={openGraphNode}/> : <p className="detail-empty">{t("Open a note to see nearby connections.")}</p>}</section>
          <section className="detail-section"><h3>{t("Backlinks") + " "}<span className="count-badge">{backlinks.length}</span></h3>{backlinks.map((note) => <button className="backlink-item" key={note.path} onClick={() => void openNote(note.path)}><FileText size={13}/><span>{baseName(note.path)}<small>{note.path}</small></span></button>)}{!backlinks.length && <p className="detail-empty">{t("No links to") + " "}{context ? `“${baseName(context.path)}”` : t("an open note")}.</p>}</section>
          {context && <><section className="detail-section"><h3>{t("Outgoing links") + " "}<span className="count-badge">{context.links.length}</span></h3>{context.links.map((link, index) => <button className="outgoing-link" key={`${link.target}-${index}`} onClick={() => void openLink(link.target, context.path, link.kind)}><Link2 size={13}/><span>{link.target}</span></button>)}{!context.links.length && <p className="detail-empty">{t("This note has no links yet.")}</p>}</section><section className="detail-section"><h3>{t("Properties")}</h3>{context.propertyError && <p className="form-error">{translateMessage(context.propertyError)}</p>}{Object.entries(context.properties || {}).map(([key, value]) => <div className="property-row" key={key}><span>{key}</span><strong>{Array.isArray(value) ? value.join(', ') : String(value)}</strong></div>)}<button className="text-action" onClick={() => setModal({ kind: 'properties', note: context })}><Plus size={13}/>{" " + t("Edit properties")}</button></section></>}
        </>}
      </div></aside>}
    </div>
    <footer className="statusbar"><span>{notes.length}{" " + t("notes")}<span className="status-divider">·</span>{isGraph ? t("Graph") : active ? active.path : t("My vault")}</span><span>{active ? <>{backlinks.length}{" " + t("backlinks") + " "}<span className="status-divider">·</span>{words}{" " + t("words")}<span className="status-divider">·</span>{active.content.length}{" " + t("characters")}</> : `Markdown · ${BRAND.name}`}</span></footer>
    {modal?.kind === 'merge' && <ComposerModal source={modal.note} files={treeFiles} load={docs.load} onClose={() => setModal(null)} onMerge={async (target, prepend) => {
                const result = await api.merge(modal.note.path, target.path, modal.note.hash, target.hash, prepend);
                docs.remove(modal.note.path);
                for (const path of result.updated)
                    if (path !== target.path)
                        docs.remove(path);
                docs.put({ ...result.note, dirty: false });
                setTabs((current) => current.filter((tab) => tab.path !== modal.note.path));
                setSecondaryTab(null);
                focusGroup('primary');
                setModal(null);
                await refreshNotes();
                await openNote(target.path);
                setNotice(t("Notes merged. The source can still be recovered from trash."));
            }}/>}
    {modal?.kind === 'extract' && <TextActionModal title={t("Extract selection")} initial={t("New excerpt")} label={t("New note name")} help={t("The selection will be saved in the new file and replaced with a wikilink in the source.")} onClose={() => setModal(null)} onSubmit={async (name) => {
                const source = docs.ref.current[modal.note.path];
                const { from, to, text } = modal.selection;
                if (!source || source.content.slice(from, to) !== text)
                    throw new Error(t("The source changed. Select the excerpt again."));
                const path = `${name.trim().replace(/\.md$/i, '')}.md`;
                await docs.create(path, text);
                docs.edit(source.path, `${source.content.slice(0, from)}[[${path.replace(/\.md$/i, '')}]]${source.content.slice(to)}`);
                if (!(await docs.save(source.path)))
                    throw new Error(t("The excerpt was preserved in the new file. Resolve the source conflict."));
                await refreshNotes();
                setModal(null);
                await openNote(path);
            }}/>}
    {modal?.kind === 'slides' && <SlidesView content={modal.note.content} path={modal.note.path} files={treeFiles} onClose={() => setModal(null)}/>}
    {modal?.kind === 'web-create' && <TextActionModal title={t("Open page")} initial="https://" label={t("Address")} help={t("Some sites restrict embedding; you can open them in your browser.")} onClose={() => setModal(null)} onSubmit={async (address) => {
                const url = new URL(address.includes('://') ? address : `https://${address}`);
                if (!['https:', 'http:'].includes(url.protocol))
                    throw new Error(t("Invalid address."));
                showTab({ id: `web:${url.href}`, kind: 'web', path: url.href });
                setModal(null);
            }}/>}
    {modal?.kind === 'templates' && <TemplatesModal files={treeFiles} folder={vaultSettings.templatesFolder} onClose={() => setModal(null)} onChoose={insertTemplate}/>}
    {modal?.kind === 'file-rename' && <TextActionModal title={modal.folder ? t("Rename or move folder") : t("Rename or move file")} initial={modal.path} label={t("New path")} help={t("References in notes and Canvas files will be updated.")} onClose={() => setModal(null)} onSubmit={async (path) => { await moveFile(modal.path, path); setModal(null); }}/>}
    {modal?.kind === 'file-delete' && <Modal onClose={() => setModal(null)}><h2>{t("Move to trash?")}</h2><p className="muted">{modal.path}{modal.folder ? " " + t("and its contents") : ''}</p><div className="modal-actions"><button className="quiet-button" onClick={() => setModal(null)}>{t("Cancel")}</button><button className="primary-button destructive" onClick={() => void trashFile(modal.path).catch((error: Error) => setNotice(error.message))}>{t("Move to trash")}</button></div></Modal>}
    {modal?.kind === 'base-create' && <TextActionModal title={t("New base")} initial={modal.initial || t("Untitled")} label={t("Base name")} help={t("Views of files and properties in YAML .base format.")} onClose={() => setModal(null)} onSubmit={async (name) => { const path = `${name.trim().replace(/\.base$/i, '')}.base`; await docs.create(path, 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.tags\n'); await refreshNotes(); setModal(null); await openNote(path); }}/>}
    {modal?.kind === 'canvas-create' && <TextActionModal title={t("New Canvas")} initial={modal.initial || t("Untitled")} label={t("Canvas name")} help={t("A JSON Canvas document, compatible with .canvas files.")} onClose={() => setModal(null)} onSubmit={async (name) => { const path = `${name.trim().replace(/\.canvas$/i, '')}.canvas`; await docs.create(path, JSON.stringify({ nodes: [], edges: [] }, null, '\t')); await refreshNotes(); setModal(null); await openNote(path); }}/>}
    {modal?.kind === 'folder-create' && <TextActionModal title={t("New folder")} initial={modal.initial || ''} label={t("Folder path")} help={t("You can create folders and subfolders.")} onClose={() => setModal(null)} onSubmit={async (path) => { await api.folder(path.trim()); await refreshNotes(); setModal(null); }}/>}
    {modal?.kind === 'history' && <HistoryModal note={modal.note} onClose={() => setModal(null)} onRestore={async (version) => {
                const path = modal.note.path;
                if (!(await docs.save(path)))
                    throw new Error(t("Resolve the pending save."));
                const saved = await api.restoreVersion(path, version.id, docs.ref.current[path].hash);
                docs.put({ ...saved, dirty: false });
                await refreshNotes();
                setModal(null);
                setNotice(t("Version restored. The previous version remains in history."));
            }}/>}
    {modal?.kind === 'trash' && <TrashModal onClose={() => setModal(null)} onRestored={async () => { await refreshNotes(); setNotice(t("File restored.")); }}/>}
    {modal?.kind === 'create' && <CreateNoteModal title={modal.title} onClose={() => setModal(null)} onCreate={createNote}/>}
    {modal?.kind === 'import' && <Modal onClose={() => {
                if (!importing)
                    setModal(null);
            }}><div className="modal-heading"><h2>{t("Import Markdown folder")}</h2>{!importing && <button className="icon-button" onClick={() => setModal(null)} aria-label={t("Close import")}><X size={18}/></button>}</div><p className="muted">{modal.files.length}{" " + t("notes found in the selected folder. Subfolder structure will be preserved; existing files will be skipped.")}</p><p className="muted small">{t("Markdown, Canvas, and attachments will be imported. Hidden configuration and plugin folders are excluded.")}</p>{importing && <p className="import-progress" role="status">{importProgress || t("Preparing import\u2026")}</p>}<div className="modal-actions"><button className="quiet-button" disabled={importing} onClick={() => setModal(null)}>{t("Cancel")}</button><button className="primary-button" disabled={importing} onClick={() => void importFolder(modal.files).catch((error: Error) => setNotice(error.message))}>{importing ? t("Importing\u2026") : t("Import notes")}</button></div></Modal>}
    {modal?.kind === 'rename' && <TextActionModal title={t("Rename note")} initial={modal.note.path.replace(/\.md$/i, '')} label={t("Note path")} help={t("Simple wikilinks will be updated to the new name.")} onClose={() => setModal(null)} onSubmit={renameNote}/>}
    {modal?.kind === 'properties' && <PropertiesModal note={modal.note} onClose={() => setModal(null)} onSave={saveContent}/>}
    {modal?.kind === 'delete' && <Modal onClose={() => setModal(null)}><h2>{t("Delete \u201C")}{baseName(modal.note.path)}”?</h2><p className="muted">{t("The note will be moved to the vault's .trash folder.")}</p><div className="modal-actions"><button className="quiet-button" onClick={() => setModal(null)}>{t("Cancel")}</button><button className="primary-button destructive" onClick={() => void deleteNote(modal.note)}>{t("Move to trash")}</button></div></Modal>}
    {modal?.kind === 'ambiguous' && <Modal onClose={() => setModal(null)}><div className="modal-heading"><h2>{t("Choose a note")}</h2><button className="icon-button" onClick={() => setModal(null)} aria-label={t("Close")}><X size={18}/></button></div><p className="muted">{t("More than one note matches") + " "}<code>{modal.title}</code>.</p><div className="choice-list">{modal.candidates.map((candidate) => <button key={candidate.path} onClick={() => { setModal(null); void openNote(candidate.path); }}><FileText size={16}/><span>{baseName(candidate.path)}<small>{candidate.path}</small></span></button>)}</div></Modal>}
    {modal?.kind === 'conflict' && <Modal onClose={() => setModal(null)}><h2>{t("The note changed elsewhere")}</h2><p className="muted">{t("Your version is still saved in this tab. Reload to use the server version, or save a copy to keep your text in another file.")}</p><div className="modal-actions spread"><button className="quiet-button" onClick={() => { docs.put({ ...modal.remote, dirty: false }); setModal(null); }}>{t("Reload from server")}</button><button className="primary-button" onClick={async () => {
                try {
                    const saved = await api.create(`Conflicts/${baseName(modal.note.path)}-${Date.now()}.${modal.note.path.endsWith('.canvas') ? 'canvas' : 'md'}`, docs.ref.current[modal.note.path]?.content || modal.note.content);
                    docs.put({ ...modal.remote, dirty: false });
                    docs.put({ ...saved, dirty: false });
                    setModal(null);
                    await refreshNotes();
                    await openNote(saved.path);
                }
                catch (error) {
                    setNotice(error instanceof Error ? error.message : t("Could not preserve the copy."));
                }
            }}>{t("Save as copy")}</button></div></Modal>}
    {(modal?.kind === 'commands' || modal?.kind === 'switcher') && <CommandPicker title={modal.kind === 'commands' ? t("Search commands\u2026") : t("Open a note\u2026")} choices={modal.kind === 'commands' ? commands : notes.map((note) => ({ id: note.path, label: baseName(note.path), detail: note.path, run: () => { void openNote(note.path); } }))} onClose={() => setModal(null)}/>}
    {modal?.kind === 'settings' && <Modal onClose={() => setModal(null)}><div className="modal-heading"><h2>{t("Settings")}</h2><button className="icon-button" aria-label={t("Close settings")} onClick={() => setModal(null)}><X size={18}/></button></div><LanguageSelector /><label className="settings-row">{t("Appearance")}<select aria-label={t("Appearance")} value={theme} onChange={(event) => setTheme(event.target.value)}><option value="dark">{t("Dark")}</option><option value="light">{t("Light")}</option></select></label><label className="settings-row">{t("Comfortable reading width")}<input type="checkbox" checked={readableWidth} onChange={(event) => setReadableWidth(event.target.checked)}/></label><details className="settings-detail"><summary>{t("Files and daily notes")}</summary>{([['dailyFolder', t("Daily notes folder")], ['dailyFormat', t("Date format")], ['dailyTemplate', t("Daily note template")], ['templatesFolder', t("Templates folder")], ['attachmentFolder', t("Attachments folder")]] as const).map(([key, label]) => <label className="settings-field" key={key}>{label}<input aria-label={label} value={vaultSettings[key]} onChange={(event) => setVaultSettings((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => { void api.setSettings(vaultSettings).then(() => setLocal('settings', vaultSettings)).catch((error: Error) => setNotice(error.message)); }}/></label>)}</details><div className="settings-actions"><button className="quiet-button" onClick={() => { window.location.href = '/api/export'; }}>{t("Export vault ZIP")}</button><button className="quiet-button" onClick={() => zipInput.current?.click()}>{t("Import ZIP")}</button></div><p className="muted small">{t("Appearance is saved in this browser. Daily notes, templates, and attachments use vault settings. Drafts and previously opened documents are available offline on this device.")}</p></Modal>}
    {notice && <div className="toast" role="status"><span>{translateMessage(notice)}</span><button onClick={() => setNotice('')} aria-label={t("Dismiss notice")}><X size={15}/></button></div>}
  </div>;
}
export default App;
