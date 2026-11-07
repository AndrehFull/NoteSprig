import { t } from '../i18n';
import { useRef } from 'react';
export function readSidebarWidth(key: string, fallback: number) {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= 180 && value <= 420 ? value : fallback;
}
export function SidebarResizer({ side, width, onResize }: {
    side: 'left' | 'right';
    width: number;
    onResize: (width: number) => void;
}) {
    const drag = useRef<{
        id: number;
        x: number;
        width: number;
    } | null>(null);
    function resize(value: number) { onResize(Math.max(180, Math.min(420, value))); }
    return <div className={`sidebar-resizer ${side}`} role="separator" aria-orientation="vertical" aria-label={t("{v0} panel width", { v0: side === 'left' ? t("left") : t("right") })} aria-valuemin={180} aria-valuemax={420} aria-valuenow={width} tabIndex={0} onPointerDown={(event) => {
            if (event.button !== 0)
                return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX, width };
        }} onPointerMove={(event) => {
            if (drag.current?.id === event.pointerId)
                resize(drag.current.width + (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1));
        }} onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => { drag.current = null; }} onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                resize(width + (event.key === 'ArrowRight' ? 15 : -15) * (side === 'left' ? 1 : -1));
            }
        }}/>;
}
