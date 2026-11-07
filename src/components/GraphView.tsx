import { t } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { Focus, List, Minus, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { buildKnowledgeGraph, matchesQuery, type KnowledgeNode } from '../knowledge';
import type { NoteSummary } from '../types';
type Node = KnowledgeNode & SimulationNodeDatum;
type Edge = {
    source: Node;
    target: Node;
};
type Layout = {
    ids: string;
    positions: Map<string, {
        x: number;
        y: number;
    }>;
    scale: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
};
const layouts = new Map<string, Layout>();
type Settings = {
    query: string;
    showTags: boolean;
    showUnresolved: boolean;
    showOrphans: boolean;
    showAttachments: boolean;
    depth: number;
    labels: boolean;
    arrows: boolean;
    nodeSize: number;
    linkWidth: number;
    repulsion: number;
    distance: number;
    centerForce: number;
    linkForce: number;
    groups: {
        query: string;
        color: string;
    }[];
};
const defaults: Settings = {
    query: '', showTags: false, showUnresolved: true, showOrphans: true, showAttachments: false, depth: 1,
    labels: true, arrows: false, nodeSize: 5, linkWidth: 1, repulsion: 180, distance: 100,
    centerForce: 0.035, linkForce: 0.4, groups: [],
};
function readSettings(scope: string, compact: boolean): Settings {
    try {
        const stored = JSON.parse(localStorage.getItem(`notesprig.graph.${scope}`) || '{}');
        return { ...defaults, ...stored, ...(compact ? { query: '', showOrphans: true } : {}), groups: Array.isArray(stored.groups) ? stored.groups : [] };
    }
    catch {
        return defaults;
    }
}
export function GraphView({ notes, files = [], focusPath, compact = false, onOpen }: {
    notes: NoteSummary[];
    files?: NoteSummary[];
    focusPath?: string;
    compact?: boolean;
    onOpen: (node: KnowledgeNode) => void;
}) {
    const scope = focusPath ? 'local' : 'global';
    const [settings, setSettings] = useState<Settings>(() => readSettings(scope, compact));
    const [panel, setPanel] = useState(false);
    const [listOpen, setListOpen] = useState(false);
    const [hover, setHover] = useState<KnowledgeNode | null>(null);
    const [zoomLabel, setZoomLabel] = useState(100);
    const host = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const controls = useRef<{
        zoom: (factor: number) => void;
        fit: () => void;
        redraw: () => void;
    }>({ zoom() { }, fit() { }, redraw() { } });
    const latest = useRef({ settings, onOpen });
    latest.current = { settings, onOpen };
    const graph = useMemo(() => buildKnowledgeGraph(notes, { ...settings, files, focusPath }), [notes, files, settings.query, settings.showTags, settings.showUnresolved, settings.showOrphans, settings.showAttachments, settings.depth, focusPath]);
    useEffect(() => {
        if (!compact)
            localStorage.setItem(`notesprig.graph.${scope}`, JSON.stringify(settings));
    }, [settings, compact, scope]);
    const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
    useEffect(() => {
        if (!host.current || !canvas.current)
            return;
        const element = canvas.current;
        const context = element.getContext('2d');
        if (!context)
            return;
        const layoutKey = compact ? `compact:${focusPath}` : focusPath ? `local:${focusPath}` : 'global';
        const previousLayout = layouts.get(layoutKey);
        const ids = JSON.stringify([graph.nodes.map((node) => node.id), graph.edges.map((edge) => [edge.source, edge.target])]);
        const reuseLayout = previousLayout?.ids === ids && previousLayout.width > 1;
        const nodes: Node[] = graph.nodes.map((node) => ({ ...node, ...previousLayout?.positions.get(node.id) }));
        const byId = new Map(nodes.map((node) => [node.id, node]));
        const edges: Edge[] = graph.edges.map((edge) => ({ source: byId.get(edge.source)!, target: byId.get(edge.target)! }));
        const neighbors = new Map<string, Set<string>>();
        for (const edge of edges) {
            if (!neighbors.has(edge.source.id))
                neighbors.set(edge.source.id, new Set());
            if (!neighbors.has(edge.target.id))
                neighbors.set(edge.target.id, new Set());
            neighbors.get(edge.source.id)!.add(edge.target.id);
            neighbors.get(edge.target.id)!.add(edge.source.id);
        }
        let width = 1, height = 1, scale = compact ? 0.65 : 1, offsetX = 0, offsetY = 0;
        let hovered: Node | null = null;
        let gesture: {
            id: number;
            x: number;
            y: number;
            moved: boolean;
            node: Node | null;
        } | null = null;
        let frame = 0;
        let disposed = false;
        function radius(node: Node) { return (compact ? 3.5 : latest.current.settings.nodeSize) + Math.min(12, Math.sqrt(node.degree) * 1.4); }
        function color(node: Node) {
            const group = latest.current.settings.groups.find((item) => item.query.trim() && matchesQuery(node, item.query));
            if (group)
                return group.color;
            if (node.id === focusPath)
                return '#b59aff';
            return node.kind === 'tag' ? '#78c2ab' : node.kind === 'attachment' ? '#78a7cc' : node.kind === 'ambiguous' ? '#e2b86f' : node.kind === 'unresolved' ? '#6b6875' : '#aaa6b5';
        }
        function draw() {
            frame = 0;
            const ctx = context!;
            const dpr = window.devicePixelRatio || 1;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
            ctx.scale(scale, scale);
            const options = latest.current.settings;
            const styles = getComputedStyle(element);
            const lineColor = styles.getPropertyValue('--graph-line').trim();
            const dimColor = styles.getPropertyValue('--graph-dim').trim();
            for (const edge of edges) {
                const near = hovered && (edge.source.id === hovered.id || edge.target.id === hovered.id);
                ctx.strokeStyle = hovered ? (near ? '#9c7ee2' : dimColor) : lineColor;
                ctx.lineWidth = (near ? options.linkWidth + 0.5 : options.linkWidth) / Math.sqrt(scale);
                ctx.beginPath();
                ctx.moveTo(edge.source.x || 0, edge.source.y || 0);
                ctx.lineTo(edge.target.x || 0, edge.target.y || 0);
                ctx.stroke();
                if (options.arrows && !compact) {
                    const angle = Math.atan2((edge.target.y || 0) - (edge.source.y || 0), (edge.target.x || 0) - (edge.source.x || 0));
                    const x = (edge.target.x || 0) - Math.cos(angle) * (radius(edge.target) + 3);
                    const y = (edge.target.y || 0) - Math.sin(angle) * (radius(edge.target) + 3);
                    ctx.fillStyle = near ? '#b59aff' : '#686371';
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x - Math.cos(angle - 0.45) * 7, y - Math.sin(angle - 0.45) * 7);
                    ctx.lineTo(x - Math.cos(angle + 0.45) * 7, y - Math.sin(angle + 0.45) * 7);
                    ctx.fill();
                }
            }
            for (const node of nodes) {
                const near = !hovered || hovered.id === node.id || neighbors.get(hovered.id)?.has(node.id);
                const r = radius(node);
                ctx.globalAlpha = near ? 1 : 0.22;
                ctx.fillStyle = hovered?.id === node.id ? '#c9b5ff' : color(node);
                ctx.beginPath();
                ctx.arc(node.x || 0, node.y || 0, r, 0, Math.PI * 2);
                if (node.kind === 'unresolved' || node.kind === 'ambiguous') {
                    ctx.strokeStyle = ctx.fillStyle;
                    ctx.lineWidth = 1.4 / scale;
                    ctx.stroke();
                }
                else
                    ctx.fill();
                if (node.id === focusPath) {
                    ctx.strokeStyle = '#a487e8';
                    ctx.lineWidth = 1 / scale;
                    ctx.beginPath();
                    ctx.arc(node.x || 0, node.y || 0, r + 4, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (hovered?.id === node.id || (options.labels && (!compact || scale > 0.75) && (scale > 0.4 || node.degree > 3))) {
                    ctx.globalAlpha = near ? Math.min(1, scale + 0.25) : 0.2;
                    ctx.font = `${(compact ? 10 : 12) / Math.sqrt(scale)}px system-ui, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillStyle = styles.getPropertyValue('--graph-label').trim();
                    ctx.fillText(node.label.length > 45 ? `${node.label.slice(0, 42)}…` : node.label, node.x || 0, (node.y || 0) + r + 6);
                }
            }
            ctx.globalAlpha = 1;
        }
        function redraw() {
            if (!disposed && !frame)
                frame = requestAnimationFrame(draw);
        }
        function setZoom(next: number, x = width / 2, y = height / 2) {
            const value = Math.max(0.08, Math.min(5, next));
            offsetX = x - width / 2 - ((x - width / 2 - offsetX) / scale) * value;
            offsetY = y - height / 2 - ((y - height / 2 - offsetY) / scale) * value;
            scale = value;
            setZoomLabel(Math.round(scale * 100));
            redraw();
        }
        function fit() {
            if (!nodes.length)
                return;
            const xs = nodes.map((node) => node.x || 0), ys = nodes.map((node) => node.y || 0);
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            scale = Math.max(0.08, Math.min(compact ? 0.9 : 1.6, (width - 100) / (maxX - minX + 80), (height - 100) / (maxY - minY + 80)));
            offsetX = -(minX + maxX) / 2 * scale;
            offsetY = -(minY + maxY) / 2 * scale;
            setZoomLabel(Math.round(scale * 100));
            redraw();
        }
        controls.current = { zoom: (factor) => setZoom(scale * factor), fit, redraw };
        const simulation = forceSimulation(nodes)
            .force('links', forceLink<Node, Edge>(edges).id((node) => node.id).distance(settings.distance).strength(settings.linkForce))
            .force('charge', forceManyBody<Node>().strength(-settings.repulsion))
            .force('collide', forceCollide<Node>().radius((node) => radius(node) + 14))
            .force('x', forceX<Node>(0).strength(settings.centerForce))
            .force('y', forceY<Node>(0).strength(settings.centerForce))
            .alphaDecay(0.035).on('tick', redraw);
        simulation.stop().tick(reuseLayout ? 0 : 90);
        const observer = new ResizeObserver(([entry]) => {
            const first = width === 1;
            width = entry.contentRect.width;
            height = entry.contentRect.height;
            const dpr = window.devicePixelRatio || 1;
            element.width = Math.round(width * dpr);
            element.height = Math.round(height * dpr);
            if (first && reuseLayout && previousLayout) {
                scale = previousLayout.scale;
                offsetX = previousLayout.offsetX;
                offsetY = previousLayout.offsetY;
                setZoomLabel(Math.round(scale * 100));
                redraw();
            }
            else if (first)
                fit();
            else
                redraw();
        });
        observer.observe(host.current);
        const themeObserver = new MutationObserver(redraw);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        if (!reuseLayout && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            simulation.alpha(0.2).restart();
        function hit(x: number, y: number) {
            const worldX = (x - width / 2 - offsetX) / scale, worldY = (y - height / 2 - offsetY) / scale;
            return [...nodes].reverse().find((node) => Math.hypot((node.x || 0) - worldX, (node.y || 0) - worldY) < radius(node) + 7 / scale) || null;
        }
        function position(event: PointerEvent | WheelEvent) { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
        function pointerDown(event: PointerEvent) {
            if (event.button !== 0)
                return;
            const { x, y } = position(event);
            const node = hit(x, y);
            gesture = { id: event.pointerId, x, y, node, moved: false };
            element.setPointerCapture(event.pointerId);
            element.focus();
            if (node) {
                node.fx = node.x;
                node.fy = node.y;
                simulation.alphaTarget(0.15).restart();
            }
        }
        function pointerMove(event: PointerEvent) {
            const { x, y } = position(event);
            if (gesture && gesture.id === event.pointerId) {
                const dx = x - gesture.x, dy = y - gesture.y;
                if (Math.hypot(dx, dy) > 3)
                    gesture.moved = true;
                if (gesture.moved) {
                    if (gesture.node) {
                        gesture.node.fx = (x - width / 2 - offsetX) / scale;
                        gesture.node.fy = (y - height / 2 - offsetY) / scale;
                    }
                    else {
                        offsetX += dx;
                        offsetY += dy;
                    }
                    gesture.x = x;
                    gesture.y = y;
                    redraw();
                }
            }
            else {
                const node = hit(x, y);
                if (node?.id !== hovered?.id) {
                    hovered = node;
                    setHover(node);
                    element.style.cursor = node ? 'pointer' : 'grab';
                    redraw();
                }
            }
        }
        function pointerUp(event: PointerEvent) {
            if (!gesture || gesture.id !== event.pointerId)
                return;
            const previous = gesture;
            gesture = null;
            if (previous.node) {
                previous.node.fx = null;
                previous.node.fy = null;
                simulation.alphaTarget(0);
            }
            if (element.hasPointerCapture(event.pointerId))
                element.releasePointerCapture(event.pointerId);
            if (event.type !== 'pointercancel' && !previous.moved && previous.node)
                latest.current.onOpen(previous.node);
        }
        function leave() {
            if (!gesture) {
                hovered = null;
                setHover(null);
                redraw();
            }
        }
        function wheel(event: WheelEvent) { event.preventDefault(); const { x, y } = position(event); setZoom(scale * Math.exp(-event.deltaY * 0.0015), x, y); }
        function keydown(event: KeyboardEvent) {
            if (event.key === '+' || event.key === '=')
                setZoom(scale * 1.2);
            else if (event.key === '-')
                setZoom(scale / 1.2);
            else if (event.key === 'Home' || event.key === '0')
                fit();
            else if (event.key.startsWith('Arrow')) {
                const step = event.shiftKey ? 100 : 30;
                if (event.key === 'ArrowLeft')
                    offsetX += step;
                if (event.key === 'ArrowRight')
                    offsetX -= step;
                if (event.key === 'ArrowUp')
                    offsetY += step;
                if (event.key === 'ArrowDown')
                    offsetY -= step;
                redraw();
            }
            else
                return;
            event.preventDefault();
        }
        element.addEventListener('pointerdown', pointerDown);
        element.addEventListener('pointermove', pointerMove);
        element.addEventListener('pointerup', pointerUp);
        element.addEventListener('pointercancel', pointerUp);
        element.addEventListener('pointerleave', leave);
        element.addEventListener('wheel', wheel, { passive: false });
        element.addEventListener('keydown', keydown);
        return () => {
            layouts.set(layoutKey, { ids, scale, offsetX, offsetY, width, height, positions: new Map(nodes.map((node) => [node.id, { x: node.x || 0, y: node.y || 0 }])) });
            disposed = true;
            simulation.stop();
            observer.disconnect();
            themeObserver.disconnect();
            cancelAnimationFrame(frame);
            element.removeEventListener('pointerdown', pointerDown);
            element.removeEventListener('pointermove', pointerMove);
            element.removeEventListener('pointerup', pointerUp);
            element.removeEventListener('pointercancel', pointerUp);
            element.removeEventListener('pointerleave', leave);
            element.removeEventListener('wheel', wheel);
            element.removeEventListener('keydown', keydown);
        };
    }, [graph, focusPath, compact, settings.distance, settings.repulsion, settings.linkForce, settings.centerForce, settings.nodeSize]);
    useEffect(() => { controls.current.redraw(); }, [settings.labels, settings.arrows, settings.linkWidth, settings.groups]);
    return <section className={`graph-view ${compact ? 'compact-graph' : ''}`} aria-label={focusPath ? t("Local graph") : t("Global graph")} data-node-count={graph.nodes.length} data-edge-count={graph.edges.length}>
    <div ref={host} className="graph-surface"><canvas ref={canvas} tabIndex={0} aria-label={t("Connection map. Drag to move; use plus and minus to zoom. Use the node list to open notes with the keyboard.")}/></div>
    {!compact && <>
      <div className="graph-heading"><strong>{focusPath ? t("Local graph") : t("Graph view")}</strong><span>{graph.nodes.length}{" " + t("nodes \u00B7") + " "}{graph.edges.length}{" " + t("connections")}</span></div>
      <div className="graph-controls"><button className={listOpen ? 'active icon-button' : 'icon-button'} onClick={() => setListOpen(!listOpen)} title={t("Node list")} aria-label={t("Node list")}><List size={17}/></button><button className={panel ? 'active icon-button' : 'icon-button'} onClick={() => setPanel(!panel)} title={t("Graph settings")} aria-label={t("Graph settings")}><Settings2 size={17}/></button></div>
      {panel && <aside className="graph-settings" aria-label={t("Graph settings")}>
        <div className="graph-panel-heading"><strong>{t("Graph")}</strong><button className="icon-button" title={t("Restore defaults")} aria-label={t("Restore defaults")} onClick={() => setSettings({ ...defaults })}><RotateCcw size={14}/></button><button className="icon-button" onClick={() => setPanel(false)} aria-label={t("Close graph settings")}><X size={15}/></button></div>
        <details open><summary>{t("Filters")}</summary><label className="graph-query-label">{t("Filter files")}<input aria-label={t("Filter graph files")} placeholder={t("name, path:Projects, tag:ideas")} value={settings.query} onChange={(event) => update('query', event.target.value)}/></label>
          {focusPath && <label className="graph-range">{t("Depth") + " "}<output>{settings.depth}</output><input aria-label={t("Depth")} type="range" min="1" max="5" value={settings.depth} onChange={(event) => update('depth', +event.target.value)}/></label>}
          <label className="graph-toggle">{t("Tags")}<input type="checkbox" checked={settings.showTags} onChange={(event) => update('showTags', event.target.checked)}/></label>
          <label className="graph-toggle">{t("Attachments and Canvas")}<input type="checkbox" checked={settings.showAttachments} onChange={(event) => update('showAttachments', event.target.checked)}/></label>
          <label className="graph-toggle">{t("Existing files only")}<input type="checkbox" checked={!settings.showUnresolved} onChange={(event) => update('showUnresolved', !event.target.checked)}/></label>
          <label className="graph-toggle">{t("Orphan notes")}<input type="checkbox" checked={settings.showOrphans} onChange={(event) => update('showOrphans', event.target.checked)}/></label>
        </details>
        <details><summary>{t("Groups")}</summary><p className="graph-description">{t("Use a name, path:, or tag: to color a group.")}</p>{settings.groups.map((group, index) => <div className="graph-group" key={index}><input aria-label={t("Group {v0} color", { v0: index + 1 })} type="color" value={group.color} onChange={(event) => update('groups', settings.groups.map((item, i) => i === index ? { ...item, color: event.target.value } : item))}/><input aria-label={t("Group {v0} filter", { v0: index + 1 })} placeholder={t("path:Projects")} value={group.query} onChange={(event) => update('groups', settings.groups.map((item, i) => i === index ? { ...item, query: event.target.value } : item))}/><button className="mini-icon" onClick={() => update('groups', settings.groups.filter((_item, i) => i !== index))} aria-label={t("Remove group {v0}", { v0: index + 1 })}><X size={13}/></button></div>)}<button className="text-action" onClick={() => update('groups', [...settings.groups, { query: '', color: '#a78bfa' }])}><Plus size={14}/>{" " + t("New group")}</button></details>
        <details><summary>{t("Display")}</summary><label className="graph-toggle">{t("Note names")}<input type="checkbox" checked={settings.labels} onChange={(event) => update('labels', event.target.checked)}/></label><label className="graph-toggle">{t("Arrows")}<input type="checkbox" checked={settings.arrows} onChange={(event) => update('arrows', event.target.checked)}/></label><label className="graph-range">{t("Node size")}<input aria-label={t("Node size")} type="range" min="2" max="12" value={settings.nodeSize} onChange={(event) => update('nodeSize', +event.target.value)}/></label><label className="graph-range">{t("Link thickness")}<input aria-label={t("Link thickness")} type="range" min="0.3" max="4" step="0.1" value={settings.linkWidth} onChange={(event) => update('linkWidth', +event.target.value)}/></label></details>
        <details><summary>{t("Forces")}</summary><label className="graph-range">{t("Center force")}<input aria-label={t("Center force")} type="range" min="0" max="0.2" step="0.005" value={settings.centerForce} onChange={(event) => update('centerForce', +event.target.value)}/></label><label className="graph-range">{t("Repulsion")}<input aria-label={t("Repulsion")} type="range" min="20" max="600" step="10" value={settings.repulsion} onChange={(event) => update('repulsion', +event.target.value)}/></label><label className="graph-range">{t("Link force")}<input aria-label={t("Link force")} type="range" min="0.05" max="1" step="0.05" value={settings.linkForce} onChange={(event) => update('linkForce', +event.target.value)}/></label><label className="graph-range">{t("Link distance")}<input aria-label={t("Link distance")} type="range" min="30" max="250" value={settings.distance} onChange={(event) => update('distance', +event.target.value)}/></label></details>
      </aside>}
      {listOpen && <div className="graph-node-list" aria-label={t("Graph nodes")}><strong>{t("Notes and connections")}</strong>{graph.nodes.map((node) => <button key={node.id} onClick={() => onOpen(node)}><i className={`node-dot ${node.kind}`}/><span>{node.label}<small>{node.kind === 'tag' ? 'Tag' : node.kind === 'ambiguous' ? t("Ambiguous link") : node.path || t("Note not yet created")}</small></span><span>{node.degree}</span></button>)}{!graph.nodes.length && <p>{t("No nodes match the filters.")}</p>}</div>}
      <div className="graph-bottom"><span className="graph-help">{t("Drag to pan \u00B7 Scroll to zoom \u00B7 Click to open")}</span><div><button className="icon-button" onClick={() => controls.current.zoom(1 / 1.2)} aria-label={t("Zoom out")}><Minus size={16}/></button><span className="graph-zoom-value">{zoomLabel}%</span><button className="icon-button" onClick={() => controls.current.zoom(1.2)} aria-label={t("Zoom in")}><Plus size={16}/></button><button className="icon-button" onClick={() => controls.current.fit()} aria-label={t("Fit graph")}><Focus size={17}/></button></div></div>
    </>}
    {hover && <div className="graph-tooltip"><strong>{hover.label}</strong><span>{hover.path || (hover.kind === 'tag' ? 'Tag' : hover.kind === 'ambiguous' ? t("More than one note matches this link") : t("Note not yet created"))}</span><span>{hover.degree}{" " + t("connections")}</span></div>}
    {!graph.nodes.length && <div className="graph-empty"><strong>{notes.length ? t("No notes match the filters.") : t("The graph is empty.")}</strong><p>{notes.length ? t("Adjust filters to see more connections.") : t("Create notes and connect them with [[Note name]].")}</p></div>}
    {!compact && notes.length > 0 && graph.edges.length === 0 && graph.nodes.length > 0 && <p className="graph-no-links">{t("These notes have no visible connections yet. Use [[Note name]] to connect them.")}</p>}
  </section>;
}
