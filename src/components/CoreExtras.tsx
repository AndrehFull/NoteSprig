import { t, translateMessage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, ExternalLink, Mic, Square, X } from 'lucide-react';
import { RichPreview } from './RichPreview';
import { getLocal, setLocal, removeLocal } from '../storage';
import { stripFrontmatter } from '../markdown';
import type { NoteSummary } from '../types';
export function AudioRecorder({ onRecorded, onNotice, onStateChange }: {
    onRecorded: (file: File) => Promise<void>;
    onNotice: (message: string) => void;
    onStateChange?: (busy: boolean) => void;
}) {
    const [recording, setRecording] = useState(false), [elapsed, setElapsed] = useState(0), [busy, setBusy] = useState(false), [unsaved, setUnsaved] = useState<File | null>(null);
    const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]);
    const callbacks = useRef({ onRecorded, onNotice });
    callbacks.current = { onRecorded, onNotice };
    useEffect(() => { void getLocal<File>('recording').then((file) => { if (file?.size) {
        setUnsaved(file);
        callbacks.current.onNotice(t("An unfinished recording was recovered from this browser."));
    } }).catch(() => { }); }, []);
    useEffect(() => { onStateChange?.(Boolean(recording || busy || unsaved)); const warn = (event: BeforeUnloadEvent) => { if (recording || busy || unsaved) {
        event.preventDefault();
        event.returnValue = '';
    } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [recording, busy, unsaved, onStateChange]);
    useEffect(() => { if (!recording)
        return; const timer = setInterval(() => setElapsed((value) => value + 1), 1000); return () => clearInterval(timer); }, [recording]);
    useEffect(() => () => { if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null;
        recorder.current.stop();
    } stream.current?.getTracks().forEach((track) => track.stop()); }, []);
    async function toggle() {
        if (recording) {
            recorder.current?.stop();
            setRecording(false);
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            onNotice(t("Recording requires a compatible browser and HTTPS or localhost."));
            return;
        }
        setBusy(true);
        try {
            const target = callbacks.current.onRecorded;
            const media = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.current = media;
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '';
            const instance = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media);
            recorder.current = instance;
            chunks.current = [];
            const filename = `Recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${instance.mimeType.includes('ogg') ? 'ogg' : 'webm'}`;
            instance.ondataavailable = (event) => { if (event.data.size) {
                chunks.current.push(event.data);
                void setLocal('recording', new File(chunks.current, filename, { type: instance.mimeType })).catch(() => { });
            } };
            instance.onstop = async () => { media.getTracks().forEach((track) => track.stop()); const file = new File(chunks.current, `Recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${instance.mimeType.includes('ogg') ? 'ogg' : 'webm'}`, { type: instance.mimeType }); setRecording(false); setBusy(true); try {
                await target(file);
                setUnsaved(null);
                await removeLocal('recording');
            }
            catch {
                setUnsaved(file);
                callbacks.current.onNotice(t("The audio was preserved on this device. Use Download to save the recording."));
            }
            finally {
                setBusy(false);
            } };
            instance.start(1000);
            setElapsed(0);
            setRecording(true);
        }
        catch (error) {
            callbacks.current.onNotice(error instanceof Error ? error.message : t("Could not open the microphone."));
        }
        finally {
            setBusy(false);
        }
    }
    return <><button className={`icon-button ${recording ? 'recording' : ''}`} disabled={busy || Boolean(unsaved)} title={recording ? t("Stop recording ({v0}s)", { v0: elapsed }) : t("Record audio")} aria-label={recording ? t("Stop recording") : t("Record audio")} onClick={() => void toggle()}>{recording ? <Square size={17}/> : <Mic size={18}/>}</button>{recording && <span className="recording-time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>}{unsaved && <button className="icon-button recording" aria-label={t("Download pending recording")} title={t("Download pending recording")} onClick={() => { const url = URL.createObjectURL(unsaved); const anchor = document.createElement('a'); anchor.href = url; anchor.download = unsaved.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setUnsaved(null); void removeLocal('recording'); }}><Download size={17}/></button>}</>;
}
export function SlidesView({ content, path, files, onClose }: {
    content: string;
    path: string;
    files: NoteSummary[];
    onClose: () => void;
}) {
    const [index, setIndex] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => { root.current?.focus(); }, []);
    const slides: string[] = [];
    let fence = '', current: string[] = [];
    for (const line of stripFrontmatter(content).split('\n')) {
        const marker = line.match(/^\s*(`{3,}|~{3,})/);
        if (marker)
            fence = fence ? '' : marker[1][0];
        if (!fence && /^\s*---+\s*$/.test(line)) {
            slides.push(current.join('\n'));
            current = [];
        }
        else
            current.push(line);
    }
    slides.push(current.join('\n'));
    useEffect(() => { const handler = (event: KeyboardEvent) => { if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        setIndex((value) => Math.min(value + 1, slides.length - 1));
    } if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        setIndex((value) => Math.max(value - 1, 0));
    } if (event.key === 'Escape')
        onClose(); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [slides.length, onClose]);
    return <div className="slides-view" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t("Slideshow")}><button className="icon-button slides-close" aria-label={t("Close slideshow")} onClick={onClose}><X size={21}/></button><div className="slide-content"><RichPreview content={slides[index] || ''} path={path} files={files}/></div><div className="slides-controls"><button className="icon-button" aria-label={t("Previous slide")} disabled={index === 0} onClick={() => setIndex((value) => value - 1)}><ArrowLeft size={20}/></button><span>{index + 1} / {slides.length}</span><button className="icon-button" aria-label={t("Next slide")} disabled={index >= slides.length - 1} onClick={() => setIndex((value) => value + 1)}><ArrowRight size={20}/></button></div></div>;
}
export function WebView({ initialUrl }: {
    initialUrl: string;
}) {
    const [address, setAddress] = useState(initialUrl), [url, setUrl] = useState(initialUrl), [error, setError] = useState('');
    return <section className="web-view" aria-label={t("Web viewer")}><form onSubmit={(event) => { event.preventDefault(); try {
        const parsed = new URL(address.includes('://') ? address : `https://${address}`);
        if (!['https:', 'http:'].includes(parsed.protocol))
            throw new Error();
        setUrl(parsed.href);
        setAddress(parsed.href);
        setError('');
    }
    catch {
        setError(t("Enter a valid HTTP or HTTPS address."));
    } }}><input aria-label={t("Page address")} value={address} onChange={(event) => setAddress(event.target.value)}/><button className="quiet-button">{t("Open")}</button><a className="icon-button" href={/^https?:\/\//i.test(url) ? url : undefined} target="_blank" rel="noopener noreferrer" aria-label={t("Open in browser")}><ExternalLink size={17}/></a></form>{error && <p className="form-error">{translateMessage(error)}</p>}{/^https?:\/\//i.test(url) && <iframe title={t("External page")} src={url} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/>}<p className="web-frame-note">{t("Some sites can only be opened in the browser. Use the external-open button when needed.")}</p></section>;
}
