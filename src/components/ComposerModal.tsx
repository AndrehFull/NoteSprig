import { t, translateMessage } from '../i18n';
import { useEffect, useState } from 'react';
import { Merge, X } from 'lucide-react';
import { Modal } from './NoteTools';
import { stripFrontmatter } from '../markdown';
import type { NoteDocument, NoteSummary } from '../types';
export function ComposerModal({ source, files, load, onClose, onMerge }: {
    source: NoteDocument;
    files: NoteSummary[];
    load: (path: string) => Promise<NoteDocument>;
    onClose: () => void;
    onMerge: (target: NoteDocument, prepend: boolean) => Promise<void>;
}) {
    const [path, setPath] = useState(''), [target, setTarget] = useState<NoteDocument | null>(null), [prepend, setPrepend] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { let cancelled = false; setTarget(null); if (path)
        load(path).then((note) => { if (!cancelled)
            setTarget(note); }).catch((caught: Error) => setError(caught.message)); return () => { cancelled = true; }; }, [path, load]);
    const preview = target ? (prepend ? [stripFrontmatter(source.content), stripFrontmatter(target.content)] : [stripFrontmatter(target.content), stripFrontmatter(source.content)]).join('\n\n') : '';
    return <Modal onClose={() => { if (!busy)
        onClose(); }}><div className="modal-heading"><h2><Merge size={18}/>{" " + t("Merge notes")}</h2><button className="icon-button" aria-label={t("Close composer")} onClick={onClose}><X size={18}/></button></div><p className="muted small">{t("The contents of") + " "}{source.path}{" " + t("will be merged into the target. The source will move to trash, and known links will be updated.")}</p><label className="composer-field">{t("Target note")}<select aria-label={t("Target note")} value={path} onChange={(event) => setPath(event.target.value)}><option value="">{t("Select a note\u2026")}</option>{files.filter((file) => /\.md$/i.test(file.path) && file.path !== source.path).map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label><label className="composer-toggle"><input type="checkbox" checked={prepend} onChange={(event) => setPrepend(event.target.checked)}/>{t("Insert at the beginning of the target")}</label>{target && <pre className="composer-preview">{preview}</pre>}{error && <p className="form-error">{translateMessage(error)}</p>}<div className="modal-actions"><button className="quiet-button" onClick={onClose}>{t("Cancel")}</button><button className="primary-button" disabled={!target || busy} onClick={async () => { if (!target)
        return; setBusy(true); setError(''); try {
        await onMerge(target, prepend);
    }
    catch (caught) {
        setError((caught as Error).message);
    }
    finally {
        setBusy(false);
    } }}>{t("Merge notes")}</button></div></Modal>;
}
