import { useEffect, useRef, useState } from 'react';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, ExcalidrawEmbeddableElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ActionName } from '@excalidraw/excalidraw/actions/types';
import { CARD_PREFIX, canonicalJSON, cardMetadata, persistedAppearance, validVaultPath } from '../../shared/board-schema.mjs';
import { t, useLanguage } from '../i18n';

export type { BinaryFiles, ExcalidrawImperativeAPI };
export type BoardPreview = { title: string; excerpt: string; status: 'ready'|'missing'|'unbound'|'stale'|'unavailable'; revision?: string };
type Runtime = typeof import('@excalidraw/excalidraw');
let runtimePromise: Promise<Runtime> | undefined;

/** Set the asset base before evaluating Excalidraw: fonts must never fall back to a CDN. */
export function loadBoardRuntime(): Promise<Runtime> {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/board-assets/';
  return runtimePromise ??= Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')]).then(([runtime]) => runtime);
}

export async function createNoteCard(path: string, position = { x: 80, y: 80 }): Promise<OrderedExcalidrawElement> {
  const runtime = await loadBoardRuntime();
  const [base] = runtime.convertToExcalidrawElements([{ type: 'rectangle', ...position, width: 300, height: 220, backgroundColor: '#ffffff', fillStyle: 'solid' }]);
  return { ...base, type: 'embeddable', link: `${CARD_PREFIX}${crypto.randomUUID()}`, customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'bound', path } } } } as OrderedExcalidrawElement;
}

export interface BoardEngineProps {
  documentKey: string;
  initialScene: { elements: readonly ExcalidrawElement[]; appState?: Partial<AppState> };
  files: BinaryFiles;
  previews: Record<string, BoardPreview>;
  renderKey?: string;
  visibleCardIds?: readonly string[];
  onViewportChange?: (viewport: { scrollX: number; scrollY: number; width: number; height: number; zoom: number }) => void;
  onPersistentChange: (scene: { elements: readonly OrderedExcalidrawElement[]; appearance: Record<string, unknown> }) => void;
  onSelectionChange?: (ids: string[]) => void;
  onOpenCard?: (elementId: string) => void;
  onSaveRequest?: () => void;
  onReady?: (api: ExcalidrawImperativeAPI) => void;
  theme: 'light'|'dark';
  readOnly?: boolean;
  onBlockedIngress?: () => void;
}

