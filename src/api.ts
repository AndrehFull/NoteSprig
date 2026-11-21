import { currentContext } from './workspace';
import type { BoardDocument, ReferenceContext, BoardAsset } from '../shared/board-schema.mjs';
import { t, translateMessage, getLocale } from './i18n';
import type { NoteDocument, NoteSummary, SearchItem, Version, TrashEntry } from './types';
/** The vault this browser opens, like Obsidian's last opened vault. Empty means the server's default vault. */
export const VAULT_KEY = 'notesprig.vault';
export function selectedVault(): string { try { return localStorage.getItem(VAULT_KEY) || ''; } catch { return ''; } }
export function selectVault(id: string) { try { if (id) localStorage.setItem(VAULT_KEY, id); else localStorage.removeItem(VAULT_KEY); } catch { /* Storage can be unavailable; the default vault opens. */ } }
export type VaultEntry = { id: string; name: string; default: boolean };
async function vaultContext(): Promise<ReferenceContext> {
    const id = selectedVault();
    try { return await request<ReferenceContext>(`/api/boards/context${id ? `?vault=${encodeURIComponent(id)}` : ''}`); }
    catch (error) {
        // A vault removed on the server falls back to the default vault instead of locking the app.
        if (id && (error as { data?: { code?: string } }).data?.code === 'VAULT_NOT_FOUND') { selectVault(''); return request<ReferenceContext>('/api/boards/context'); }
        throw error;
    }
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
    let workspaceHeaders:Record<string,string>={};
    if(!/^\/api\/(?:session|login|logout|boards\/context|vaults)(?:\?.*)?$/.test(url)) {try {workspaceHeaders={'X-NoteSprig-Context':JSON.stringify(currentContext())};} catch { /* Bootstrap endpoints establish identity before private app calls. */ }}
    const response = await fetch(url, {
        credentials: 'same-origin',
        signal: init?.signal || AbortSignal.timeout(30000),
        ...init,
        headers: {
            'Accept-Language': getLocale(),
            ...workspaceHeaders,
            ...(init?.body || ['POST', 'PUT', 'DELETE'].includes(init?.method || '') ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401)
            window.dispatchEvent(new Event('notesprig:auth-required'));
        const error = new Error(translateMessage(data.error || t("Request failed ({v0}).", { v0: response.status })));
        Object.assign(error, { status: response.status, data });
        throw error;
    }
    return data as T;
}
export const api = {
    boardContext: vaultContext,
    vaults: () => request<VaultEntry[]>('/api/vaults'),
    createVault: (name: string) => request<VaultEntry>('/api/vaults', { method: 'POST', body: JSON.stringify({ name }) }),
    renameVault: (id: string, name: string) => request<VaultEntry>('/api/vaults', { method: 'PUT', body: JSON.stringify({ id, name }) }),
    board: (path: string, context: ReferenceContext) => request<{path:string;board:BoardDocument;hash:string}>(`/api/boards?path=${encodeURIComponent(path)}&context=${encodeURIComponent(JSON.stringify(context))}`),
    saveBoard: (payload: {path:string;board:BoardDocument;baseHash?:string;context:ReferenceContext}, create = false, signal?:AbortSignal) => request<{path:string;board:BoardDocument;hash:string}>('/api/boards', {method:create?'POST':'PUT',body:JSON.stringify(payload),signal}),
    boardPreview: (path:string, context:ReferenceContext, fragment?:string, signal?:AbortSignal) => request<{title:string;excerpt:string;status:'ready';revision:string}>('/api/boards/preview',{method:'POST',body:JSON.stringify({path,context,fragment}),signal}),
    boardAsset: (asset:BoardAsset, context:ReferenceContext) => request<{base64:string;sha256:string;mimeType:string}>(`/api/boards/asset?sha256=${asset.sha256}&mimeType=${encodeURIComponent(asset.mimeType)}&context=${encodeURIComponent(JSON.stringify(context))}`),
    uploadBoardAsset: (base64:string,context:ReferenceContext,signal?:AbortSignal) => request<BoardAsset>('/api/boards/assets',{method:'POST',body:JSON.stringify({base64,context}),signal}),
    restoreBoard: (payload:{path:string;id:string;baseHash:string;context:ReferenceContext}) => request<{path:string;board:BoardDocument;hash:string}>('/api/boards/restore',{method:'POST',body:JSON.stringify(payload)}),
    reviewBoard: (payload:{path:string;baseHash:string;context:ReferenceContext;previousContext:ReferenceContext;bindings:{elementId:string;state:'bound'|'unbound';path?:string;fragment?:string}[]}) => request<{path:string;board:BoardDocument;hash:string}>('/api/boards/review',{method:'POST',body:JSON.stringify(payload)}),
    session: () => request<{
        authenticated: boolean;
    }>('/api/session'),
    login: (password: string) => request<{
        authenticated: boolean;
    }>('/api/login', {
        method: 'POST', body: JSON.stringify({ password }),
    }),
    logout: () => request<{
        authenticated: boolean;
    }>('/api/logout', {
        method: 'POST', body: JSON.stringify({}),
    }),
    notes: () => request<NoteSummary[]>('/api/notes'),
    files: () => request<NoteSummary[]>('/api/files'),
    folder: (path: string) => request<{
        path: string;
    }>('/api/folder', { method: 'POST', body: JSON.stringify({ path }) }),
    upload: async (file: File, path = file.name) => {
        if (file.size > 50 * 1024 * 1024)
            throw new Error(t("The file exceeds 50 MB."));
        const base64 = await fileBase64(file);
        return request<{
            path: string;
            size: number;
        }>('/api/upload', { method: 'POST', body: JSON.stringify({ path, base64 }), signal: AbortSignal.timeout(300000) });
    },
    history: (path: string) => request<Version[]>(`/api/history?path=${encodeURIComponent(path)}`),
    version: (path: string, id: string) => request<Version>(`/api/version?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`),
    restoreVersion: (path: string, id: string, baseHash: string) => request<NoteDocument>('/api/history/restore', { method: 'POST', body: JSON.stringify({ path, id, baseHash }) }),
    trashList: () => request<TrashEntry[]>('/api/trash'),
    restoreTrash: (id: string, path?: string) => request<{
        path: string;
        kind: string;
    }>('/api/trash/restore', { method: 'POST', body: JSON.stringify({ id, path }) }),
    merge: (source: string, target: string, sourceHash: string, targetHash: string, prepend = false) => request<{
        note: NoteDocument;
        updated: string[];
    }>('/api/note/merge', { method: 'POST', body: JSON.stringify({ source, target, sourceHash, targetHash, prepend }) }),
    settings: () => request<Record<string, unknown>>('/api/settings'),
    setSettings: (settings: Record<string, unknown>) => request<Record<string, unknown>>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
    importZip: async (file: File, overwrite = false) => request<{
        imported: number;
        skipped: string[];
    }>('/api/import-zip', { method: 'POST', body: JSON.stringify({ base64: await fileBase64(file), overwrite }) }),
    note: (path: string, referenceContext?:ReferenceContext) => request<NoteDocument>(`/api/note?path=${encodeURIComponent(path)}${referenceContext?'&referenceContext='+encodeURIComponent(JSON.stringify(referenceContext)):''}`),
    save: (note: Pick<NoteDocument, 'path' | 'content' | 'hash' | 'referenceContext' | 'workspaceContext'>) => request<NoteDocument>('/api/note', {
        method: 'PUT',
        body: JSON.stringify({ path: note.path, content: note.content, baseHash: note.hash, referenceContext: note.referenceContext, workspaceContext: note.workspaceContext }),
    }),
    create: (path: string, content: string, workspaceContext?:ReferenceContext) => request<NoteDocument>('/api/note', {
        method: 'POST', body: JSON.stringify({ path, content, workspaceContext }),
    }),
    rename: (oldPath: string, newPath: string, updateLinks = true) => request<{
        path: string;
        updated: string[];
        moved: Record<string, string>;
    }>('/api/note/rename', {
        method: 'POST', body: JSON.stringify({ oldPath, newPath, updateLinks }),
    }),
    trash: (path: string) => request<{
        path: string;
        trashedAt: number;
    }>(`/api/note?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
    search: (query: string) => request<{
        total: number;
        items: SearchItem[];
    }>(`/api/search?q=${encodeURIComponent(query)}`),
};
export function fileBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error(t("Could not read the file."))); reader.readAsDataURL(file); });
}
