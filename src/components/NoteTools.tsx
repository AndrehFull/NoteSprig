import { t, translateMessage } from '../i18n';
import { LanguageSelector } from './LanguageSelector';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import { parse, stringify } from 'yaml';
import { api } from '../api';
import { BRAND } from '../brand';
import { readProperties, writeProperties } from './PropertiesPanel';
import type { NoteDocument } from '../types';
export function Login({ onLogin }: {
    onLogin: () => void;
}) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await api.login(password);
            onLogin();
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : t("Could not sign in."));
        }
        finally {
            setBusy(false);
        }
    }
    return (<main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark large"><span>{BRAND.name.charAt(0)}</span><i /></div>
        <LanguageSelector />
        <p className="eyebrow">{t("YOUR KNOWLEDGE SPACE")}</p>
        <h1>{BRAND.name}</h1>
        <p className="muted">{t("Sign in to open your personal vault.")}</p>
        <label htmlFor="password">{t("Password")}</label>
        <input autoFocus id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/>
        {error && <p className="form-error">{translateMessage(error)}</p>}
        <button className="primary-button full" disabled={busy} type="submit">
          <LockKeyhole size={16}/> {busy ? t("Signing in\u2026") : t("Sign in")}
        </button>
        <p className="login-footnote">{t("Your notes stay on your own server.")}</p>
      </form>
    </main>);
}
export function Modal({ children, onClose }: {
    children: ReactNode;
    onClose: () => void;
}) {
    const ref = useRef<HTMLElement>(null);
    const callback = useRef(onClose);
    callback.current = onClose;
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                callback.current();
                return;
            }
            if (event.key !== 'Tab' || !ref.current)
                return;
            const elements = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length);
            const first = elements[0], last = elements.at(-1);
            if (!first) {
                event.preventDefault();
                return;
            }
            if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };
        const heading = ref.current?.querySelector('h2');
        if (heading) {
            heading.id ||= `dialog-${crypto.randomUUID()}`;
            ref.current?.setAttribute('aria-labelledby', heading.id);
        }
        if (!ref.current?.contains(document.activeElement))
            ref.current?.querySelector<HTMLElement>('input,textarea,button')?.focus();
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            if (ref.current?.contains(document.activeElement) && previous?.isConnected)
                previous.focus();
        };
    }, []);
    return <div className="modal-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget)
                callback.current();
        }}><section ref={ref} className="modal-card" role="dialog" aria-modal="true">{children}</section></div>;
}
export function CreateNoteModal({ title, onClose, onCreate }: {
    title: string;
    onClose: () => void;
    onCreate: (title: string) => Promise<void>;
}) {
    const [value, setValue] = useState(title);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await onCreate(value);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : t("Could not create the note."));
        }
        finally {
            setBusy(false);
        }
    }
    return (<Modal onClose={onClose}>
      <div className="modal-heading"><div><span className="eyebrow">{t("NEW NOTE")}</span><h2>{t("Create page")}</h2></div><button className="icon-button" onClick={onClose} aria-label={t("Close")}><X size={18}/></button></div>
      <form onSubmit={submit}>
        <label htmlFor="note-title">{t("Note name")}</label>
        <input id="note-title" autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={t("E.g. Ideas")} required/>
        <p className="muted small">{t("Use a name or") + " "}<code>{t("Folder/Name")}</code>{" " + t("to organize the note.")}</p>
        {error && <p className="form-error">{translateMessage(error)}</p>}
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>{t("Cancel")}</button><button className="primary-button" disabled={busy}>{busy ? t("Creating\u2026") : t("Create note")}</button></div>
      </form>
    </Modal>);
}
export function TextActionModal({ title, initial, label, help, onClose, onSubmit }: {
    title: string;
    initial: string;
    label: string;
    help: string;
    onClose: () => void;
    onSubmit: (value: string) => Promise<void>;
}) {
    const [value, setValue] = useState(initial);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    async function submit(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            await onSubmit(value);
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : t("Could not complete the action."));
        }
        finally {
            setBusy(false);
        }
    }
    return <Modal onClose={onClose}><div className="modal-heading"><div><span className="eyebrow">{t("MARKDOWN NOTE")}</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label={t("Close")}><X size={18}/></button></div><form onSubmit={submit}><label htmlFor="action-value">{label}</label><input id="action-value" autoFocus value={value} onChange={(event) => setValue(event.target.value)} required/><p className="muted small">{help}</p>{error && <p className="form-error">{translateMessage(error)}</p>}<div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>{t("Cancel")}</button><button className="primary-button" disabled={busy}>{busy ? t("Saving\u2026") : t("Save")}</button></div></form></Modal>;
}
export function PropertiesModal({ note, onClose, onSave }: {
    note: NoteDocument;
    onClose: () => void;
    onSave: (content: string) => Promise<void>;
}) {
    type Row = {
        id: number;
        key: string;
        type: string;
        value: string;
    };
    const [rows, setRows] = useState<Row[]>(() => Object.entries(readProperties(note.content)).map(([key, value], index) => ({ id: index, key, type: Array.isArray(value) ? 'list' : typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : value && typeof value === 'object' ? 'json' : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? 'date' : 'text', value: Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '') })));
    const [source, setSource] = useState(false);
    const [yaml, setYaml] = useState(stringify(readProperties(note.content)));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    function change(id: number, patch: Partial<Row>) { setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row)); }
    async function submit(event: FormEvent) {
        event.preventDefault();
        setError('');
        setBusy(true);
        try {
            let properties: Record<string, unknown>;
            if (source) {
                const parsed = parse(yaml);
                if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed)))
                    throw new Error(t("Use name: value pairs."));
                properties = parsed || {};
            }
            else {
                const keys = rows.map((row) => row.key.trim());
                if (keys.some((key) => !key) || new Set(keys).size !== keys.length)
                    throw new Error(t("Properties must have unique names."));
                properties = Object.fromEntries(rows.map((row) => {
                    const value = row.type === 'list' ? row.value.split(',').map((item) => item.trim()).filter(Boolean) : row.type === 'checkbox' ? row.value === 'true' : row.type === 'number' ? Number(row.value) : row.type === 'json' ? JSON.parse(row.value) : row.value;
                    if (typeof value === 'number' && !Number.isFinite(value))
                        throw new Error(t("Invalid number."));
                    return [row.key.trim(), value];
                }));
            }
            await onSave(writeProperties(note.content, properties));
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : t("Could not save."));
        }
        finally {
            setBusy(false);
        }
    }
    return <Modal onClose={() => {
            if (!busy)
                onClose();
        }}><div className="modal-heading"><h2>{t("Properties")}</h2><button className="icon-button" onClick={onClose} aria-label={t("Close properties")}><X size={18}/></button></div><div className="property-mode"><button className={!source ? 'mode-button active' : 'mode-button'} onClick={() => setSource(false)}>{t("Visual")}</button><button className={source ? 'mode-button active' : 'mode-button'} onClick={() => { setYaml(stringify(Object.fromEntries(rows.map((row) => [row.key, row.type === 'list' ? row.value.split(',').map((item) => item.trim()).filter(Boolean) : row.type === 'checkbox' ? row.value === 'true' : row.type === 'number' ? Number(row.value) : row.value])))); setSource(true); }}>{t("YAML")}</button></div><form onSubmit={submit}>{source ? <textarea aria-label={t("YAML properties")} value={yaml} rows={10} onChange={(event) => setYaml(event.target.value)} spellCheck={false}/> : <div className="visual-properties">{rows.map((row) => <div key={row.id} className="visual-property-row"><input aria-label={t("Property {v0} name", { v0: row.id + 1 })} placeholder={t("Property")} value={row.key} onChange={(event) => change(row.id, { key: event.target.value, ...(['tags', 'aliases'].includes(event.target.value) ? { type: 'list' } : {}) })}/><select aria-label={t("Property {v0} type", { v0: row.id + 1 })} value={row.type} onChange={(event) => change(row.id, { type: event.target.value })}><option value="text">{t("Text")}</option><option value="list">{t("List")}</option><option value="number">{t("Number")}</option><option value="checkbox">{t("Checkbox")}</option><option value="date">{t("Date")}</option><option value="json">{t("Object")}</option></select>{row.type === 'checkbox' ? <input aria-label={t("Property {v0} value", { v0: row.id + 1 })} type="checkbox" checked={row.value === 'true'} onChange={(event) => change(row.id, { value: String(event.target.checked) })}/> : <input aria-label={t("Property {v0} value", { v0: row.id + 1 })} type={row.type === 'date' ? 'date' : row.type === 'number' ? 'number' : 'text'} placeholder={row.type === 'list' ? t("value, another value") : t("Value")} value={row.value} onChange={(event) => change(row.id, { value: event.target.value })}/>}<button className="mini-icon" aria-label={t("Remove property {v0}", { v0: row.id + 1 })} type="button" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}><X size={14}/></button></div>)}<button className="text-action" type="button" onClick={() => setRows((current) => [...current, { id: Date.now(), key: '', type: 'text', value: '' }])}>{t("+ Add property")}</button></div>}{error && <p className="form-error">{translateMessage(error)}</p>}<div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>{t("Cancel")}</button><button className="primary-button" disabled={busy}>{t("Apply")}</button></div></form></Modal>;
}
