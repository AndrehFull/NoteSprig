import { t } from './i18n';
import DOMPurify from 'dompurify';
import { marked, type Tokens } from 'marked';
import { headingId } from './paths';
export { normalizeTarget } from './paths';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
marked.use({ extensions: [
        { name: 'footnote', level: 'inline', start: (source) => source.indexOf('[^'), tokenizer(source) {
                const match = source.match(/^\[\^([^\]\n]+)\]/);
                if (match)
                    return { type: 'footnote', raw: match[0], text: match[1] };
            }, renderer(token) { const id = encodeURIComponent(String(token.text)); return `<sup class="footnote-ref" data-footnote-id="${id}"><a href="#fn-${id}" id="fnref-${id}">${escape(String(token.text))}</a></sup>`; } },
        { name: 'comment', level: 'inline', start: (source) => source.indexOf('%%'), tokenizer(source) {
                const match = source.match(/^%%[\s\S]*?%%/);
                if (match)
                    return { type: 'comment', raw: match[0] };
            }, renderer() { return ''; } },
        { name: 'wikilink', level: 'inline', start: (source) => source.search(/!?\[\[/), tokenizer(source) {
                const match = source.match(/^(!?)\[\[([^\]\n]+)\]\]/);
                if (match)
                    return { type: 'wikilink', raw: match[0], embed: match[1] === '!', target: match[2].split('|')[0], label: match[2].split('|').slice(1).join('|') };
            }, renderer(token) {
                const item = token as Tokens.Generic & {
                    target: string;
                    label: string;
                    embed: boolean;
                };
                if (item.embed)
                    return `<span class="notesprig-embed" data-notesprig-embed="${encodeURIComponent(item.target)}" data-embed-label="${escape(item.label || '')}"><a href="#ob-note=${encodeURIComponent(item.target)}">${escape(item.label || item.target)}</a></span>`;
                return `<a class="internal-link" href="#ob-note=${encodeURIComponent(item.target)}">${escape(item.label || item.target)}</a>`;
            } },
        { name: 'mathInline', level: 'inline', start: (source) => source.indexOf('$'), tokenizer(source) {
                const match = source.match(/^\$([^$\n]+?)\$(?!\d)/);
                if (match)
                    return { type: 'mathInline', raw: match[0], text: match[1] };
            }, renderer(token) { return `<span class="math-inline" data-math="${encodeURIComponent(String(token.text))}">${escape(String(token.text))}</span>`; } },
        { name: 'mathBlock', level: 'block', start: (source) => source.indexOf('$$'), tokenizer(source) {
                const match = source.match(/^\$\$\s*\n?([\s\S]*?)\n?\$\$\s*(?:\n|$)/);
                if (match)
                    return { type: 'mathBlock', raw: match[0], text: match[1] };
            }, renderer(token) { return `<div class="math-block" data-math="${encodeURIComponent(String(token.text))}">${escape(String(token.text))}</div>`; } },
        { name: 'blockId', level: 'inline', start: (source) => source.search(/\^[a-z\d-]+(?:\s|$)/i), tokenizer(source) {
                const match = source.match(/^\^([a-z\d-]+)(?=\s*(?:\n|$))/i);
                if (match)
                    return { type: 'blockId', raw: match[0], text: match[1] };
            }, renderer(token) { return `<span class="block-reference" id="block-${escape(String(token.text))}" data-block-id="${escape(String(token.text))}"></span>`; } },
        { name: 'highlight', level: 'inline', start: (source) => source.indexOf('=='), tokenizer(source) {
                const match = source.match(/^==([^=\n]+)==/);
                if (match)
                    return { type: 'highlight', raw: match[0], text: match[1] };
            }, renderer(token) { return `<mark>${escape(String(token.text))}</mark>`; } },
    ], renderer: {
        checkbox({ checked }) { return `<input type="checkbox" data-task${checked ? ' checked=""' : ''} disabled="">`; },
        heading({ tokens, depth }) { const text = this.parser.parseInline(tokens); return `<h${depth} id="${escape(headingId(text))}">${text}</h${depth}>\n`; },
        image({ href, text, title }) { const external = /^https?:\/\//i.test(href); return `<img ${external ? `src="${escape(href)}"` : `data-local-image="${encodeURIComponent(href)}"`} alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy" referrerpolicy="no-referrer">`; },
        blockquote({ tokens }) {
            const html = this.parser.parse(tokens);
            const match = html.match(/^<p>\[!([a-z-]+)\]([+-])?\s*([^\n<]*)(?:\n|<br>)?/i);
            if (!match)
                return `<blockquote>${html}</blockquote>`;
            const names: Record<string, string> = { note: t("Note"), tip: t("Tip"), info: t("Information"), warning: t("Warning"), danger: t("Danger"), example: t("Example"), quote: t("Quote"), success: t("Done"), todo: t("To do") };
            const title = match[3] || names[match[1]] || match[1];
            const body = html.slice(match[0].length).replace(/^<\/p>/, '');
            return match[2] ? `<details class="callout" data-callout="${escape(match[1])}"${match[2] === '+' ? ' open' : ''}><summary>${title}</summary><div>${body}</div></details>` : `<aside class="callout" data-callout="${escape(match[1])}"><div class="callout-title">${title}</div><div>${body}</div></aside>`;
        },
        code({ text, lang }) { return lang?.trim() === 'mermaid' ? `<pre class="mermaid-source" data-mermaid="${encodeURIComponent(text)}">${escape(text)}</pre>` : `<pre><code${lang ? ` class="language-${escape(lang.split(' ')[0])}"` : ''}>${escape(text)}</code></pre>`; },
    } });
export function stripFrontmatter(source: string) {
    if (!/^\uFEFF?---[ \t]*\r?\n/.test(source))
        return source;
    const match = source.match(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
    return match?.index === 0 ? source.slice(match[0].length) : source;
}
export function renderMarkdown(source: string) {
    const definitions = new Map<string, string>();
    const lines = stripFrontmatter(source).split('\n');
    let fence = '';
    for (let i = 0; i < lines.length; i++) {
        const marker = lines[i].match(/^\s*(`{3,}|~{3,})/);
        if (marker) {
            fence = fence ? '' : marker[1][0];
            continue;
        }
        if (fence)
            continue;
        const definition = lines[i].match(/^\[\^([^\]]+)\]:[ \t]*(.*)$/);
        if (!definition)
            continue;
        const content = [definition[2]];
        lines[i] = '';
        while (i + 1 < lines.length && /^(?: {4}|\t)/.test(lines[i + 1])) {
            i++;
            content.push(lines[i].replace(/^(?: {4}|\t)/, ''));
            lines[i] = '';
        }
        definitions.set(definition[1], content.join('\n'));
    }
    let html = marked.parse(lines.join('\n'), { gfm: true, breaks: false }) as string;
    const order = [...new Set([...html.matchAll(/data-footnote-id="([^"]+)"/g)].map((match) => match[1]))];
    html = html.replace(/(<sup class="footnote-ref" data-footnote-id="([^"]+)"><a href="[^"]+" id="[^"]+">)[\s\S]*?(<\/a><\/sup>)/g, (_all, start: string, id: string, end: string) => `${start}${order.indexOf(id) + 1}${end}`);
    if (order.some((id) => definitions.has(decodeURIComponent(id))))
        html += `<section class="footnotes"><hr><ol>${order.filter((id) => definitions.has(decodeURIComponent(id))).map((id) => `<li id="fn-${id}">${marked.parse(definitions.get(decodeURIComponent(id)) || '')}<a href="#fnref-${id}" aria-label="${escape(t('Back to reference'))}">↩</a></li>`).join('')}</ol></section>`;
    return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'], FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'], ADD_ATTR: ['data-notesprig-embed', 'data-embed-label', 'data-math', 'data-mermaid', 'data-block-id', 'data-local-image'] });
}
