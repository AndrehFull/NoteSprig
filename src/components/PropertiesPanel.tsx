import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Settings2 } from 'lucide-react';
import { parseDocument, stringify } from 'yaml';
export function readProperties(content: string): Record<string, unknown> {
    const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m);
    if (!match || match.index !== 0)
        return {};
    try {
        const document = parseDocument(match[1]);
        if (document.errors.length)
            return {};
        const data = document.toJS({ maxAliasCount: 50 });
        JSON.stringify(data);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    }
    catch {
        return {};
    }
}
export function writeProperties(content: string, properties: Record<string, unknown>) {
    const match = content.match(/^---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
    const body = match?.index === 0 ? content.slice(match[0].length) : content;
    return Object.keys(properties).length ? `---\n${stringify(properties)}---\n${body}` : body;
}
function PropertyCell({ name, value, onChange }: {
    name: string;
    value: unknown;
    onChange: (value: unknown) => void;
}) {
    const format = (value: unknown) => Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    const [text, setText] = useState(format(value));
    const focused = useRef(false);
    useEffect(() => { if (!focused.current)
        setText(format(value)); }, [value]);
    if (typeof value === 'boolean')
        return <input aria-label={t("Property {v0}", { v0: name })} type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)}/>;
    return <input aria-label={t("Property {v0}", { v0: name })} value={text} type={typeof value === 'number' ? 'number' : 'text'} onFocus={() => { focused.current = true; }} onChange={(event) => setText(event.target.value)} onBlur={() => { focused.current = false; try {
        const next = Array.isArray(value) ? text.split(',').map((item) => item.trim()).filter(Boolean) : typeof value === 'number' ? Number(text) : typeof value === 'object' && value !== null ? JSON.parse(text) : text;
        if (typeof next === 'number' && !Number.isFinite(next))
            return;
        onChange(next);
    }
    catch {
        setText(format(value));
    } }} onKeyDown={(event) => { if (event.key === 'Enter')
        event.currentTarget.blur(); }}/>;
}
export function PropertiesPanel({ content, onChange, onEdit }: {
    content: string;
    onChange: (content: string) => void;
    onEdit: () => void;
}) {
    const properties = useMemo(() => readProperties(content), [content]);
    return <details className="inline-properties" open={Object.keys(properties).length > 0 || undefined}><summary><ChevronDown size={13}/>{" " + t("Properties")}<button className="mini-icon" aria-label={t("Edit all properties")} onClick={(event) => { event.preventDefault(); onEdit(); }}><Settings2 size={13}/></button></summary><div>{Object.entries(properties).map(([key, value]) => <div className="inline-property" key={key}><span>{key}</span><PropertyCell name={key} value={value} onChange={(next) => onChange(writeProperties(content, { ...properties, [key]: next }))}/></div>)}<button className="text-action" onClick={onEdit}><Plus size={13}/>{" " + t("Add property")}</button></div></details>;
}
