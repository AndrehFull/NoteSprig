import { t, getLocale } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Image, Table2, LayoutDashboard } from 'lucide-react';
import type { NoteSummary } from '../types';
import { baseName } from '../knowledge';
type TreeEntry = {
    path: string;
    name: string;
    children: Map<string, TreeEntry>;
    note?: NoteSummary;
};
export function FileTree({ notes, activePath, onOpen, onAction, onMove }: {
    notes: NoteSummary[];
    activePath?: string;
    onOpen: (path: string) => void;
    onAction?: (action: string, path: string, folder: boolean) => void;
    onMove?: (from: string, to: string) => void;
}) {
    const [collapsed, setCollapsed] = useState<Set<string>>(() => {
        try {
            return new Set(JSON.parse(localStorage.getItem('notesprig.folders') || '[]'));
        }
        catch {
            return new Set();
        }
    });
    const [menu, setMenu] = useState<{
        x: number;
        y: number;
        entry: TreeEntry;
    } | null>(null);
    const root = useMemo(() => {
        const tree: TreeEntry = { name: '', path: '', children: new Map() };
        for (const note of notes) {
            let parent = tree;
            const segments = note.path.split('/');
            segments.forEach((name, index) => {
                const path = segments.slice(0, index + 1).join('/');
                if (!parent.children.has(name))
                    parent.children.set(name, { name, path, children: new Map() });
                parent = parent.children.get(name)!;
                if (index === segments.length - 1 && note.kind !== 'folder')
                    parent.note = note;
            });
        }
        return tree;
    }, [notes]);
    useEffect(() => {
        if (activePath)
            setCollapsed((current) => new Set([...current].filter((folder) => !activePath.startsWith(`${folder}/`))));
    }, [activePath]);
    useEffect(() => { localStorage.setItem('notesprig.folders', JSON.stringify([...collapsed])); }, [collapsed]);
    useEffect(() => {
        const close = (event: Event) => {
            if (!(event.target as HTMLElement).closest('.file-context-menu'))
                setMenu(null);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape')
                setMenu(null);
        };
        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', escape);
        return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
    }, []);
    function context(event: React.MouseEvent, entry: TreeEntry) { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 210), y: Math.max(10, Math.min(event.clientY, window.innerHeight - 315)), entry }); }
    function drop(event: React.DragEvent, folder: string) {
        event.preventDefault();
        event.stopPropagation();
        const from = event.dataTransfer.getData('text/x-notesprig-file');
        if (from && onMove) {
            const target = `${folder ? `${folder}/` : ''}${from.split('/').at(-1)}`;
            if (from !== target)
                onMove(from, target);
        }
    }
    function entries(parent: TreeEntry, depth: number): React.ReactNode {
        return [...parent.children.values()].sort((a, b) => Number(Boolean(a.note)) - Number(Boolean(b.note)) || a.name.localeCompare(b.name, getLocale(), { numeric: true })).map((entry) => {
            const open = !collapsed.has(entry.path);
            const drag = { draggable: true, onDragStart: (event: React.DragEvent) => { event.dataTransfer.setData('text/x-notesprig-file', entry.path); event.dataTransfer.effectAllowed = 'copyMove'; } };
            if (entry.note)
                return <div role="treeitem" aria-selected={activePath === entry.path} key={entry.path}><button {...drag} className={`tree-file ${activePath === entry.path ? 'selected' : ''}`} style={{ paddingLeft: 12 + depth * 15 }} onClick={() => onOpen(entry.path)} onContextMenu={(event) => context(event, entry)} title={entry.path}>{entry.note.kind === 'base' ? <Table2 size={14}/> : entry.note.kind === 'canvas' ? <LayoutDashboard size={14}/> : entry.note.kind === 'attachment' ? <Image size={14}/> : <FileText size={14}/>}<span>{baseName(entry.name)}</span></button></div>;
            return <div key={entry.path} role="treeitem" aria-expanded={open} aria-label={entry.name}><button {...drag} className="tree-folder" style={{ paddingLeft: 6 + depth * 15 }} onClick={() => setCollapsed((current) => {
                    const next = new Set(current);
                    if (open)
                        next.add(entry.path);
                    else
                        next.delete(entry.path);
                    return next;
                })} onContextMenu={(event) => context(event, entry)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, entry.path)}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}{open ? <FolderOpen size={14}/> : <Folder size={14}/>}<span>{entry.name}</span></button>{open && <div role="group">{entries(entry, depth + 1)}</div>}</div>;
        });
    }
    const actions = menu?.entry.note ? [['open', t("Open")], ['rename', t("Rename / move\u2026")], ['duplicate', t("Duplicate")], ['merge', t("Merge into another note\u2026")], ['bookmark', t("Bookmark")], ['history', t("Version history")], ['download', t("Download file")], ['delete', t("Move to trash")]] : [['new', t("New note")], ['canvas', t("New Canvas")], ['base', t("New base")], ['folder', t("New folder")], ['rename', t("Rename / move folder\u2026")], ['delete', t("Move folder to trash")]];
    return <><div role="tree" aria-label={t("Vault files")} className="file-tree" onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, '')}>{entries(root, 0)}</div>{menu && <div className="file-context-menu" role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y }}>{actions.filter(([action]) => (action !== 'history' || menu.entry.note?.kind !== 'attachment') && (action !== 'merge' || /\.md$/i.test(menu.entry.path))).map(([action, label]) => <button key={action} role="menuitem" onClick={() => {
                    if (action === 'open')
                        onOpen(menu.entry.path);
                    else
                        onAction?.(action, menu.entry.path, !menu.entry.note);
                    setMenu(null);
                }}>{label}</button>)}</div>}</>;
}
