export type DocumentKind = 'markdown' | 'canvas' | 'base' | 'board';
export const documentKinds: Readonly<Record<DocumentKind, { suffix: string; maxBytes: number; label: string }>>;
export function kindForPath(path: string): DocumentKind | 'attachment';
export function isDocumentPath(path: string): boolean;
export function documentLimit(path: string): number;
export function documentTitle(path: string): string;
