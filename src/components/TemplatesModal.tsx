import { t, translateMessage } from '../i18n';
import { useState } from 'react';
import { FileText, X } from 'lucide-react';
import { Modal } from './NoteTools';
import type { NoteSummary } from '../types';
export function TemplatesModal({ files, folder, onClose, onChoose }: {
    files: NoteSummary[];
    folder: string;
    onClose: () => void;
    onChoose: (path: string) => Promise<void>;
}) {
    const [query, setQuery] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const choices = files.filter((file) => /\.md$/i.test(file.path) && (!folder || file.path.startsWith(`${folder}/`)) && file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return <Modal onClose={() => { if (!busy)
        onClose(); }}><div className="modal-heading"><h2>{t("Insert template")}</h2><button className="icon-button" aria-label={t("Close templates")} onClick={onClose}><X size={18}/></button></div><input autoFocus aria-label={t("Search templates")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search templates\u2026")}/><div className="choice-list template-choices">{choices.map((file) => <button key={file.path} disabled={busy} onClick={async () => { setBusy(true); try {
        await onChoose(file.path);
    }
    catch (caught) {
        setError((caught as Error).message);
    }
    finally {
        setBusy(false);
    } }}><FileText size={15}/><span>{file.path}</span></button>)}{!choices.length && <p className="muted">{t("Create notes in the folder") + " "}{folder || 'Templates'}{" " + t("and use them as templates. You can change the folder in settings.")}</p>}</div>{error && <p className="form-error">{translateMessage(error)}</p>}</Modal>;
}