function markerKey(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  try {
    const url = new URL(link, window.location.origin);
    return url.origin === window.location.origin && !url.search && !url.hash && new RegExp(`^${CARD_PREFIX}[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}$`, 'i').test(url.pathname) ? url.pathname : null;
  } catch { return null; }
}
/** External web embeds: any https URL that is not a NoteSprig card marker. */
export function webEmbedUrl(link: unknown): string | null {
  if (typeof link !== 'string' || link.length > 2048 || markerKey(link)) return null;
  try { const url = new URL(link); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
function safeCard(element: ExcalidrawElement) {
  const metadata = cardMetadata(element);
  return metadata && metadata.binding && ['bound', 'missing', 'unbound'].includes(metadata.binding.state) && validVaultPath(metadata.binding.path) && /\.md$/i.test(metadata.binding.path) ? metadata : null;
}

/** Excalidraw is the sole owner of scene geometry, interaction, selection and undo. */
export function BoardEngine(props: BoardEngineProps) {
  const language = useLanguage();
  const [runtime, setRuntime] = useState<Runtime>();
  const [error, setError] = useState(false);
  const latest = useRef(props); latest.current = props;
  const elements = useRef(props.initialScene.elements);
  const engineApi = useRef<ExcalidrawImperativeAPI | null>(null);
  const documentKey = useRef(props.documentKey);
  const persistent = useRef(canonicalJSON({ elements: props.initialScene.elements, appearance: persistedAppearance(props.initialScene.appState) }));
  const selection = useRef('');
  const viewport = useRef('');
  if (documentKey.current !== props.documentKey) {
    documentKey.current = props.documentKey; elements.current = props.initialScene.elements; engineApi.current = null;
    persistent.current = canonicalJSON({ elements: props.initialScene.elements, appearance: persistedAppearance(props.initialScene.appState) });
    selection.current = ''; viewport.current = '';
  }
  useEffect(() => { let alive = true; loadBoardRuntime().then((value) => { if (alive) setRuntime(value); }).catch(() => { if (alive) setError(true); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (engineApi.current) engineApi.current.addFiles(Object.values(props.files)); }, [props.files]);
  const blocked = () => latest.current.onBlockedIngress?.();
  const renderCard = (element: ExcalidrawEmbeddableElement) => {
    const metadata = safeCard(element);
    const web = !metadata && webEmbedUrl(element.link);
    // Online web embeds use the engine's sandboxed iframe (null); offline they get a labeled placeholder.
    if (web && navigator.onLine) return null;
    if (web) return <article aria-label={t('Web embed')} data-board-web-embed={element.id} style={{ boxSizing: 'border-box', width: '100%', height: '100%', padding: 14, overflow: 'hidden', overflowWrap: 'anywhere', background: latest.current.theme === 'dark' ? '#26282d' : '#fff', color: latest.current.theme === 'dark' ? '#eee' : '#202124', font: '14px/1.45 system-ui' }}>
      <strong style={{ display: 'block', marginBottom: 10 }}>{t('Web embed unavailable offline')}</strong><div>{web}</div>
    </article>;
    const preview = latest.current.visibleCardIds && !latest.current.visibleCardIds.includes(element.id) ? undefined : latest.current.previews[element.id];
    const eligible = metadata && markerKey(element.link);
    const status = !eligible || metadata.binding.state === 'unbound' ? 'unbound' : metadata.binding.state === 'missing' ? 'missing' : preview?.status ?? 'unavailable';
    const message = status === 'stale' || status === 'unbound' ? t('Reference review required') : status === 'missing' ? t('Note missing') : t('Note preview unavailable.');
    // Always return a safe node. Null would opt in to Excalidraw's iframe fallback.
    return <article aria-label={t('Board note preview')} data-board-card={element.id} style={{ boxSizing: 'border-box', width: '100%', height: '100%', padding: 14, overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: latest.current.theme === 'dark' ? '#26282d' : '#fff', color: latest.current.theme === 'dark' ? '#eee' : '#202124', font: '14px/1.45 system-ui', pointerEvents: 'none' }}>
      <strong style={{ display: 'block', marginBottom: 10 }}>{preview?.title?.slice(0, 200) || t('Board note preview')}</strong>
      <div>{status === 'ready' ? preview!.excerpt.slice(0, 4000) : message}</div>
    </article>;
  };
  if (error) return <div role="alert">{t('Drawing dependencies are unavailable. Your draft is preserved. Reconnect and reload when you are ready.')}</div>;
  if (!runtime) return <div role="status">{t('Loading…')}</div>;
  const { Excalidraw, MainMenu, DefaultSidebar } = runtime;
  return <div data-board-engine="" style={{ width: '100%', height: '100%' }}
    onDragOverCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onDropCapture={(event) => { event.preventDefault(); event.stopPropagation(); blocked(); }}
    onPasteCapture={(event) => { event.preventDefault(); event.stopPropagation(); blocked(); }}
    onCopyCapture={(event) => { event.preventDefault(); event.stopPropagation(); blocked(); }}
    onCutCapture={(event) => { event.preventDefault(); event.stopPropagation(); blocked(); }}
    onContextMenuCapture={(event) => { event.preventDefault(); event.stopPropagation(); blocked(); }}
    onKeyDownCapture={(event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 's' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (latest.current.onSaveRequest) latest.current.onSaveRequest(); else blocked(); return; }
      if (((event.ctrlKey || event.metaKey) && ['o', 's', 'v', 'c', 'x', 'e'].includes(key)) || (event.altKey && event.shiftKey && key === 'c')) { event.preventDefault(); event.stopPropagation(); blocked(); }
    }}>
    <Excalidraw key={`${props.documentKey}:${props.renderKey || ''}`} initialData={{ elements: props.initialScene.elements, appState: { ...props.initialScene.appState, frameRendering: { enabled: true, name: true, outline: true, clip: false } }, files: props.files }}
      excalidrawAPI={(api) => {
        engineApi.current = api;
        // Public action registration removes native transport commands from the
        // command palette. Capture handlers also close original context actions.
        const managedActions: ActionName[] = ['loadScene', 'saveToActiveFile', 'saveFileToDisk', 'copyAsPng', 'copyAsSvg', 'addToLibrary', 'copy', 'cut', 'paste', 'updateFrameRendering'];
        for (const name of managedActions) api.registerAction({ name, label: 'Use the NoteSprig toolbar to import files.', predicate: () => false, perform: () => { blocked(); return false; }, trackEvent: false });
        api.updateFrameRendering({ enabled: true, name: true, outline: true, clip: false });
        latest.current.onReady?.(api);
      }}
      handleKeyboardGlobally={false} autoFocus={false} aiEnabled={false} theme={props.theme} langCode={language}
      viewModeEnabled={props.readOnly} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false }, tools: { image: false } }}
      onPaste={() => { blocked(); return false; }}
      validateEmbeddable={(link) => { if (webEmbedUrl(link)) return true; const key = markerKey(link); const current = engineApi.current?.getSceneElementsIncludingDeleted() ?? elements.current; return Boolean(key && current.some((element) => !element.isDeleted && safeCard(element) && markerKey(element.link) === key)); }}
      renderEmbeddable={renderCard}
      onLinkOpen={(element, event) => { event.preventDefault(); if (safeCard(element) && markerKey(element.link)) { latest.current.onOpenCard?.(element.id); return; } const web = webEmbedUrl(element.link); if (web) window.open(web, '_blank', 'noopener,noreferrer'); }}
      onChange={(next, state) => {
        elements.current = next;
        const view = { scrollX: state.scrollX, scrollY: state.scrollY, width: state.width, height: state.height, zoom: state.zoom.value };
        const nextViewport = JSON.stringify(view);
        if (nextViewport !== viewport.current) { viewport.current = nextViewport; latest.current.onViewportChange?.(view); }
        const ids = Object.keys(state.selectedElementIds).filter((id) => state.selectedElementIds[id]);
        const nextSelection = ids.slice().sort().join(',');
        if (nextSelection !== selection.current) { selection.current = nextSelection; latest.current.onSelectionChange?.(ids); }
        const appearance = persistedAppearance(state as unknown as Record<string, unknown>);
        const fingerprint = canonicalJSON({ elements: next, appearance });
        if (fingerprint !== persistent.current) { persistent.current = fingerprint; latest.current.onPersistentChange({ elements: next, appearance }); }
      }}>
      <MainMenu><MainMenu.Item disabled>{t('Use the NoteSprig toolbar to import files.')}</MainMenu.Item></MainMenu>
      <DefaultSidebar.Trigger style={{ display: 'none' }} />
    </Excalidraw>
  </div>;
}
