import { t, translateMessage, getLocale } from '../i18n';
import { useEffect, useState } from 'react';
import { Download, History, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { Modal } from './NoteTools';
import type { NoteDocument, TrashEntry, Version } from '../types';
export function HistoryModal({ note, onClose, onRestore }: {
    note: NoteDocument;
    onClose: () => void;
    onRestore: (version: Version) => Promise<void>;
}) {
    const [versions, setVersions] = useState<Version[]>([]);
    const [selected, setSelected] = useState<Version | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let cancelled = false;
        api.history(note.path).then((result) => {
            if (!cancelled)
                setVersions(result);
        }).catch((caught: Error) => setError(caught.message));
        return () => { cancelled = true; };
    }, [note.path]);
    async function choose(version: Version) {
        try {
            setSelected(await api.version(note.path, version.id));
            setError('');
        }
        catch (caught) {
            setError((caught as Error).message);
        }
    }
    return <Modal onClose={() => {
            if (!busy)
                onClose();
        }}><div className="modal-heading"><h2><History size={18}/>{" " + t("Version history")}</h2><button className="icon-button" aria-label={t("Close history")} onClick={onClose}><X size={18}/></button></div><p className="muted small">{note.path}{" " + t("\u00B7 Previous versions are preserved before editing, renaming, or restoring.")}</p><div className="version-list">{versions.map((version) => <button className={selected?.id === version.id ? 'selected' : ''} key={version.id} data-version-id={version.id} onClick={() => void choose(version)}><History size={14}/><span>{new Date(version.createdAt).toLocaleString(getLocale())}<small>{version.size}{" " + t("bytes \u00B7") + " "}{t(({ edit: 'Edited', rename: 'Renamed', restore: 'Restored', create: 'Created', merge: 'Merged' } as Record<string, string>)[version.reason] || version.reason)}</small></span></button>)}{!versions.length && <p className="muted">{t("No versions have been recorded yet.")}</p>}</div>{selected && <><div className="version-compare"><div><strong>{t("Selected version")}</strong><pre>{selected.content}</pre></div><div><strong>{t("Current version")}</strong><pre>{note.content}</pre></div></div><div className="modal-actions"><button className="quiet-button" onClick={() => { const anchor = document.createElement('a'); const url = URL.createObjectURL(new Blob([selected.content || ''], { type: 'text/plain' })); anchor.href = url; anchor.download = note.path.split('/').at(-1) || 'version.md'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={14}/>{" " + t("Download version")}</button><button className="primary-button" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                    await onRestore(selected);
                }
                catch (caught) {
                    setError((caught as Error).message);
                }
                finally {
                    setBusy(false);
                }
            }}><RotateCcw size={14}/>{" " + t("Restore version")}</button></div></>}{error && <p className="form-error">{translateMessage(error)}</p>}</Modal>;
}
export function TrashModal({ onClose, onRestored }: {
    onClose: () => void;
    onRestored: (path: string) => Promise<void>;
}) {
    const [entries, setEntries] = useState<TrashEntry[]>([]);
    const [paths, setPaths] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    useEffect(() => { api.trashList().then(setEntries).catch((caught: Error) => setError(caught.message)); }, []);
    return <Modal onClose={() => {
            if (!busy)
                onClose();
        }}><div className="modal-heading"><h2><Trash2 size={18}/>{" " + t("Trash")}</h2><button className="icon-button" aria-label={t("Close trash")} onClick={onClose}><X size={18}/></button></div><p className="muted small">{t("Restoration preserves contents and structure. Change the target if another file already has that name.")}</p><div className="trash-list">{entries.map((entry) => <div className="trash-entry" key={entry.id}><div><strong>{entry.path}</strong><small>{new Date(entry.trashedAt).toLocaleString(getLocale())} · {entry.kind}</small></div><input aria-label={t("Target for {v0}", { v0: entry.path })} value={paths[entry.id] ?? entry.path} onChange={(event) => setPaths((current) => ({ ...current, [entry.id]: event.target.value }))}/><button className="quiet-button" disabled={Boolean(busy)} onClick={async () => {
                setBusy(entry.id);
                setError('');
                try {
                    const result = await api.restoreTrash(entry.id, paths[entry.id] || entry.path);
                    setEntries((current) => current.filter((item) => item.id !== entry.id));
                    await onRestored(result.path);
                }
                catch (caught) {
                    setError((caught as Error).message);
                }
                finally {
                    setBusy('');
                }
            }}><RotateCcw size={13}/>{" " + t("Restore")}</button></div>)}{!entries.length && <p className="muted">{t("Trash is empty.")}</p>}</div>{error && <p className="form-error">{translateMessage(error)}</p>}</Modal>;
}
export function AttachmentView({ path }: {
    path: string;
}) {
    const [text, setText] = useState('');
    const url = `/api/attachment?path=${encodeURIComponent(path)}`;
    useEffect(() => {
        let cancelled = false;
        if (/\.(txt|csv|json)$/i.test(path))
            fetch(url).then((response) => response.ok ? response.text() : Promise.reject(new Error(t("Could not open the file.")))).then((value) => {
                if (!cancelled)
                    setText(value.slice(0, 500000));
            }).catch(() => {
                if (!cancelled)
                    setText(t("Could not preview the file."));
            });
        return () => { cancelled = true; };
    }, [path]);
    return <section className="attachment-view" aria-label={t("Attachment preview")}><div className="attachment-toolbar"><strong>{path.split('/').at(-1)}</strong><a className="quiet-button" href={`/api/download?path=${encodeURIComponent(path)}`} download><Download size={14}/>{" " + t("Download")}</a></div>{/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path) ? <img src={url} alt={path.split('/').at(-1)}/> : /\.pdf$/i.test(path) ? <iframe title={path} src={url}/> : /\.(mp3|wav|ogg|m4a)$/i.test(path) ? <audio src={url} controls/> : /\.(mp4|webm)$/i.test(path) ? <video src={url} controls/> : /\.(txt|csv|json)$/i.test(path) ? <pre>{text}</pre> : <p className="muted">{t("Use Download to open this file on your device.")}</p>}</section>;
}
