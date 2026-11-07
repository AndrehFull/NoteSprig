import { t } from '../i18n';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from './NoteTools';
export type Choice = {
    id: string;
    label: string;
    detail?: string;
    shortcut?: string;
    run: () => void;
};
export function CommandPicker({ title, choices, onClose }: {
    title: string;
    choices: Choice[];
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const filtered = useMemo(() => choices.filter((choice) => `${choice.label} ${choice.detail || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [choices, query]);
    function choose(choice: Choice) { onClose(); choice.run(); }
    return <Modal onClose={onClose}>
    <div className="picker-search"><Search size={18}/><input autoFocus placeholder={title} aria-label={title} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((value) => Math.min(value + 1, filtered.length - 1));
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((value) => Math.max(value - 1, 0));
            }
            if (event.key === 'Enter' && filtered[selected]) {
                event.preventDefault();
                choose(filtered[selected]);
            }
        }}/></div>
    <div className="picker-results" role="listbox" aria-label={title}>{filtered.map((choice, index) => <button key={choice.id} role="option" aria-selected={index === selected} className={index === selected ? 'selected' : ''} onMouseMove={() => setSelected(index)} onClick={() => choose(choice)}><span>{choice.label}{choice.detail && <small>{choice.detail}</small>}</span>{choice.shortcut && <kbd>{choice.shortcut}</kbd>}</button>)}{!filtered.length && <p className="muted">{t("No results.")}</p>}</div><div className="picker-footer">{t("\u2191 \u2193 to navigate \u00B7 Enter to open \u00B7 Esc to close")}</div>
  </Modal>;
}
