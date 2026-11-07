import { t, getLocale, useLanguage, translateMessage } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { parseDocument, stringify } from 'yaml';
import { Code, Download, Plus, Search, Table2 } from 'lucide-react';
import { evaluateBase, matchesBaseFilter, type BaseRow } from '../bases';
import { baseName } from '../knowledge';
import { getLocal } from '../storage';
import { readProperties } from './PropertiesPanel';
import type { NoteDocument, NoteSummary } from '../types';
type View = Record<string, unknown> & {
    type?: string;
    name?: string;
    order?: string[];
    filters?: unknown;
    sort?: {
        property: string;
        direction?: string;
    }[];
    groupBy?: {
        property: string;
        direction?: string;
    };
    limit?: number;
};
const format = (value: unknown): string => value == null ? '' : value instanceof Date ? value.toLocaleString(getLocale()) : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function BasesView({ content, files, onChange, onOpen, load, onPropertyChange, onNotice }: {
    content: string;
    files: NoteSummary[];
    onChange: (content: string) => void;
    onOpen: (path: string) => void;
    load: (path: string) => Promise<NoteDocument>;
    onPropertyChange: (path: string, property: string, value: unknown) => Promise<void>;
    onNotice: (message: string) => void;
}) {
    const language = useLanguage();
    const [index, setIndex] = useState(0), [source, setSource] = useState(false), [search, setSearch] = useState(''), [loading, setLoading] = useState(true), [rows, setRows] = useState<BaseRow[]>([]), [columnsOpen, setColumnsOpen] = useState(false), [newGroup, setNewGroup] = useState('');
    const parsed = useMemo(() => {
        try {
            const document = parseDocument(content || 'views: []');
            if (document.errors.length)
                throw document.errors[0];
            const data = document.toJS({ maxAliasCount: 50 });
            JSON.stringify(data);
            if (!data || typeof data !== 'object' || Array.isArray(data))
                throw new Error(t("A base must contain a YAML object."));
            return { data: data as Record<string, unknown>, error: '' };
        }
        catch (error) {
            return { data: {} as Record<string, unknown>, error: (error as Error).message };
        }
    }, [content]);
    const config = parsed.data;
    const views = Array.isArray(config.views) && config.views.length ? config.views as View[] : [{ type: 'table', name: t("Table"), order: ['file.name', 'note.tags'] }];
    const view = views[Math.min(index, views.length - 1)];
    const formulas = (config.formulas || {}) as Record<string, string>;
    function updateView(patch: Partial<View>) { const next = views.map((entry, i) => i === Math.min(index, views.length - 1) ? { ...entry, ...patch } : entry); onChange(stringify({ ...config, views: next })); }
    useEffect(() => {
        let cancelled = false;
        const selected = files.filter((file) => file.kind !== 'folder');
        const next: BaseRow[] = selected.map((file) => ({ file, properties: {} }));
        let cursor = 0;
        setLoading(true);
        void Promise.all(Array.from({ length: 3 }, async () => {
            while (cursor < next.length) {
                const row = next[cursor++];
                if (!/\.md$/i.test(row.file.path))
                    continue;
                try {
                    const cached = await getLocal<NoteDocument>(`doc:${row.file.path}`);
                    const note = cached && cached.mtime === row.file.mtime ? cached : await load(row.file.path);
                    row.properties = readProperties(note.content);
                }
                catch { /* File metadata is still shown. */ }
            }
        })).then(() => {
            if (!cancelled) {
                setRows(next);
                setLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [files, load]);
    const properties = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row.properties)))].sort(), [rows]);
    const available = ['file.name', 'file.folder', 'file.ext', 'file.size', 'file.mtime', ...properties.map((key) => `note.${key}`), ...Object.keys(formulas).map((key) => `formula.${key}`)];
    const columns = view.order?.length ? view.order : ['file.name', ...properties.slice(0, 5).map((key) => `note.${key}`)];
    function value(row: BaseRow, column: string) { return column.startsWith('file.') ? evaluateBase(column, row, formulas) : column.startsWith('formula.') ? evaluateBase(`formula[${JSON.stringify(column.slice(8))}]`, row, formulas) : row.properties[column.replace(/^note\./, '')]; }
    const results = useMemo(() => {
        try {
            let selected = rows.filter((row) => matchesBaseFilter(config.filters, row, formulas) && matchesBaseFilter(view.filters, row, formulas));
            if (search.trim())
                selected = selected.filter((row) => columns.some((column) => format(value(row, column)).toLocaleLowerCase().includes(search.toLocaleLowerCase())));
            selected = [...selected].sort((a, b) => {
                for (const sort of view.sort || []) {
                    const av = value(a, sort.property), bv = value(b, sort.property);
                    const comparison = av instanceof Date && bv instanceof Date ? av.getTime() - bv.getTime() : typeof av === 'number' && typeof bv === 'number' ? av - bv : format(av).localeCompare(format(bv), getLocale(), { numeric: true });
                    if (comparison)
                        return comparison * (sort.direction === 'DESC' ? -1 : 1);
                }
                return a.file.path.localeCompare(b.file.path, getLocale(), { numeric: true });
            });
            if (view.limit && view.limit > 0)
                selected = selected.slice(0, view.limit);
            // Evaluate displayed formulas here so an unsupported expression is visible before rendering cells.
            for (const row of selected)
                for (const column of columns)
                    value(row, column);
            return { rows: selected, error: '' };
        }
        catch (error) {
            return { rows: [] as BaseRow[], error: (error as Error).message };
        }
    }, [rows, config, view, search, language]);
    function title(column: string) {
        const properties = config.properties as Record<string, {
            displayName?: string;
        }> | undefined;
        return properties?.[column]?.displayName || column.replace(/^note\./, '').replace('file.name', t("File")).replace('file.folder', t("Folder")).replace('file.mtime', t("Modified"));
    }
    function saveCell(row: BaseRow, column: string, text: string) {
        const key = column.replace(/^note\./, '');
        let next: unknown = text;
        try {
            const original = row.properties[key];
            if (typeof original === 'number') {
                next = Number(text);
                if (!Number.isFinite(next))
                    throw new Error(t("Invalid number."));
            }
            else if (Array.isArray(original) || key === 'tags' || key === 'aliases')
                next = text.split(',').map((value) => value.trim()).filter(Boolean);
            else if (typeof original === 'boolean')
                next = text === 'true';
            void onPropertyChange(row.file.path, key, next).catch((error: Error) => onNotice(error.message));
        }
        catch (error) {
            onNotice((error as Error).message);
        }
    }
    function exportCsv() { const csv = [columns.map(title), ...results.rows.map((row) => columns.map((column) => format(value(row, column))))].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${view.name || 'Base'}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    const grouped = new Map<string, BaseRow[]>();
    const grouping = view.groupBy?.property || (view.type === 'kanban' ? 'note.status' : '');
    if (grouping && !results.error)
        for (const row of results.rows) {
            let group = '';
            try {
                group = format(value(row, grouping));
            }
            catch {
                group = '';
            }
            if (!grouped.has(group))
                grouped.set(group, []);
            grouped.get(group)!.push(row);
        }
    if (view.type === 'kanban')
        for (const group of Array.isArray(view.groupOrder) ? view.groupOrder as string[] : [])
            if (!grouped.has(group))
                grouped.set(group, []);
    const groups = grouping ? [...grouped].sort((a, b) => a[0].localeCompare(b[0], getLocale()) * (view.groupBy?.direction === 'DESC' ? -1 : 1)) : [['', results.rows] as [
            string,
            BaseRow[]
        ]];
    const card = (row: BaseRow) => <button key={row.file.path} className="base-card" draggable={view.type === 'kanban'} onDragStart={(event) => event.dataTransfer.setData('text/x-notesprig-row', row.file.path)} onClick={() => onOpen(row.file.path)}><strong>{baseName(row.file.path)}</strong>{columns.filter((column) => column !== 'file.name').map((column) => <span key={column}><small>{title(column)}</small>{format(value(row, column))}</span>)}</button>;
    return <section className="bases-view" aria-label={t("Property base")}><div className="bases-toolbar"><Table2 size={17}/><select aria-label={t("Base view")} value={Math.min(index, views.length - 1)} onChange={(event) => setIndex(+event.target.value)}>{views.map((view, index) => <option key={index} value={index}>{view.name || t("View {v0}", { v0: index + 1 })}</option>)}</select><button className="icon-button" aria-label={t("Add view")} onClick={() => { onChange(stringify({ ...config, views: [...views, { type: 'table', name: t("View {v0}", { v0: views.length + 1 }), order: ['file.name'] }] })); setIndex(views.length); }}><Plus size={15}/></button><select aria-label={t("Base layout")} value={view.type || 'table'} onChange={(event) => updateView({ type: event.target.value, ...(event.target.value === 'kanban' && !view.groupBy ? { groupBy: { property: 'note.status', direction: 'ASC' } } : {}) })}><option value="table">{t("Table")}</option><option value="cards">{t("Cards")}</option><option value="list">{t("List")}</option><option value="kanban">{t("Kanban")}</option></select><span className="base-results">{loading ? t("Loading\u2026") : t("{v0} results", { v0: results.rows.length })}</span><button className="mode-button" onClick={() => setColumnsOpen(!columnsOpen)}>{t("Properties")}</button><button className={`icon-button ${source ? 'active' : ''}`} aria-label={t("Edit base source")} onClick={() => setSource(!source)}><Code size={16}/></button><button className="icon-button" aria-label={t("Export base as CSV")} onClick={exportCsv}><Download size={16}/></button></div><div className="base-filterbar"><label><Search size={14}/><input aria-label={t("Search base")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search results\u2026")}/></label><select aria-label={t("Sort base")} value={view.sort?.[0]?.property || ''} onChange={(event) => updateView({ sort: event.target.value ? [{ property: event.target.value, direction: 'ASC' }] : [] })}><option value="">{t("Sort\u2026")}</option>{available.map((column) => <option key={column} value={column}>{title(column)}</option>)}</select><select aria-label={t("Group base")} value={grouping} onChange={(event) => updateView({ groupBy: event.target.value ? { property: event.target.value, direction: 'ASC' } : undefined })}><option value="">{t("No grouping")}</option>{available.map((column) => <option key={column} value={column}>{title(column)}</option>)}</select></div>
    {!['table', 'cards', 'list', 'kanban'].includes(view.type || 'table') && <div className="base-error" role="status">{t("The view \u201C")}{view.type}{t("\u201D requires an unsupported feature. Results are shown as cards; the original configuration remains in YAML.")}</div>}
    {columnsOpen && <div className="base-columns">{available.map((column) => <label key={column}><input type="checkbox" checked={columns.includes(column)} onChange={(event) => updateView({ order: event.target.checked ? [...columns, column] : columns.filter((entry) => entry !== column) })}/>{title(column)}</label>)}</div>}
    {(parsed.error || results.error) && <div className="base-error" role="status">{translateMessage(parsed.error || results.error)} <button className="text-action" onClick={() => setSource(true)}>{t("Edit YAML source")}</button></div>}
    {source ? <textarea className="base-source" aria-label={t("Base YAML source")} value={content} spellCheck={false} onChange={(event) => onChange(event.target.value)}/> : <div className={`base-content base-layout-${view.type || 'table'}`}>{groups.map(([group, groupedRows]) => <div key={group} className="base-group" onDragOver={(event) => {
                    if (view.type === 'kanban')
                        event.preventDefault();
                }} onDrop={(event) => {
                    event.preventDefault();
                    const path = event.dataTransfer.getData('text/x-notesprig-row');
                    if (path && grouping && !grouping.startsWith('file.') && !grouping.startsWith('formula.'))
                        void onPropertyChange(path, grouping.replace(/^note\./, ''), group || null).catch((error: Error) => onNotice(error.message));
                }}>{grouping && <h3>{group || t("No value")} <span>{groupedRows.length}</span></h3>}{view.type === 'table' || !view.type ? <table><thead><tr>{columns.map((column) => <th key={column}>{title(column)}</th>)}</tr></thead><tbody>{groupedRows.map((row) => <tr key={row.file.path}>{columns.map((column) => <td key={column}>{column === 'file.name' ? <button className="base-file-link" onClick={() => onOpen(row.file.path)}>{baseName(row.file.path)}</button> : /\.md$/i.test(row.file.path) && !column.startsWith('file.') && !column.startsWith('formula.') ? typeof value(row, column) === 'boolean' ? <input type="checkbox" aria-label={t("{v0} of {v1}", { v0: column, v1: baseName(row.file.path) })} checked={Boolean(value(row, column))} onChange={(event) => void onPropertyChange(row.file.path, column.replace(/^note\./, ''), event.target.checked).catch((error: Error) => onNotice(error.message))}/> : <input key={format(value(row, column))} aria-label={t("{v0} of {v1}", { v0: column, v1: baseName(row.file.path) })} defaultValue={format(value(row, column))} onBlur={(event) => {
                                    if (event.target.value !== format(value(row, column)))
                                        saveCell(row, column, event.target.value);
                                }} onKeyDown={(event) => {
                                    if (event.key === 'Enter')
                                        event.currentTarget.blur();
                                }}/> : <span>{format(value(row, column))}</span>}</td>)}</tr>)}</tbody></table> : view.type === 'list' ? <ul>{groupedRows.map((row) => <li key={row.file.path}><button className="base-file-link" onClick={() => onOpen(row.file.path)}>{baseName(row.file.path)}</button>{columns.filter((column) => column !== 'file.name').map((column) => <span key={column}>{format(value(row, column))}</span>)}</li>)}</ul> : <div className="base-cards">{groupedRows.map(card)}</div>}</div>)}{view.type === 'kanban' && <form className="base-new-group" onSubmit={(event) => {
                    event.preventDefault();
                    if (newGroup.trim()) {
                        updateView({ groupOrder: [...(Array.isArray(view.groupOrder) ? view.groupOrder : []), newGroup.trim()] });
                        setNewGroup('');
                    }
                }}><input aria-label={t("New Kanban column")} placeholder={t("New column\u2026")} value={newGroup} onChange={(event) => setNewGroup(event.target.value)}/><button className="icon-button" aria-label={t("Create column")}><Plus size={16}/></button></form>}</div>}
  </section>;
}
