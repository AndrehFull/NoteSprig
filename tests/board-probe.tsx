import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardEngine, createNoteCard, loadBoardRuntime } from '../src/boards/engine';
import type { BoardPreview, BinaryFiles, ExcalidrawImperativeAPI } from '../src/boards/engine';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { createSharingProjection } from '../src/boards/projection';
import { setLanguage } from '../src/i18n';

type Saved = { elements: ExcalidrawElement[]; appState: Record<string, unknown>; files: BinaryFiles };
function Probe() {
  const [scene, setScene] = useState<Saved>();
  const [previews, setPreviews] = useState<Record<string, BoardPreview>>({});
  const [blocked, setBlocked] = useState(0);
  const [changes, setChanges] = useState(0);
  const api = useRef<ExcalidrawImperativeAPI | undefined>(undefined);
  const state = useRef<Saved | undefined>(undefined);
  const previewRef = useRef(previews); previewRef.current = previews;
  useEffect(() => {
    const saved = localStorage.getItem('notesprig.board-probe');
    const initial: Saved = saved ? JSON.parse(saved) : { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} };
    state.current = initial; setScene(initial);
  }, []);
  const addCard = async () => {
    await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-session-only' }) });
    const response = await fetch('/api/note?path=Index.md');
    if (!response.ok) throw new Error('Fixture note read failed');
    const note = await response.json();
    const card = await createNoteCard('Index.md', { x: 80, y: 150 });
    setPreviews((previous) => ({ ...previous, [card.id]: { title: 'Index', excerpt: note.content, status: 'ready', revision: note.hash } }));
    const runtime = await loadBoardRuntime();
    api.current!.updateScene({ elements: [...api.current!.getSceneElementsIncludingDeleted(), card], captureUpdate: runtime.CaptureUpdateAction.IMMEDIATELY });
  };
  const addImageAndArrow = async () => {
    const runtime = await loadBoardRuntime();
    const card = api.current!.getSceneElements().find((element) => element.type === 'embeddable')!;
    const image = runtime.convertToExcalidrawElements([{ type: 'image', x: 600, y: 150, width: 100, height: 100, fileId: 'probe-image' as never }])[0];
    const arrow = runtime.convertToExcalidrawElements([{ type: 'arrow', x: 390, y: 250, width: 190, height: 0, points: [[0, 0], [190, 0]], startBinding: { elementId: card.id, focus: 0, gap: 10, fixedPoint: null } }])[0];
    api.current!.addFiles([{ id: 'probe-image' as never, dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF4sAAAAASUVORK5CYII=' as never, mimeType: 'image/png', created: 1 }]);
    api.current!.updateScene({ elements: [...api.current!.getSceneElementsIncludingDeleted().map((element) => element.id === card.id ? { ...element, boundElements: [{ type: 'arrow' as const, id: arrow.id }] } : element), image, arrow], captureUpdate: runtime.CaptureUpdateAction.IMMEDIATELY });
  };
  return <><nav style={{ display: 'flex', gap: 8, height: 40 }}><button onClick={addCard}>Add note</button><button onClick={addImageAndArrow}>Add image and arrow</button><button onClick={() => { localStorage.setItem('notesprig.board-probe', JSON.stringify({ ...state.current!, files: api.current!.getFiles() })); }}>Save probe</button><button onClick={() => { setPreviews((previous) => Object.fromEntries(Object.entries(previous).map(([id, preview]) => [id, { ...preview, excerpt: 'Updated note excerpt' }]))); }}>Refresh preview</button><button onClick={() => setLanguage('pt-BR')}>Português</button><output data-testid="blocked">{blocked}</output><output data-testid="changes">{changes}</output></nav><div style={{ width: '100vw', height: 'calc(100vh - 40px)' }}>{scene && <BoardEngine documentKey="probe" initialScene={scene} files={scene.files} previews={previews} theme="light" onBlockedIngress={() => setBlocked((value) => value + 1)} onPersistentChange={({ elements, appearance }) => { state.current = { elements: [...elements], appState: appearance, files: api.current?.getFiles() ?? {} }; setChanges((value) => value + 1); }} onReady={(value) => {
    api.current = value;
    Object.assign(window, { __boardProbe: { api: value, getScene: () => state.current, sharing: () => createSharingProjection({ elements: value.getSceneElements(), appState: value.getAppState(), files: value.getFiles() }, previewRef.current), exportSvg: async () => { const runtime = await loadBoardRuntime(); const projection = createSharingProjection({ elements: value.getSceneElements(), appState: value.getAppState(), files: value.getFiles() }, previewRef.current); return (await runtime.exportToSvg(projection)).outerHTML; } } });
  }} />}</div></>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
