import { normalizeTarget } from './paths';
import { resolveAsset } from './paths';
import type { NoteSummary } from './types';

export function baseName(filePath: string) {
  return filePath.split('/').at(-1)?.replace(/\.(md|canvas|base)$/i, '') || filePath;
}

export function parentPath(filePath: string) {
  return filePath.split('/').slice(0, -1).join('/');
}

function cleanPath(value: string) {
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/').replace(/\.md$/i, '').toLocaleLowerCase();
}

export function resolveTargets(raw: string, currentPath: string, notes: NoteSummary[], kind: 'wiki' | 'markdown' = 'wiki') {
  const target = normalizeTarget(raw);
  if (!target) return notes.filter((note) => note.path === currentPath);
  const normalized = cleanPath(target);
  const folder = parentPath(currentPath);
  const local = cleanPath(`${folder}/${target}`);
  const exact = (candidate: string) => notes.filter((note) => cleanPath(note.path) === candidate);
  if (kind === 'markdown' || raw.startsWith('./') || raw.startsWith('../')) {
    return exact(raw.startsWith('/') ? normalized : local);
  }
  const rootMatch = exact(normalized);
  if (rootMatch.length) return rootMatch;
  const localMatch = exact(local);
  if (localMatch.length) return localMatch;
  const suffixMatches = notes.filter((note) => cleanPath(note.path).endsWith(`/${normalized}`));
  if (suffixMatches.length) return suffixMatches;
  const named = notes.filter((note) => [baseName(note.path), ...note.aliases].some((name) => name.toLocaleLowerCase() === normalized));
  const localAliases = named.filter((note) => parentPath(note.path) === folder);
  return localAliases.length ? localAliases : named;
}

export type KnowledgeNode = {
  id: string;
  label: string;
  path?: string;
  kind: 'note' | 'unresolved' | 'tag' | 'ambiguous' | 'attachment';
  tags: string[];
  degree: number;
  target?: string;
  origin?: string;
};
export type KnowledgeEdge = { source: string; target: string };
export type KnowledgeGraph = { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] };
export type GraphFilters = { query: string; showTags: boolean; showUnresolved: boolean; showOrphans: boolean; showAttachments?: boolean; files?: NoteSummary[]; focusPath?: string; depth: number };

export function matchesQuery(node: KnowledgeNode, query: string) {
  const text = `${node.label} ${node.path || ''} ${node.tags.map((tag) => `#${tag}`).join(' ')}`.toLocaleLowerCase();
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return tokens.every((token) => {
    const term = token.toLocaleLowerCase().replaceAll('"', '');
    if (term.startsWith('path:')) return (node.path || '').toLocaleLowerCase().includes(term.slice(5));
    if (term.startsWith('tag:') || term.startsWith('#')) {
      const tag = term.startsWith('#') ? term.slice(1) : term.slice(4).replace(/^#/, '');
      return node.tags.some((value) => value.toLocaleLowerCase() === tag || value.toLocaleLowerCase().startsWith(`${tag}/`));
    }
    return text.includes(term);
  });
}

export function buildKnowledgeGraph(notes: NoteSummary[], filters: GraphFilters): KnowledgeGraph {
  const nodes = new Map<string, KnowledgeNode>();
  const edgeKeys = new Set<string>();
  const edges: KnowledgeEdge[] = [];
  for (const note of notes) nodes.set(note.path, { id: note.path, path: note.path, label: baseName(note.path), kind: 'note', tags: note.tags, degree: 0 });
  const attachments = (filters.files || []).filter((file) => file.kind === 'attachment' || file.kind === 'canvas' || file.kind === 'base');
  if (filters.showAttachments) for (const file of attachments) nodes.set(file.path, { id: file.path, path: file.path, label: baseName(file.path), kind: 'attachment', tags: [], degree: 0 });
  function connect(source: string, target: string) {
    if (source === target) return;
    const key = JSON.stringify([source, target]);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target });
  }
  for (const note of notes) {
    for (const link of note.links) {
      if (/\.(png|jpe?g|gif|svg|webp|avif|pdf|canvas|base|mp3|wav|ogg|m4a|mp4|webm|txt|csv|zip|json)$/i.test(link.target)) {
        if (filters.showAttachments) { const target = resolveAsset(link.target, note.path, attachments.map((file) => file.path)); if (nodes.has(target)) connect(note.path, target); }
        continue;
      }
      const candidates = resolveTargets(link.target, note.path, notes, link.kind);
      if (candidates.length === 1) connect(note.path, candidates[0].path);
      else if (filters.showUnresolved) {
        const relative = link.kind === 'markdown' || /^\.\.?\//.test(link.target);
        const id = `${candidates.length ? 'ambiguous' : 'missing'}:${cleanPath(relative ? `${parentPath(note.path)}/${link.target}` : link.target)}`;
        nodes.set(id, { id, label: normalizeTarget(link.target), target: link.target, origin: note.path, kind: candidates.length ? 'ambiguous' : 'unresolved', tags: [], degree: 0 });
        connect(note.path, id);
      }
    }
    if (filters.showTags) for (const tag of note.tags) {
      const id = `tag:${tag}`;
      nodes.set(id, { id, label: `#${tag}`, kind: 'tag', tags: [tag], degree: 0 });
      connect(note.path, id);
    }
  }
  for (const edge of edges) {
    nodes.get(edge.source)!.degree++;
    nodes.get(edge.target)!.degree++;
  }
  let visible = new Set(nodes.keys());
  if (filters.focusPath) {
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    }
    visible = new Set(nodes.has(filters.focusPath) ? [filters.focusPath] : []);
    let frontier = [...visible];
    for (let depth = 0; depth < filters.depth; depth++) {
      const next: string[] = [];
      for (const id of frontier) for (const neighbor of adjacency.get(id) || []) {
        if (!visible.has(neighbor)) { visible.add(neighbor); next.push(neighbor); }
      }
      frontier = next;
    }
  }
  const filtered = [...nodes.values()].filter((node) => visible.has(node.id) && (filters.showOrphans || node.degree > 0 || node.id === filters.focusPath) && matchesQuery(node, filters.query));
  const ids = new Set(filtered.map((node) => node.id));
  return { nodes: filtered, edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}
