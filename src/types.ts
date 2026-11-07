export type NoteSummary = {
  kind?: 'markdown' | 'canvas' | 'base' | 'attachment' | 'folder';
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  links: { target: string; embed: boolean; kind?: 'wiki' | 'markdown' }[];
  mtime: number;
  size: number;
  propertyError?: string;
};

export type NoteDocument = NoteSummary & {
  content: string;
  body: string;
  properties: Record<string, unknown>;
  hash: string;
};

export type SearchItem = {
  path: string;
  title: string;
  count: number;
  snippets: string[];
};

export type SaveState = 'saved' | 'editing' | 'saving' | 'error';

export type CanvasNode = Record<string, unknown> & { id: string; type: 'text' | 'file' | 'link' | 'group'; x: number; y: number; width: number; height: number; text?: string; file?: string; subpath?: string; url?: string; label?: string; color?: string; background?: string };
export type CanvasEdge = Record<string, unknown> & { id: string; fromNode: string; toNode: string; fromSide?: string; toSide?: string; fromEnd?: string; toEnd?: string; color?: string; label?: string };
export type CanvasData = Record<string, unknown> & { nodes: CanvasNode[]; edges: CanvasEdge[] };
export type Version = { id: string; path: string; createdAt: number; hash: string; size: number; reason: string; content?: string };
export type TrashEntry = { id: string; path: string; trashedAt: number; kind: string; size: number };
