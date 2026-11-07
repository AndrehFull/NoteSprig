import { t, translateMessage } from '../i18n';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUpRight, Check, Copy, Download, FilePlus2, Focus, Group, Link2, Lock, Minus, MousePointer2, Palette, Plus, Redo2, Trash2, Type, Undo2, Unlock, X } from 'lucide-react';
import { api } from '../api';
import { baseName } from '../knowledge';
import { renderMarkdown } from '../markdown';
import { extractSection, hydrateRichContent } from './RichPreview';
import type { CanvasData, CanvasNode, NoteSummary } from '../types';
const colors: Record<string, string> = { '1': '#d66c75', '2': '#d79b65', '3': '#d1bd73', '4': '#83b593', '5': '#75b5ca', '6': '#ac8cdd' };
const color = (value?: string) => value && (colors[value] || (/^#[a-f\d]{6}$/i.test(value) ? value : undefined)) || '#827a95';
const clone = <T,>(data: T): T => structuredClone(data);
const directions: Record<string, string> = { left: 'left', right: 'right', top: 'top', bottom: 'bottom', n: 'north', s: 'south', e: 'east', w: 'west', nw: 'northwest', ne: 'northeast', sw: 'southwest', se: 'southeast' };
const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);
function FileCard({ node, files, onOpen, onLink }: {
    node: CanvasNode;
    files: NoteSummary[];
    onOpen: (path: string) => void;
    onLink?: (target: string, origin: string, kind?: 'wiki' | 'markdown') => void;
}) {
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const file = node.file || '';
    const preview = useRef<HTMLDivElement>(null);
    const mtime = files.find((entry) => entry.path === file)?.mtime;
    useEffect(() => {
        let cancelled = false;
        if (/\.md$/i.test(file))
            api.note(file).then((note) => {
                if (!cancelled) {
                    setContent(note.content);
                    setError('');
                }
            }).catch((caught: Error) => {
                if (!cancelled)
                    setError(caught.message);
            });
        return () => { cancelled = true; };
    }, [file, mtime]);
    useEffect(() => {
        let cancelled = false;
        if (preview.current)
            void hydrateRichContent(preview.current, file, files, () => cancelled).catch(() => { });
        return () => { cancelled = true; };
    }, [content, file, node.subpath, files]);
    const url = `/api/attachment?path=${encodeURIComponent(file)}`;
    return <><div className="canvas-file-title"><button onClick={() => onOpen(file)} title={t("Open file")}><FilePlus2 size={13}/>{baseName(file)}<ArrowUpRight size={12}/></button></div><div className="canvas-file-body">
    {error ? <p className="form-error">{translateMessage(error)}</p> : /\.md$/i.test(file) ? <div className="markdown-preview" ref={preview} onClick={(event) => {
                const anchor = (event.target as HTMLElement).closest('a');
                const href = anchor?.getAttribute('href') || '';
                if (!anchor)
                    return;
                event.preventDefault();
                if (/^https?:/i.test(href))
                    window.open(href, '_blank', 'noopener,noreferrer');
                else if (href.startsWith('#ob-note='))
                    onLink?.(decodeURIComponent(href.slice(9)), file, 'wiki');
                else
                    onLink?.(href, file, 'markdown');
            }} dangerouslySetInnerHTML={{ __html: renderMarkdown(extractSection(content, node.subpath || '')) }}/> : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file) ? <img src={url} alt={baseName(file)} draggable={false}/> : /\.pdf$/i.test(file) ? <iframe title={file} src={`${url}${node.subpath || ''}`}/> : /\.(mp3|wav|ogg|m4a)$/i.test(file) ? <audio src={url} controls/> : /\.(mp4|webm)$/i.test(file) ? <video src={url} controls/> : <button className="quiet-button" onClick={() => onOpen(file)}>{t("Open file")}</button>}
  </div></>;
}
type Drag = {
    id: number;
    kind: 'pan' | 'move' | 'resize' | 'connect' | 'select';
    x: number;
    y: number;
    data: CanvasData;
    camera: {
        x: number;
        y: number;
        scale: number;
    };
    ids?: string[];
    node?: string;
    side?: string;
    moved: boolean;
};
export function CanvasView({ path, value, onChange, files, onOpen, onNotice, onLink, onUpload }: {
    path: string;
    value: string;
    onChange: (value: string) => void;
    files: NoteSummary[];
    onOpen: (path: string) => void;
    onNotice: (message: string) => void;
    onLink?: (target: string, origin: string, kind?: 'wiki' | 'markdown') => void;
    onUpload?: (files: File[]) => Promise<string[]>;
}) {
    const initial = () => {
        try {
            const data = JSON.parse(value);
            return { ...data, nodes: data.nodes || [], edges: data.edges || [] } as CanvasData;
        }
        catch {
            return { nodes: [], edges: [] };
        }
    };
    const [data, setData] = useState<CanvasData>(initial);
    const dataRef = useRef(data);
    const lastEmitted = useRef(value);
    const [selection, setSelection] = useState<Set<string>>(new Set());
    const selectedRef = useRef(selection);
    selectedRef.current = selection;
    const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [camera, setCamera] = useState({ x: 100, y: 100, scale: 1 });
    const cameraRef = useRef(camera);
    cameraRef.current = camera;
    const [readOnly, setReadOnly] = useState(false);
    const [snap, setSnap] = useState(true);
    const [filePicker, setFilePicker] = useState(false);
    const [fileQuery, setFileQuery] = useState('');
    const [linkEditor, setLinkEditor] = useState(false);
    const [url, setUrl] = useState('');
    const [connectFrom, setConnectFrom] = useState<string | null>(null);
    const [marquee, setMarquee] = useState<{
        x: number;
        y: number;
        width: number;
        height: number;
    } | null>(null);
    const [connectionPoint, setConnectionPoint] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const [, renderHistory] = useState(0);
    const undo = useRef<CanvasData[]>([]);
    const redo = useRef<CanvasData[]>([]);
    const host = useRef<HTMLDivElement>(null);
    const drag = useRef<Drag | null>(null);
    const space = useRef(false);
    const readonlyRef = useRef(readOnly);
    readonlyRef.current = readOnly;
    function setDocument(next: CanvasData, emit = true) {
        dataRef.current = next;
        setData(next);
        if (emit) {
            const text = JSON.stringify(next, null, '\t');
            lastEmitted.current = text;
            onChange(text);
        }
    }
    function commit(next: CanvasData, previous = dataRef.current) {
        if (readOnly)
            return;
        undo.current.push(clone(previous));
        if (undo.current.length > 100)
            undo.current.shift();
        redo.current = [];
        renderHistory((count) => count + 1);
        setDocument(next);
    }
    function moveHistory(direction: 'undo' | 'redo') {
        if (readOnly)
            return;
        const from = direction === 'undo' ? undo : redo;
        const to = direction === 'undo' ? redo : undo;
        const next = from.current.pop();
        if (!next)
            return;
        to.current.push(clone(dataRef.current));
        setDocument(next);
        renderHistory((count) => count + 1);
    }
    function patchNode(id: string, patch: Partial<CanvasNode>) { commit({ ...dataRef.current, nodes: dataRef.current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }); }
    function center() { const rect = host.current?.getBoundingClientRect(); return { x: ((rect?.width || 800) / 2 - cameraRef.current.x) / cameraRef.current.scale, y: ((rect?.height || 600) / 2 - cameraRef.current.y) / cameraRef.current.scale }; }
    function addNode(type: CanvasNode['type'], extra: Partial<CanvasNode> = {}, point = center()) {
        if (readOnly)
            return;
        const node: CanvasNode = { id: uid(), type, x: Math.round(point.x - 150), y: Math.round(point.y - 90), width: type === 'group' ? 600 : 300, height: type === 'group' ? 400 : 200, ...(type === 'text' ? { text: '' } : type === 'group' ? { label: t("Group") } : {}), ...extra };
        commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, node] });
        setSelection(new Set([node.id]));
        setSelectedEdge(null);
        if (type === 'text')
            setEditing(node.id);
    }
    function removeSelection() {
        if (readOnly)
            return;
        const ids = selectedRef.current;
        commit({ ...dataRef.current, nodes: dataRef.current.nodes.filter((node) => !ids.has(node.id)), edges: dataRef.current.edges.filter((edge) => edge.id !== selectedEdge && !ids.has(edge.fromNode) && !ids.has(edge.toNode)) });
        setSelection(new Set());
        setSelectedEdge(null);
        setEditing(null);
    }
    function duplicate() {
        const idMap = new Map([...selection].map((id) => [id, uid()]));
        const nodes = dataRef.current.nodes.filter((node) => selection.has(node.id)).map((node) => ({ ...clone(node), id: idMap.get(node.id)!, x: node.x + 30, y: node.y + 30 }));
        const edges = dataRef.current.edges.filter((edge) => idMap.has(edge.fromNode) && idMap.has(edge.toNode)).map((edge) => ({ ...clone(edge), id: uid(), fromNode: idMap.get(edge.fromNode)!, toNode: idMap.get(edge.toNode)! }));
        commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, ...nodes], edges: [...dataRef.current.edges, ...edges] });
        setSelection(new Set(nodes.map((node) => node.id)));
    }
    function groupSelection() {
        const nodes = dataRef.current.nodes.filter((node) => selection.has(node.id));
        if (!nodes.length) {
            addNode('group', { label: t("Group") });
            return;
        }
        const x = Math.min(...nodes.map((node) => node.x)) - 30, y = Math.min(...nodes.map((node) => node.y)) - 50;
        addNode('group', { label: t("Group"), x, y, width: Math.max(...nodes.map((node) => node.x + node.width)) - x + 30, height: Math.max(...nodes.map((node) => node.y + node.height)) - y + 30 });
    }
    function connect(from: string, to: string, side = 'right') {
        if (from === to || readOnly)
            return;
        commit({ ...dataRef.current, edges: [...dataRef.current.edges, { id: uid(), fromNode: from, fromSide: side, toNode: to, toSide: side === 'right' ? 'left' : 'right', toEnd: 'arrow' }] });
        setConnectFrom(null);
        setConnectionPoint(null);
    }
    function fit(selected = false) {
        const nodes = selected ? dataRef.current.nodes.filter((node) => selectedRef.current.has(node.id)) : dataRef.current.nodes;
        if (!nodes.length || !host.current)
            return;
        const x = Math.min(...nodes.map((node) => node.x)), y = Math.min(...nodes.map((node) => node.y));
        const width = Math.max(...nodes.map((node) => node.x + node.width)) - x, height = Math.max(...nodes.map((node) => node.y + node.height)) - y;
        const rect = host.current.getBoundingClientRect();
        const scale = Math.min(1.2, (rect.width - 100) / Math.max(100, width), (rect.height - 100) / Math.max(100, height));
        setCamera({ x: rect.width / 2 - (x + width / 2) * scale, y: rect.height / 2 - (y + height / 2) * scale, scale: Math.max(0.05, scale) });
    }
    function zoom(factor: number, x?: number, y?: number) {
        const rect = host.current?.getBoundingClientRect();
        const px = x ?? (rect?.width || 800) / 2, py = y ?? (rect?.height || 600) / 2;
        setCamera((current) => { const scale = Math.max(0.05, Math.min(4, current.scale * factor)); return { x: px - (px - current.x) / current.scale * scale, y: py - (py - current.y) / current.scale * scale, scale }; });
    }
    function localPoint(clientX: number, clientY: number) { const rect = host.current!.getBoundingClientRect(); const cam = cameraRef.current; return { x: (clientX - rect.left - cam.x) / cam.scale, y: (clientY - rect.top - cam.y) / cam.scale }; }
    function start(event: ReactPointerEvent, kind: Drag['kind'], node?: CanvasNode, side?: string) {
        if (event.button !== 0 && event.button !== 1)
            return;
        if (space.current || event.button === 1)
            kind = 'pan';
        if (readOnly && kind !== 'pan')
            return;
        event.preventDefault();
        event.stopPropagation();
        host.current?.focus();
        host.current?.setPointerCapture(event.pointerId);
        let ids = [...selection];
        if (node && kind === 'move') {
            if (connectFrom) {
                connect(connectFrom, node.id);
                return;
            }
            if (event.shiftKey) {
                const next = new Set(selection);
                if (next.has(node.id))
                    next.delete(node.id);
                else
                    next.add(node.id);
                setSelection(next);
                ids = [...next];
            }
            else if (!selection.has(node.id)) {
                setSelection(new Set([node.id]));
                ids = [node.id];
            }
            if (node.type === 'group')
                for (const child of dataRef.current.nodes)
                    if (child.id !== node.id && child.x >= node.x && child.y >= node.y && child.x + child.width <= node.x + node.width && child.y + child.height <= node.y + node.height)
                        ids.push(child.id);
            setSelectedEdge(null);
            setEditing(null);
        }
        if (kind === 'connect' && node) {
            setConnectFrom(node.id);
            setConnectionPoint(localPoint(event.clientX, event.clientY));
        }
        drag.current = { id: event.pointerId, kind, x: event.clientX, y: event.clientY, data: clone(dataRef.current), camera: { ...cameraRef.current }, ids: [...new Set(ids)], node: node?.id, side, moved: false };
    }
    function pointerMove(event: ReactPointerEvent) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId)
            return;
        let dx = (event.clientX - current.x) / current.camera.scale, dy = (event.clientY - current.y) / current.camera.scale;
        if (Math.hypot(dx, dy) > 2)
            current.moved = true;
        if (current.kind === 'pan') {
            setCamera({ ...current.camera, x: current.camera.x + event.clientX - current.x, y: current.camera.y + event.clientY - current.y });
            return;
        }
        if (current.kind === 'connect') {
            setConnectionPoint(localPoint(event.clientX, event.clientY));
            return;
        }
        if (current.kind === 'select') {
            const a = localPoint(current.x, current.y), b = localPoint(event.clientX, event.clientY);
            setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
            return;
        }
        if (snap && !space.current) {
            dx = Math.round(dx / 10) * 10;
            dy = Math.round(dy / 10) * 10;
        }
        if (event.shiftKey && current.kind === 'move') {
            if (Math.abs(dx) > Math.abs(dy))
                dy = 0;
            else
                dx = 0;
        }
        let nodes = current.data.nodes.map((node) => {
            if (current.kind === 'move' && current.ids?.includes(node.id))
                return { ...node, x: node.x + dx, y: node.y + dy };
            if (current.kind === 'resize' && current.node === node.id) {
                let width = Math.max(100, node.width + (current.side?.includes('w') ? -dx : current.side?.includes('e') ? dx : 0));
                let height = Math.max(60, node.height + (current.side?.includes('n') ? -dy : current.side?.includes('s') ? dy : 0));
                if (event.shiftKey)
                    height = width / (node.width / node.height);
                return { ...node, width, height, x: current.side?.includes('w') ? node.x + node.width - width : node.x, y: current.side?.includes('n') ? node.y + node.height - height : node.y };
            }
            return node;
        });
        if (current.kind === 'move' && current.moved) {
            const front = new Set(current.ids);
            nodes = [...nodes.filter((node) => node.type === 'group' || !front.has(node.id)), ...nodes.filter((node) => node.type !== 'group' && front.has(node.id))];
        }
        setDocument({ ...current.data, nodes }, false);
    }
    function pointerUp(event: ReactPointerEvent) {
        const current = drag.current;
        if (!current || current.id !== event.pointerId)
            return;
        drag.current = null;
        if (host.current?.hasPointerCapture(event.pointerId))
            host.current.releasePointerCapture(event.pointerId);
        if (event.type === 'pointercancel') {
            setDocument(current.data, false);
            setConnectionPoint(null);
            setConnectFrom(null);
            setMarquee(null);
            return;
        }
        if (current.kind === 'connect' && current.node) {
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-canvas-node]')?.dataset.canvasNode;
            if (target)
                connect(current.node, target, current.side);
            else
                setConnectFrom(null);
            setConnectionPoint(null);
        }
        else if (current.kind === 'select' && marquee) {
            setSelection(new Set(dataRef.current.nodes.filter((node) => node.x + node.width >= marquee.x && node.x <= marquee.x + marquee.width && node.y + node.height >= marquee.y && node.y <= marquee.y + marquee.height).map((node) => node.id)));
            setMarquee(null);
        }
        else if (current.moved && (current.kind === 'move' || current.kind === 'resize'))
            commit(dataRef.current, current.data);
        else if (current.kind === 'move') {
            const front = new Set(current.ids);
            const nodes = [...current.data.nodes.filter((node) => node.type === 'group' || !front.has(node.id)), ...current.data.nodes.filter((node) => node.type !== 'group' && front.has(node.id))];
            if (nodes.some((node, index) => node.id !== current.data.nodes[index].id))
                commit({ ...current.data, nodes }, current.data);
        }
    }
    function selectedColor(value: string) {
        if (selectedEdge)
            commit({ ...dataRef.current, edges: dataRef.current.edges.map((edge) => edge.id === selectedEdge ? { ...edge, color: value } : edge) });
        else
            commit({ ...dataRef.current, nodes: dataRef.current.nodes.map((node) => selection.has(node.id) ? { ...node, color: value } : node) });
    }
    function align(mode: string) {
        const nodes = dataRef.current.nodes.filter((node) => selection.has(node.id));
        if (nodes.length < 2)
            return;
        const minX = Math.min(...nodes.map((node) => node.x)), minY = Math.min(...nodes.map((node) => node.y));
        const positions = new Map(nodes.map((node, index) => [node.id, mode === 'row' ? { x: minX + index * (Math.max(...nodes.map((item) => item.width)) + 30), y: minY } : mode === 'column' ? { x: minX, y: minY + index * (Math.max(...nodes.map((item) => item.height)) + 30) } : mode === 'left' ? { x: minX } : { y: minY }]));
        commit({ ...dataRef.current, nodes: dataRef.current.nodes.map((node) => ({ ...node, ...positions.get(node.id) })) });
    }
    function exportImage() {
        const nodes = dataRef.current.nodes;
        if (!nodes.length)
            return;
        const minX = Math.min(...nodes.map((node) => node.x)) - 30, minY = Math.min(...nodes.map((node) => node.y)) - 30;
        const width = Math.max(...nodes.map((node) => node.x + node.width)) - minX + 30, height = Math.max(...nodes.map((node) => node.y + node.height)) - minY + 30;
        const canvas = document.createElement('canvas');
        const factor = Math.min(2, 8192 / width, 8192 / height);
        canvas.width = Math.ceil(width * factor);
        canvas.height = Math.ceil(height * factor);
        const ctx = canvas.getContext('2d')!;
        ctx.scale(factor, factor);
        ctx.translate(-minX, -minY);
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(minX, minY, width, height);
        for (const edge of dataRef.current.edges) {
            const from = nodes.find((node) => node.id === edge.fromNode), to = nodes.find((node) => node.id === edge.toNode);
            if (!from || !to)
                continue;
            ctx.strokeStyle = color(edge.color);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(from.x + from.width, from.y + from.height / 2);
            ctx.lineTo(to.x, to.y + to.height / 2);
            ctx.stroke();
        }
        for (const node of [...nodes].sort((a, b) => Number(a.type !== 'group') - Number(b.type !== 'group'))) {
            ctx.fillStyle = node.type === 'group' ? '#28252e' : '#29272e';
            ctx.fillRect(node.x, node.y, node.width, node.height);
            ctx.strokeStyle = color(node.color);
            ctx.strokeRect(node.x, node.y, node.width, node.height);
            ctx.fillStyle = '#ded9e5';
            ctx.font = '15px sans-serif';
            let y = node.y + 26;
            const text = node.text || node.file || node.url || node.label || '';
            for (const line of text.split('\n')) {
                let row = '';
                for (const word of line.split(' ')) {
                    if (ctx.measureText(`${row} ${word}`).width > node.width - 30) {
                        ctx.fillText(row, node.x + 15, y);
                        y += 23;
                        row = word;
                    }
                    else
                        row += `${row ? ' ' : ''}${word}`;
                    if (y > node.y + node.height - 10)
                        break;
                }
                if (y > node.y + node.height - 10)
                    break;
                ctx.fillText(row, node.x + 15, y);
                y += 23;
            }
        }
        const anchor = document.createElement('a');
        anchor.download = `${baseName(path)}.png`;
        anchor.href = canvas.toDataURL('image/png');
        anchor.click();
    }
    useEffect(() => {
        if (value === lastEmitted.current)
            return;
        try {
            const parsed = JSON.parse(value);
            const next = { ...parsed, nodes: parsed.nodes || [], edges: parsed.edges || [] } as CanvasData;
            dataRef.current = next;
            setData(next);
            lastEmitted.current = value;
            undo.current = [];
            redo.current = [];
        }
        catch {
            onNotice(t("Could not open the JSON Canvas file."));
        }
    }, [value]);
    useEffect(() => { const timer = requestAnimationFrame(() => fit()); return () => cancelAnimationFrame(timer); }, [path]);
    useEffect(() => {
        const element = host.current;
        if (!element)
            return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            if (event.ctrlKey || event.metaKey || space.current)
                zoom(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
            else
                setCamera((current) => ({ ...current, x: current.x - (event.shiftKey ? event.deltaY : event.deltaX), y: current.y - (event.shiftKey ? 0 : event.deltaY) }));
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    }, []);
    const edge = data.edges.find((entry) => entry.id === selectedEdge);
    function endpoint(node: CanvasNode, side = 'right') { return { x: node.x + (side === 'left' ? 0 : side === 'right' ? node.width : node.width / 2), y: node.y + (side === 'top' ? 0 : side === 'bottom' ? node.height : node.height / 2) }; }
    function curve(from: {
        x: number;
        y: number;
    }, to: {
        x: number;
        y: number;
    }) { const d = Math.max(50, Math.abs(to.x - from.x) * 0.5); return `M${from.x},${from.y} C${from.x + d},${from.y} ${to.x - d},${to.y} ${to.x},${to.y}`; }
    return <section className="canvas-view" aria-label={t("Canvas")} data-node-count={data.nodes.length} data-edge-count={data.edges.length}>
    <div className="canvas-surface" ref={host} tabIndex={0} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('.canvas-card, .canvas-edge, .canvas-overlay'))
                return;
            setSelection(new Set());
            setSelectedEdge(null);
            setEditing(null);
            start(event, event.shiftKey ? 'select' : 'pan');
        }} onDoubleClick={(event) => {
            if (!(event.target as HTMLElement).closest('.canvas-card, .canvas-edge, .canvas-overlay'))
                addNode('text', {}, localPoint(event.clientX, event.clientY));
        }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.getData('text/x-notesprig-file');
            if (file)
                addNode('file', { file }, localPoint(event.clientX, event.clientY));
            else if (event.dataTransfer.files.length && onUpload && !readOnly) {
                const point = localPoint(event.clientX, event.clientY);
                void onUpload([...event.dataTransfer.files]).then((paths) => { const nodes = paths.map((file, index) => ({ id: uid(), type: 'file' as const, file, x: point.x + index * 35, y: point.y + index * 35, width: 300, height: 220 })); commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, ...nodes] }); }).catch((error: Error) => onNotice(error.message));
            }
        }} onKeyDown={(event) => {
            if ((event.target as HTMLElement).closest('input, textarea, [contenteditable=true]'))
                return;
            if (event.code === 'Space') {
                event.preventDefault();
                space.current = true;
            }
            if (event.key === 'Escape') {
                setEditing(null);
                setConnectFrom(null);
                setSelection(new Set());
                setSelectedEdge(null);
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                removeSelection();
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.stopPropagation();
                moveHistory(event.shiftKey ? 'redo' : 'undo');
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault();
                setSelection(new Set(data.nodes.map((node) => node.id)));
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                duplicate();
            }
            if (event.shiftKey && event.key === '1')
                fit();
            if (event.shiftKey && event.key === '2')
                fit(true);
        }} onKeyUp={(event) => {
            if (event.code === 'Space')
                space.current = false;
        }} onBlur={() => { space.current = false; }}>
      <div className="canvas-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        <svg className="canvas-edges" width="1" height="1" overflow="visible"><defs><marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="context-stroke"/></marker></defs>
          {data.edges.map((entry) => {
            const from = data.nodes.find((node) => node.id === entry.fromNode), to = data.nodes.find((node) => node.id === entry.toNode);
            if (!from || !to)
                return null;
            const a = endpoint(from, entry.fromSide), b = endpoint(to, entry.toSide || 'left');
            return <g className={`canvas-edge ${entry.id === selectedEdge ? 'selected' : ''}`} key={entry.id} onPointerDown={(event) => { event.stopPropagation(); setSelectedEdge(entry.id); setSelection(new Set()); }}><path className="edge-hit" d={curve(a, b)}/><path d={curve(a, b)} stroke={color(entry.color)} strokeWidth={entry.id === selectedEdge ? 3 : 2} fill="none" markerEnd={entry.toEnd === 'none' ? undefined : 'url(#canvas-arrow)'} markerStart={entry.fromEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}/>{entry.label && <g transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`}><rect x={-Math.min(150, entry.label.length * 4 + 8)} y="-13" width={Math.min(300, entry.label.length * 8 + 16)} height="26" rx="4"/><text textAnchor="middle" dominantBaseline="middle">{entry.label}</text></g>}</g>;
        })}
          {connectFrom && connectionPoint && (() => { const from = data.nodes.find((node) => node.id === connectFrom); return from ? <path d={curve(endpoint(from), connectionPoint)} stroke="var(--accent)" strokeWidth="2" fill="none" strokeDasharray="5 5"/> : null; })()}
        </svg>
        {data.nodes.map((node, index) => <div key={node.id} className={`canvas-card canvas-${node.type} ${selection.has(node.id) ? 'selected' : ''}`} data-canvas-node={node.id} style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: index + 2, borderColor: color(node.color), '--card-color': color(node.color) } as React.CSSProperties} onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('input, textarea, button, a, audio, video, iframe, .resize-handle, .connect-handle'))
                    return;
                start(event, 'move', node);
            }} onDoubleClick={(event) => {
                event.stopPropagation();
                if ((node.type === 'text' || node.type === 'group') && !readOnly)
                    setEditing(node.id);
                else if (node.type === 'file' && node.file)
                    onOpen(node.file);
            }}>
          {node.type === 'group' ? <>{editing === node.id && !readOnly ? <input aria-label={t("Group name")} autoFocus value={node.label || ''} onChange={(event) => patchNode(node.id, { label: event.target.value })} onBlur={() => setEditing(null)} onKeyDown={(event) => {
                        if (event.key === 'Enter')
                            setEditing(null);
                    }}/> : <div className="canvas-group-label">{node.label || t("Group")}</div>}{node.background && <img className="canvas-group-background" style={{ objectFit: node.backgroundStyle === 'ratio' ? 'contain' : 'cover' }} src={`/api/attachment?path=${encodeURIComponent(node.background)}`} alt=""/>}</> : node.type === 'text' ? editing === node.id && !readOnly ? <textarea aria-label={t("Card text")} autoFocus value={node.text || ''} onChange={(event) => patchNode(node.id, { text: event.target.value })} onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        setEditing(null);
                        host.current?.focus();
                    }
                }}/> : <div className="canvas-text-content markdown-preview" dangerouslySetInnerHTML={{ __html: node.text ? renderMarkdown(node.text) : '<span class="muted">Clique duas vezes para escrever…</span>' }}/> : node.type === 'file' ? <FileCard node={node} files={files} onOpen={onOpen} onLink={onLink}/> : <div className="canvas-web-card"><Link2 size={23}/><a href={/^https?:\/\//i.test(node.url || '') ? node.url : '#'} target="_blank" rel="noopener noreferrer">{node.url}</a><span>{t("Open external page")}</span></div>}
          {!readOnly && <>{['left', 'right', 'top', 'bottom'].map((side) => <button key={side} className={`connect-handle ${side}`} aria-label={t("Connect card {v0}", { v0: t(directions[side]) })} onPointerDown={(event) => start(event, 'connect', node, side)}/>)}{selection.has(node.id) && ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map((side) => <span key={side} role="button" aria-label={t("Resize {v0}", { v0: t(directions[side]) })} className={`resize-handle ${side}`} onPointerDown={(event) => start(event, 'resize', node, side)}/>)}</>}
        </div>)}
        {marquee && <div className="canvas-marquee" style={marquee}/>}
      </div>
    </div>
    <div className="canvas-top-controls canvas-overlay"><span>{data.nodes.length}{" " + t("cards \u00B7") + " "}{data.edges.length}{" " + t("connections")}</span><button className="icon-button" title={t("Read-only")} aria-label={t("Canvas read-only mode")} onClick={() => setReadOnly(!readOnly)}>{readOnly ? <Lock size={16}/> : <Unlock size={16}/>}</button><label className="canvas-snap"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)}/>{" " + t("Grid")}</label><button className="icon-button" aria-label={t("Export Canvas as PNG")} onClick={exportImage}><Download size={16}/></button></div>
    {!readOnly && (selection.size > 0 || edge) && <div className="canvas-selection-tools canvas-overlay"><MousePointer2 size={14}/><span>{edge ? t("Connection") : t("{v0} selected", { v0: selection.size })}</span><button className="icon-button" title={t("Remove selection")} aria-label={t("Remove Canvas selection")} onClick={removeSelection}><Trash2 size={15}/></button>{selection.size > 0 && <><button className="icon-button" aria-label={t("Duplicate cards")} onClick={duplicate}><Copy size={15}/></button><button className="icon-button" aria-label={t("Connect selection")} onClick={() => setConnectFrom([...selection][0])}><Link2 size={15}/></button>{selection.size > 1 && <><button className="icon-button" aria-label={t("Group selection")} onClick={groupSelection}><Group size={15}/></button><select aria-label={t("Align cards")} defaultValue="" onChange={(event) => { align(event.target.value); event.target.value = ''; }}><option value="" disabled>{t("Align\u2026")}</option><option value="left">{t("Left")}</option><option value="top">{t("Top")}</option><option value="row">{t("Row")}</option><option value="column">{t("Column")}</option></select></>}</>}<Palette size={14}/>{Object.keys(colors).map((value) => <button key={value} className="canvas-color" style={{ background: colors[value] }} aria-label={t("Color {v0}", { v0: value })} onClick={() => selectedColor(value)}/>)}{edge && <><input aria-label={t("Connection label")} placeholder={t("Label")} value={edge.label || ''} onChange={(event) => commit({ ...dataRef.current, edges: dataRef.current.edges.map((item) => item.id === edge.id ? { ...item, label: event.target.value } : item) })}/><select aria-label={t("Connection direction")} value={edge.fromEnd === 'arrow' ? 'both' : edge.toEnd === 'none' ? 'none' : 'to'} onChange={(event) => commit({ ...dataRef.current, edges: dataRef.current.edges.map((item) => item.id === edge.id ? { ...item, fromEnd: event.target.value === 'both' ? 'arrow' : 'none', toEnd: event.target.value === 'none' ? 'none' : 'arrow' } : item) })}><option value="to">{t("Directed")}</option><option value="both">{t("Bidirectional")}</option><option value="none">{t("Undirected")}</option></select></>}</div>}
    {connectFrom && <div className="canvas-connect-notice canvas-overlay">{t("Drag the connection or click the target card.")}<button className="mini-icon" onClick={() => setConnectFrom(null)} aria-label={t("Cancel connection")}><X size={13}/></button></div>}
    <div className="canvas-bottom-controls canvas-overlay"><div className="canvas-add-tools"><button className="icon-button" disabled={readOnly} aria-label={t("Add text card")} title={t("Text")} onClick={() => addNode('text')}><Type size={18}/></button><button className="icon-button" disabled={readOnly} aria-label={t("Add file to Canvas")} title={t("File")} onClick={() => setFilePicker(!filePicker)}><FilePlus2 size={18}/></button><button className="icon-button" disabled={readOnly} aria-label={t("Add page to Canvas")} title={t("Page")} onClick={() => setLinkEditor(!linkEditor)}><Link2 size={18}/></button><button className="icon-button" disabled={readOnly} aria-label={t("Add group")} title={t("Group")} onClick={groupSelection}><Group size={18}/></button></div><div className="canvas-zoom-tools"><button className="icon-button" disabled={!undo.current.length || readOnly} aria-label={t("Undo in Canvas")} onClick={() => moveHistory('undo')}><Undo2 size={17}/></button><button className="icon-button" disabled={!redo.current.length || readOnly} aria-label={t("Redo in Canvas")} onClick={() => moveHistory('redo')}><Redo2 size={17}/></button><button className="icon-button" aria-label={t("Zoom out of Canvas")} onClick={() => zoom(1 / 1.2)}><Minus size={17}/></button><span>{Math.round(camera.scale * 100)}%</span><button className="icon-button" aria-label={t("Zoom into Canvas")} onClick={() => zoom(1.2)}><Plus size={17}/></button><button className="icon-button" aria-label={t("Fit Canvas")} onClick={() => fit()}><Focus size={17}/></button></div></div>
    {filePicker && <div className="canvas-file-picker canvas-overlay"><input autoFocus aria-label={t("Find file for card")} placeholder={t("Search files\u2026")} value={fileQuery} onChange={(event) => setFileQuery(event.target.value)}/>{files.filter((file) => file.kind !== 'folder' && !file.path.endsWith('.canvas') && file.path.toLocaleLowerCase().includes(fileQuery.toLocaleLowerCase())).map((file) => <button key={file.path} onClick={() => { addNode('file', { file: file.path }); setFilePicker(false); }}>{file.path}</button>)}</div>}
    {linkEditor && <form className="canvas-link-editor canvas-overlay" onSubmit={(event) => {
                event.preventDefault();
                try {
                    const parsed = new URL(url);
                    if (!['https:', 'http:'].includes(parsed.protocol))
                        throw new Error();
                    addNode('link', { url: parsed.href });
                    setLinkEditor(false);
                    setUrl('');
                }
                catch {
                    onNotice(t("Enter a valid HTTP or HTTPS URL."));
                }
            }}><input autoFocus type="url" required aria-label={t("Card URL")} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…"/><button className="icon-button" aria-label={t("Add link")}><Check size={16}/></button></form>}
    {!data.nodes.length && <div className="canvas-empty"><h2>{t("Your space to connect ideas")}</h2><p>{t("Double-click to create a card, or drag a file from the explorer.")}</p></div>}
  </section>;
}
