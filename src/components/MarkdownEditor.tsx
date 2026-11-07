import { t, useLanguage, editorPhrases } from '../i18n';
import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { renderMarkdown } from '../markdown';
import { hydrateRichContent } from './RichPreview';
import type { NoteSummary } from '../types';
const activeEditors = new Map<string, EditorView>();
export function getEditorSelection(path: string) { const view = activeEditors.get(path); if (!view?.dom.isConnected)
    return null; const { from, to } = view.state.selection.main; return from === to ? null : { from, to, text: view.state.doc.sliceString(from, to) }; }
export function insertIntoEditor(path: string, text: string) { const view = activeEditors.get(path); if (!view?.dom.isConnected)
    return false; view.dispatch(view.state.replaceSelection(text)); view.focus(); return true; }
const refreshLive = StateEffect.define<null>();
type Options = {
    path: string;
    files: NoteSummary[];
    onOpen: (target: string, kind?: 'wiki' | 'markdown') => void;
    onUpload?: (files: File[]) => Promise<string>;
};
class HtmlWidget extends WidgetType {
    constructor(readonly source: string, readonly options: Options, readonly block = false) { super(); }
    eq(other: HtmlWidget) { return this.source === other.source && this.options.path === other.options.path && this.block === other.block; }
    toDOM() { const dom = document.createElement(this.block ? 'div' : 'span'); dom.className = this.block ? 'cm-live-block markdown-preview' : 'cm-live-inline'; dom.innerHTML = renderMarkdown(this.source); if (!this.block && dom.children.length === 1 && dom.firstElementChild?.tagName === 'P')
        dom.innerHTML = dom.firstElementChild.innerHTML; for (const anchor of dom.querySelectorAll('a')) {
        anchor.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); });
        anchor.addEventListener('click', (event) => { const href = anchor.getAttribute('href') || ''; event.preventDefault(); event.stopPropagation(); if (href.startsWith('#ob-note='))
            this.options.onOpen(decodeURIComponent(href.slice(9)), 'wiki');
        else if (/^https?:/i.test(href))
            window.open(href, '_blank', 'noopener,noreferrer');
        else
            this.options.onOpen(href, 'markdown'); });
    } void hydrateRichContent(dom, this.options.path, this.options.files, () => dom.dataset.disposed === 'true').catch(() => { }); return dom; }
    destroy(dom: HTMLElement) { dom.dataset.disposed = 'true'; }
    ignoreEvent(event: Event) { return event.type !== 'mousedown'; }
}
class LinkWidget extends WidgetType {
    constructor(readonly raw: string, readonly label: string, readonly options: Options) { super(); }
    eq(other: LinkWidget) { return this.raw === other.raw && this.label === other.label; }
    toDOM() { const anchor = document.createElement('a'); anchor.href = `#ob-note=${encodeURIComponent(this.raw)}`; anchor.textContent = this.label; anchor.className = 'cm-live-link'; anchor.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); this.options.onOpen(this.raw); }); anchor.addEventListener('mousedown', (event) => event.preventDefault()); return anchor; }
    ignoreEvent() { return true; }
}
class TaskWidget extends WidgetType {
    constructor(readonly checked: boolean, readonly position: number) { super(); }
    eq(other: TaskWidget) { return this.checked === other.checked && this.position === other.position; }
    toDOM(view: EditorView) { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = this.checked; input.className = 'cm-live-task'; input.setAttribute('aria-label', t("Toggle task")); input.addEventListener('change', () => view.dispatch({ changes: { from: this.position, to: this.position + 1, insert: input.checked ? 'x' : ' ' } })); return input; }
    ignoreEvent() { return true; }
}
class BulletWidget extends WidgetType {
    toDOM() { const element = document.createElement('span'); element.className = 'cm-live-bullet'; element.textContent = '•'; return element; }
}
function liveField(options: () => Options) {
    function build(state: EditorState) {
        const decorations: ReturnType<Decoration['range']>[] = [];
        const active = state.selection.ranges.map((range) => ({ from: state.doc.lineAt(range.from).from, to: state.doc.lineAt(range.to).to }));
        const selected = (from: number, to: number) => active.some((range) => range.from <= to && range.to >= from);
        const text = state.doc.toString();
        let skipTo = -1;
        const front = text.match(/^---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
        if (front?.index === 0 && !selected(0, front[0].length - 1)) {
            decorations.push(Decoration.replace({ block: true }).range(0, front[0].length));
            skipTo = front[0].length;
        }
        let codeEnd = -1;
        for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
            const line = state.doc.line(lineNumber);
            if (line.from < skipTo || line.from < codeEnd)
                continue;
            if (/^\s*\$\$\s*$/.test(line.text)) {
                let end = lineNumber + 1;
                while (end <= state.doc.lines && !/^\s*\$\$\s*$/.test(state.doc.line(end).text))
                    end++;
                if (end <= state.doc.lines) {
                    const to = state.doc.line(end).to;
                    if (!selected(line.from, to)) {
                        decorations.push(Decoration.replace({ widget: new HtmlWidget(text.slice(line.from, to), options(), true), block: true }).range(line.from, to));
                        skipTo = to;
                        continue;
                    }
                }
            }
            if (/^\s*>\s*\[![a-z-]+\]/i.test(line.text)) {
                let end = lineNumber + 1;
                while (end <= state.doc.lines && /^\s*>/.test(state.doc.line(end).text))
                    end++;
                const to = state.doc.line(end - 1).to;
                if (!selected(line.from, to)) {
                    decorations.push(Decoration.replace({ widget: new HtmlWidget(text.slice(line.from, to), options(), true), block: true }).range(line.from, to));
                    skipTo = to;
                    continue;
                }
            }
            if (/^\s*(`{3,}|~{3,})/.test(line.text)) {
                const marker = line.text.trim().match(/^(`{3,}|~{3,})/)![1];
                let end = lineNumber + 1;
                while (end <= state.doc.lines && !state.doc.line(end).text.trim().startsWith(marker))
                    end++;
                if (end <= state.doc.lines) {
                    const last = state.doc.line(end);
                    codeEnd = last.to;
                    if (!selected(line.from, last.to))
                        decorations.push(Decoration.replace({ widget: new HtmlWidget(text.slice(line.from, last.to), options(), true), block: true }).range(line.from, last.to));
                    else
                        decorations.push(Decoration.line({ class: 'cm-live-code-line' }).range(line.from));
                }
                continue;
            }
            if (lineNumber < state.doc.lines && line.text.includes('|') && /^\s*\|?\s*:?-{3,}/.test(state.doc.line(lineNumber + 1).text)) {
                let end = lineNumber + 2;
                while (end <= state.doc.lines && state.doc.line(end).text.includes('|') && state.doc.line(end).text.trim())
                    end++;
                const to = state.doc.line(end - 1).to;
                if (!selected(line.from, to)) {
                    decorations.push(Decoration.replace({ widget: new HtmlWidget(text.slice(line.from, to), options(), true), block: true }).range(line.from, to));
                    skipTo = to;
                    continue;
                }
            }
            const heading = line.text.match(/^(#{1,6})\s+/);
            if (heading)
                decorations.push(Decoration.line({ class: `cm-live-heading cm-live-h${heading[1].length}` }).range(line.from));
            if (selected(line.from, line.to))
                continue;
            if (/^\s*!\[\[.+\]\]\s*$/.test(line.text) || /^\s*!\[[^\]]*\]\(.+\)\s*$/.test(line.text) || /^\s*\$\$.*\$\$\s*$/.test(line.text)) {
                decorations.push(Decoration.replace({ widget: new HtmlWidget(line.text, options(), true), block: true }).range(line.from, line.to));
                continue;
            }
            if (heading)
                decorations.push(Decoration.replace({}).range(line.from, line.from + heading[0].length));
            const task = line.text.match(/^(\s*[-*+]\s+)\[([ xX])\]\s*/);
            if (task) {
                const position = line.from + task[1].length + 1;
                decorations.push(Decoration.replace({ widget: new TaskWidget(Boolean(task[2].trim()), position) }).range(line.from + line.text.match(/^\s*/)![0].length, line.from + task[0].length));
            }
            else {
                const bullet = line.text.match(/^(\s*)[-*+]\s+/);
                if (bullet)
                    decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(line.from + bullet[1].length, line.from + bullet[0].length));
            }
            const quote = line.text.match(/^\s*>\s?/);
            if (quote) {
                decorations.push(Decoration.line({ class: 'cm-live-quote' }).range(line.from));
                decorations.push(Decoration.replace({}).range(line.from, line.from + quote[0].length));
            }
            const occupied: {
                from: number;
                to: number;
            }[] = [];
            function replace(from: number, to: number, decoration: Decoration) { if (occupied.some((range) => from < range.to && to > range.from))
                return; occupied.push({ from, to }); decorations.push(decoration.range(line.from + from, line.from + to)); }
            for (const match of line.text.matchAll(/`([^`]+)`/g))
                replace(match.index!, match.index! + match[0].length, Decoration.replace({ widget: new HtmlWidget(match[0], options()) }));
            for (const match of line.text.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
                const [target, label] = match[1].split('|');
                replace(match.index!, match.index! + match[0].length, Decoration.replace({ widget: match[0].startsWith('!') ? new HtmlWidget(match[0], options()) : new LinkWidget(target, label || target, options()) }));
            }
            for (const match of line.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g))
                replace(match.index!, match.index! + match[0].length, Decoration.replace({ widget: new HtmlWidget(match[0], options()) }));
            for (const match of line.text.matchAll(/\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=]+)==|\$([^$]+)\$/g))
                replace(match.index!, match.index! + match[0].length, Decoration.replace({ widget: new HtmlWidget(match[0], options()) }));
            for (const match of line.text.matchAll(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g))
                replace(match.index!, match.index! + match[0].length, Decoration.replace({ widget: new HtmlWidget(match[0], options()) }));
            if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line.text) && !heading)
                decorations.push(Decoration.line({ class: 'cm-live-rule' }).range(line.from));
        }
        return Decoration.set(decorations, true);
    }
    const selectionLines = (state: EditorState) => state.selection.ranges.map((range) => `${state.doc.lineAt(range.from).number}:${state.doc.lineAt(range.to).number}`).join(',');
    return StateField.define<DecorationSet>({ create: build, update(value, transaction) { return transaction.docChanged || transaction.selection && selectionLines(transaction.startState) !== selectionLines(transaction.state) || transaction.effects.some((effect) => effect.is(refreshLive)) ? build(transaction.state) : value; }, provide: (field) => EditorView.decorations.from(field) });
}
export default function MarkdownEditor({ path, value, onChange, live = true, files = [], onOpen = () => { }, onUpload }: {
    path: string;
    value: string;
    onChange: (value: string) => void;
    live?: boolean;
    files?: NoteSummary[];
    onOpen?: (target: string, kind?: 'wiki' | 'markdown') => void;
    onUpload?: (files: File[]) => Promise<string>;
}) {
    const language = useLanguage();
    const phrases = useRef(new Compartment()).current;
    const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null);
    const callbacks = useRef({ onChange, options: { path, files, onOpen, onUpload } });
    callbacks.current = { onChange, options: { path, files, onOpen, onUpload } };
    const applying = useRef(false);
    useEffect(() => {
        if (!host.current)
            return;
        const options = () => ({ ...callbacks.current.options, onOpen: (target: string, kind?: 'wiki' | 'markdown') => callbacks.current.options.onOpen(target, kind) });
        function complete(context: CompletionContext) {
            const link = context.matchBefore(/\[\[[^\]\n]*/);
            if (link)
                return { from: link.from + 2, options: options().files.filter((file) => file.kind !== 'folder').map((file) => ({ label: file.path.replace(/\.md$/i, ''), type: file.kind === 'canvas' ? 'class' : 'text', apply: (instance: EditorView, completion: {
                            label: string;
                        }, from: number, to: number) => { const suffix = instance.state.doc.sliceString(to, to + 2) === ']]' ? '' : ']]'; instance.dispatch({ changes: { from, to, insert: completion.label + suffix }, selection: { anchor: from + completion.label.length + 2 } }); } })), validFor: /[^\]\n]*/ };
            const tag = context.matchBefore(/#[\p{L}\p{N}_/-]*/u);
            if (tag && tag.to === context.pos)
                return { from: tag.from + 1, options: [...new Set(options().files.flatMap((file) => file.tags))].map((label) => ({ label, type: 'keyword' })) };
            return null;
        }
        const wrap = (mark: string) => (instance: EditorView) => { const { from, to } = instance.state.selection.main; const selected = instance.state.doc.sliceString(from, to); instance.dispatch({ changes: { from, to, insert: `${mark}${selected}${mark}` }, selection: { anchor: from + mark.length, head: to + mark.length } }); return true; };
        const front = value.match(/^---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
        const state = EditorState.create({ doc: value, selection: { anchor: live && front?.index === 0 ? front[0].length : 0 }, extensions: [
                basicSetup, markdown(), EditorView.lineWrapping, phrases.of(EditorState.phrases.of(editorPhrases())),
                syntaxHighlighting(HighlightStyle.define([{ tag: tags.heading, fontWeight: '700', textDecoration: 'none', color: 'var(--text)' }, { tag: tags.link, color: 'var(--accent)', textDecoration: 'none' }, { tag: tags.processingInstruction, color: 'var(--subtle)' }, { tag: tags.strong, fontWeight: '700' }, { tag: tags.emphasis, fontStyle: 'italic' }, { tag: tags.strikethrough, textDecoration: 'line-through' }, { tag: tags.keyword, color: '#b794dc' }, { tag: tags.string, color: '#9aba8c' }, { tag: tags.number, color: '#d8a778' }, { tag: tags.comment, color: 'var(--subtle)' }])),
                autocompletion({ override: [complete] }), keymap.of([{ key: 'Mod-b', run: wrap('**') }, { key: 'Mod-i', run: wrap('*') }, { key: 'Mod-Shift-x', run: wrap('~~') }]),
                ...(live ? [liveField(options)] : []),
                EditorView.domEventHandlers({ focus(_event, instance) { activeEditors.set(path, instance); return false; }, click(event) { const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a'); if (anchor?.getAttribute('href')?.startsWith('#ob-note=')) {
                        event.preventDefault();
                        options().onOpen(decodeURIComponent(anchor.getAttribute('href')!.slice(9)));
                        return true;
                    } return false; }, mousedown(event, instance) { if (!(event.ctrlKey || event.metaKey))
                        return false; const position = instance.posAtCoords({ x: event.clientX, y: event.clientY }); if (position === null)
                        return false; const line = instance.state.doc.lineAt(position); for (const match of line.text.matchAll(/!?\[\[([^\]]+)\]\]/g))
                        if (position >= line.from + match.index! && position <= line.from + match.index! + match[0].length) {
                            event.preventDefault();
                            options().onOpen(match[1].split('|')[0]);
                            return true;
                        } return false; }, paste(event, instance) { const pasted = [...(event.clipboardData?.files || [])]; if (!pasted.length || !options().onUpload)
                        return false; event.preventDefault(); void options().onUpload!(pasted).then((text) => { if (instance.dom.isConnected)
                        instance.dispatch(instance.state.replaceSelection(text)); }).catch(() => { }); return true; } }),
                EditorView.updateListener.of((update) => { if (update.view.hasFocus)
                    activeEditors.set(path, update.view); if (update.docChanged && !applying.current)
                    callbacks.current.onChange(update.state.doc.toString()); }),
            ] });
        const instance = new EditorView({ state, parent: host.current });
        view.current = instance;
        activeEditors.set(path, instance);
        return () => { instance.destroy(); if (activeEditors.get(path) === instance)
            activeEditors.delete(path); if (view.current === instance)
            view.current = null; };
    }, [path, live]);
    useEffect(() => { view.current?.dispatch({ effects: [phrases.reconfigure(EditorState.phrases.of(editorPhrases())), refreshLive.of(null)] }); }, [language, phrases]);
    useEffect(() => { const instance = view.current; if (!instance || instance.state.doc.toString() === value)
        return; applying.current = true; instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) }); applying.current = false; }, [value]);
    useEffect(() => { if (live)
        view.current?.dispatch({ effects: refreshLive.of(null) }); }, [files, live]);
    return <div className={`markdown-editor-host ${live ? 'live-preview-editor' : 'source-editor'}`} ref={host} aria-label={live ? t("Live Preview editor") : t("Markdown editor")}/>;
}
