import { t, translateMessage, getLocale } from './i18n';
import type { NoteDocument, NoteSummary, SearchItem, Version, TrashEntry } from './types';
async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        credentials: 'same-origin',
        signal: init?.signal || AbortSignal.timeout(30000),
        ...init,
        headers: {
            'Accept-Language': getLocale(),
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
    note: (path: string) => request<NoteDocument>(`/api/note?path=${encodeURIComponent(path)}`),
    save: (note: Pick<NoteDocument, 'path' | 'content' | 'hash'>) => request<NoteDocument>('/api/note', {
        method: 'PUT',
        body: JSON.stringify({ path: note.path, content: note.content, baseHash: note.hash }),
    }),
    create: (path: string, content: string) => request<NoteDocument>('/api/note', {
        method: 'POST', body: JSON.stringify({ path, content }),
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
