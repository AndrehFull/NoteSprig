import { useLanguage } from '../i18n';
import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../api';
import { resolveTargets } from '../knowledge';
import { resolveAsset } from '../paths';
import { renderMarkdown } from '../markdown';
import type { NoteSummary } from '../types';

export function extractSection(content: string, fragment = '') {
  if (!fragment) return content;
  const value = fragment.replace(/^#/, '');
  if (value.startsWith('^')) {
    const lines = content.split('\n'); const id = value.slice(1);
    const end = lines.findIndex((line) => new RegExp(`\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(line));
    if (end < 0) return ''; let start = end; while (start > 0 && lines[start - 1].trim()) start--;
    return lines.slice(start, end + 1).join('\n').replace(new RegExp(`\\^${id}\\s*$`), '');
  }
  const lines = content.split('\n'); const start = lines.findIndex((line) => line.replace(/^#{1,6}\s+/, '').trim().toLocaleLowerCase() === value.toLocaleLowerCase() && /^#{1,6}\s/.test(line));
  if (start < 0) return ''; const depth = lines[start].match(/^#+/)![0].length;
  let end = start + 1; while (end < lines.length && !(new RegExp(`^#{1,${depth}}\\s`).test(lines[end]))) end++;
  return lines.slice(start, end).join('\n');
}
let mermaidQueue = Promise.resolve();
export async function hydrateRichContent(root: HTMLElement, path: string, files: NoteSummary[], cancelled = () => false, depth = 0) {
  const paths = files.filter((file) => file.kind !== 'folder').map((file) => file.path);
  for (const image of root.querySelectorAll<HTMLImageElement>('img[data-local-image]')) { image.src = `/api/attachment?path=${encodeURIComponent(resolveAsset(decodeURIComponent(image.dataset.localImage || ''), path, paths))}`; image.removeAttribute('data-local-image'); }
  const math = [...root.querySelectorAll<HTMLElement>('[data-math]')];
  if (math.length) {
    const katex = (await import('katex')).default;
    if (!cancelled()) for (const element of math) { try { element.innerHTML = katex.renderToString(decodeURIComponent(element.dataset.math || ''), { displayMode: element.classList.contains('math-block'), throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20 }); element.removeAttribute('data-math'); } catch { /* Keep source visible. */ } }
  }
  const diagrams = [...root.querySelectorAll<HTMLElement>('[data-mermaid]')];
  if (diagrams.length) {
    const mermaid = (await import('mermaid')).default;
    for (const element of diagrams) {
      mermaidQueue = mermaidQueue.then(async () => {
        if (cancelled()) return;
        try { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark', flowchart: { htmlLabels: false }, maxTextSize: 100000, maxEdges: 1000 }); const { svg } = await mermaid.render(`diagram-${crypto.randomUUID()}`, decodeURIComponent(element.dataset.mermaid || '')); if (!cancelled()) { element.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script'] }); element.removeAttribute('data-mermaid'); element.className = 'mermaid-diagram'; } } catch { element.classList.add('diagram-error'); }
      });
    }
    await mermaidQueue;
  }
  const code = [...root.querySelectorAll<HTMLElement>('pre > code[class^="language-"]')];
  if (code.length) { const hljs = (await import('highlight.js/lib/common')).default; if (!cancelled()) for (const element of code) try { hljs.highlightElement(element); } catch { /* Unknown language stays readable. */ } }
  if (depth >= 4) return;
  await Promise.all([...root.querySelectorAll<HTMLElement>('[data-notesprig-embed]')].map(async (element) => {
    if (cancelled()) return;
    let target = ''; try { target = decodeURIComponent(element.dataset.notesprigEmbed || ''); } catch { return; }
    const [raw, ...fragment] = target.split('#'); const resolved = resolveAsset(raw, path, paths);
    const url = `/api/attachment?path=${encodeURIComponent(resolved)}`;
    if (/\.(png|jpe?g|gif|svg|avif|webp)$/i.test(raw)) { const image = document.createElement('img'); image.src = url; image.alt = raw; image.loading = 'lazy'; const dimensions = (element.dataset.embedLabel || '').match(/^(\d+)(?:x(\d+))?$/); if (dimensions) { image.style.width = `${Math.min(4000, +dimensions[1])}px`; if (dimensions[2]) image.style.height = `${Math.min(4000, +dimensions[2])}px`; } element.replaceChildren(image); }
    else if (/\.(mp3|wav|ogg|m4a|mp4|webm)$/i.test(raw)) { const media = document.createElement(/\.(mp4|webm)$/i.test(raw) && !raw.split('/').at(-1)?.startsWith('Recording-') ? 'video' : 'audio'); media.src = url; media.controls = true; media.preload = 'metadata'; element.replaceChildren(media); }
    else if (/\.pdf$/i.test(raw)) { const frame = document.createElement('iframe'); frame.src = `${url}${fragment.length ? `#${fragment.join('#')}` : ''}`; frame.title = raw; frame.className = 'pdf-embed'; element.replaceChildren(frame); }
    else if (/\.canvas$/i.test(raw)) { const anchor = document.createElement('a'); anchor.href = `#ob-file=${encodeURIComponent(resolved)}`; anchor.textContent = `Canvas: ${raw}`; element.replaceChildren(anchor); }
    else {
      const candidates = resolveTargets(raw, path, files.filter((file) => file.kind === 'markdown' || !file.kind));
      if (candidates.length !== 1) { element.classList.add('unresolved-embed'); return; }
      const targetPath = candidates[0].path;
      if (targetPath === path) { element.classList.add('unresolved-embed'); return; }
      try { const note = await api.note(targetPath); if (cancelled()) return; const content = extractSection(note.content, fragment.join('#')); const heading = document.createElement('a'); heading.href = `#ob-note=${encodeURIComponent(target)}`; heading.className = 'embed-heading'; heading.textContent = target; const body = document.createElement('div'); body.className = 'embed-content'; body.innerHTML = renderMarkdown(content); element.replaceChildren(heading, body); element.removeAttribute('data-notesprig-embed'); await hydrateRichContent(body, targetPath, files, cancelled, depth + 1); } catch { element.classList.add('unresolved-embed'); }
    }
  }));
}
export function RichPreview({ content, path, files, onTask, fragment }: { content: string; path: string; files: NoteSummary[]; onTask?: (content: string) => void; fragment?: string }) {
  const language = useLanguage();
  const root = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(content), [content, language]);
  useEffect(() => { let cancelled = false; if (root.current) void hydrateRichContent(root.current, path, files, () => cancelled).catch(() => {}); return () => { cancelled = true; }; }, [html, path, files]);
  useEffect(() => {
    if (!fragment || !root.current) return;
    let decoded = fragment; try { decoded = decodeURIComponent(fragment); } catch { /* Literal percent. */ }
    const target = decoded.startsWith('^') ? root.current.querySelector(`[data-block-id="${CSS.escape(decoded.slice(1))}"]`)?.closest('p, li, blockquote') : [...root.current.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((heading) => heading.textContent?.trim().toLocaleLowerCase() === decoded.toLocaleLowerCase()) || root.current.querySelector(`#${CSS.escape(fragment)}`) || root.current.querySelector(`#${CSS.escape(decoded)}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [html, fragment]);
  return <div className="markdown-preview" data-note-preview={path} ref={root} onClick={(event) => {
    const element = event.target as HTMLInputElement;
    if (element.type !== 'checkbox' || !element.hasAttribute('data-task') || element.disabled || !onTask) return;
    const inputs = [...root.current!.querySelectorAll<HTMLInputElement>('input[data-task]:not(:disabled)')]; const index = inputs.indexOf(element);
    let count = -1;
    const next = content.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/gm, (all, start, checked, end) => { count++; return count === index ? `${start}${checked.trim() ? ' ' : 'x'}${end}` : all; });
    onTask(next);
  }} dangerouslySetInnerHTML={{ __html: html.replace(/ disabled=""/g, onTask ? '' : ' disabled=""') }} />;
}
