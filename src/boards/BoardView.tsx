import { translateMessage } from '../i18n';
import { prepareBoardOffline } from './offline';
import { convertCanvasToBoard, importExcalidraw, createPrivateBoardBundle, readPrivateBoardBundle, prepareImportedBoard, type ConvertedBoard } from './portability';
import { assetDataURL } from './session';
import { downloadFile as downloadBoardFile } from '../download';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { BoardEngine, createNoteCard, loadBoardRuntime, type BoardPreview } from './engine';
import { boardSession } from './session';
import { createSharingProjection } from './projection';
import { api } from '../api';
import { t } from '../i18n';
import { currentContext, refreshWorkspaceContext } from '../workspace';
import { boardCards, cardMetadata, sameContext, validateBoard, type ReferenceContext, type BoardElement } from '../../shared/board-schema.mjs';
import type { NoteSummary, Version } from '../types';

export default function BoardView({path,files,theme,onOpenNote,onSaved}:{path:string;files:NoteSummary[];theme:'light'|'dark';onOpenNote:(path:string,context:ReferenceContext)=>Promise<void>;onSaved:()=>void}) {
  const session=useMemo(()=>boardSession(path),[path]);
  const state=useSyncExternalStore(session.subscribe,session.snapshot);
  const engine=useRef<ExcalidrawImperativeAPI|null>(null);
  const imageInput=useRef<HTMLInputElement>(null);
  const importInput=useRef<HTMLInputElement>(null);
  const [candidate,setCandidate]=useState<ConvertedBoard|null>(null);
  const [importName,setImportName]=useState('');
  const [offlineReady,setOfflineReady]=useState(false);
  const [exportReport,setExportReport]=useState<string[]>([]);
  const [versions,setVersions]=useState<Version[]|null>(null);
  const [engineRevision,setEngineRevision]=useState(0);
  const [previews,setPreviews]=useState<Record<string,BoardPreview>>({});
  const [selected,setSelected]=useState<string[]>([]);
  const [target,setTarget]=useState('');
  const [notice,setNotice]=useState('');
  const [context,setContext]=useState(currentContext);
  const [review,setReview]=useState<Record<string,string>|null>(null);
  const [previewRevision,setPreviewRevision]=useState(0);
  const [viewport,setViewport]=useState({scrollX:0,scrollY:0,width:1440,height:900,zoom:1});
  const board=state.draft?.board;
  const stale=Boolean(board&&!sameContext(board.referenceContext,context));
  const needsReview=stale||Boolean(board&&boardCards(board).some(card=>cardMetadata(card)?.binding.state==='unbound'));
  const cards=useMemo(()=>board?boardCards(board):[],[board]);
  const visible=useMemo(()=>cards.filter(card=>{
    const x=(card.x+viewport.scrollX)*viewport.zoom,y=(card.y+viewport.scrollY)*viewport.zoom;
    return x+card.width*viewport.zoom>=0&&x<=viewport.width&&y+card.height*viewport.zoom>=0&&y<=viewport.height;
  }).slice(0,20),[cards,viewport]);
  const visibleIds=useMemo(()=>visible.map(card=>card.id),[visible]);
  useEffect(()=>{
    const refresh=(event:Event)=>{const changed=(event as CustomEvent<{path?:string}>).detail?.path;if(changed&&cards.some(card=>cardMetadata(card)?.binding.path===changed))setPreviewRevision(value=>value+1);};
    window.addEventListener('notesprig:document-saved',refresh);return()=>window.removeEventListener('notesprig:document-saved',refresh);
  },[cards]);
  useEffect(()=>{
    if(!board||stale)return;
    // Note saves from another pane, another tab, or another device do not all
    // have a shared React event. Revalidate only the visible bounded cards as
    // a backstop; unchanged snapshots keep their existing renderer instance.
    const timer=window.setInterval(()=>setPreviewRevision(value=>value+1),1500);
    return()=>clearInterval(timer);
  },[board?.boardId,stale]);
  useEffect(()=>{const controller=new AbortController();void prepareBoardOffline({signal:controller.signal,entryUrl:import.meta.url}).then(result=>setOfflineReady(result.ready)).catch(error=>{if(!controller.signal.aborted)setNotice(translateMessage(error.message));});return()=>controller.abort();},[]);
  useEffect(()=>{let alive=true;void session.initialize().catch(error=>{if(alive)setNotice(translateMessage(error.message));});return()=>{alive=false;void session.checkpoint().catch(()=>{});};},[session]);
  useEffect(()=>{
    const check=()=>{void refreshWorkspaceContext(api.boardContext).then(setContext).catch(()=>{});};
    window.addEventListener('focus',check);window.addEventListener('online',check);const timer=setInterval(check,10000);check();
    return()=>{clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('online',check);};
  },[path]);
  useEffect(()=>{
    if(!board)return;
    const abort=new AbortController();let cursor=0;
    setPreviews(previous=>Object.fromEntries(visible.map(element=>[element.id,stale?{title:t('Board note preview'),excerpt:'',status:'stale'}:previous[element.id]||{title:t('Board note preview'),excerpt:'',status:'unavailable'}])));
    void (async()=>{
      const updates:Record<string,BoardPreview>={};
      await Promise.all(Array.from({length:3},async()=>{
      while(cursor<visible.length&&!abort.signal.aborted) {
        const element=visible[cursor++],binding=cardMetadata(element)!.binding;
        if(stale||binding.state!=='bound') { updates[element.id]={title:t('Board note preview'),excerpt:'',status:stale?'stale':binding.state==='missing'?'missing':'unbound'};continue; }
        try {const snapshot=await api.boardPreview(binding.path,board.referenceContext,binding.fragment,abort.signal);if(!abort.signal.aborted)updates[element.id]=snapshot;}
        catch(error) {if(!abort.signal.aborted)updates[element.id]={title:t('Board note preview'),excerpt:'',status:(error as{status?:number}).status===409?'stale':(error as{status?:number}).status===404?'missing':'unavailable'};}
      }
      }));
      if(!abort.signal.aborted)setPreviews(previous=>{
        const next={...previous,...updates};
        return Object.keys(updates).some(id=>JSON.stringify(previous[id])!==JSON.stringify(next[id]))?next:previous;
      });
    })();
    return()=>abort.abort();
  // Only binding/visibility changes restart requests; pointer movements do not refetch note contents.
  },[path,visibleIds.join(','),cards.map(card=>JSON.stringify(cardMetadata(card)?.binding)).join('|'),stale,board?.referenceContext.epoch,visible.map(card=>files.find(file=>file.path===cardMetadata(card)?.binding.path)?.mtime||0).join(','),previewRevision]);
  useEffect(()=>{
    const save=()=>{void session.save().then(ok=>{if(ok)onSaved();});};
    const online=()=>save(),flush=()=>{if(document.visibilityState==='hidden')void session.checkpoint().catch(()=>{});};
    const unload=(event:BeforeUnloadEvent)=>{if(session.state.draft?.dirty){event.preventDefault();event.returnValue='';}};
    window.addEventListener('online',online);window.addEventListener('beforeunload',unload);document.addEventListener('visibilitychange',flush);
    return()=>{window.removeEventListener('online',online);window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',flush);};
  },[session,onSaved]);
  async function addNote() {
    if(!board||!engine.current||!target)return;
    try {const runtime=await loadBoardRuntime(),card=await createNoteCard(target,{x:60-viewport.scrollX+(cards.length%8)*24,y:60-viewport.scrollY+(cards.length%8)*24});engine.current.updateScene({elements:[...engine.current.getSceneElementsIncludingDeleted(),card],captureUpdate:runtime.CaptureUpdateAction.IMMEDIATELY});}
    catch(error){setNotice(translateMessage((error as Error).message));}
  }
  async function addImage(file:File) {
    if(!board||!engine.current)return;
    try {
      const image=await session.addImage(file),runtime=await loadBoardRuntime();
      const [rectangle]=runtime.convertToExcalidrawElements([{type:'rectangle',x:80-viewport.scrollX,y:80-viewport.scrollY,width:Math.min(500,image.asset.width),height:Math.min(500,image.asset.width)*image.asset.height/image.asset.width}]);
      const element={...rectangle,type:'image',fileId:image.id,status:'saved',scale:[1,1],crop:null} as unknown as ExcalidrawElement;
      const elements=[...engine.current.getSceneElementsIncludingDeleted(),element];
      const next=validateBoard({...board,scene:{...board.scene,elements},assets:{...board.assets,[image.id]:image.asset}});
      session.edit(next,new Map([[image.asset.sha256,image.bytes]]));
      await session.checkpoint();
      engine.current.addFiles([session.state.files[image.id]]);
      engine.current.updateScene({elements,captureUpdate:runtime.CaptureUpdateAction.IMMEDIATELY});
    } catch(error){setNotice(translateMessage((error as Error).message));}
  }
  async function openCard(id:string) {
    const element=cards.find(card=>card.id===id),binding=element&&cardMetadata(element)?.binding;
    if(!board||!binding||binding.state!=='bound'||stale){setNotice(t('Reference review required'));return;}
    try {await api.boardPreview(binding.path,board.referenceContext,binding.fragment);await onOpenNote(binding.path,board.referenceContext);}
    catch(error){setNotice(translateMessage((error as Error).message));}
  }
  async function share(kind:'excalidraw'|'png'|'svg') {
    if(!board)return;
    try {
      // Only snapshots already rendered under a reference guard are projected. Others get placeholders.
      const current=await api.boardContext();if(!sameContext(current,board.referenceContext))throw new Error(t('Reference review required'));
      const projection=createSharingProjection({elements:board.scene.elements as unknown as ExcalidrawElement[],appState:board.scene.appState,files:state.files},previews);
      setExportReport([...new Set(projection.report.issues.map(issue=>conversionDescription(issue.code)))]);
      const runtime=await loadBoardRuntime();let blob:Blob;
      const bounds=runtime.getCommonBounds(projection.elements);
      const width=Math.max(1,Math.ceil(bounds[2]-bounds[0]+20)),height=Math.max(1,Math.ceil(bounds[3]-bounds[1]+20));
      if(kind!=='excalidraw'&&(!Number.isFinite(width*height)||width*height>16000000||Math.max(width,height)>16384))throw new Error(t('The drawing is too large to export as an image. Export Excalidraw JSON instead.'));
      if(kind==='excalidraw')blob=new Blob([runtime.serializeAsJSON(projection.elements,{...projection.appState} as Partial<AppState> as AppState,projection.files,'local')],{type:'application/json'});
      else if(kind==='svg')blob=new Blob([(await runtime.exportToSvg({...projection,appState:{...projection.appState,exportEmbedScene:false}})).outerHTML],{type:'image/svg+xml'});
      else blob=await runtime.exportToBlob({...projection,mimeType:'image/png',getDimensions:(width:number,height:number)=>({width,height,scale:1}),appState:{...projection.appState,exportEmbedScene:false}});
      downloadBoardFile(blob,path.replace(/\.board$/i,`.${kind}`));setNotice(t('Export contains visible note excerpts. Unavailable cards use placeholders.'));
    }catch(error){setNotice(translateMessage((error as Error).message));}
  }
  async function reviewReferences() {
    if(!board||!state.draft||!review)return;
    try {
      const fresh=await refreshWorkspaceContext(api.boardContext);setContext(fresh);
      const saved=await api.reviewBoard({path,baseHash:state.draft.hash,context:fresh,previousContext:board.referenceContext,bindings:cards.map(element=>({elementId:element.id,state:review[element.id]?'bound':'unbound',path:review[element.id]||undefined}))});
      await session.replaceAfterReview(saved,fresh);setReview(null);setEngineRevision(value=>value+1);setNotice(t('References reviewed.'));
    }catch(error){setNotice(translateMessage((error as Error).message));}
  }

  async function privateRecovery() {
    if(!board)return;
    try {await session.checkpoint().catch(()=>{});const result=await createPrivateBoardBundle(JSON.stringify(session.state.draft!.board),await session.cachedAssets());downloadBoardFile(new Blob([result.bytes.slice().buffer],{type:'application/zip'}),path.replace(/\.board$/i,'-private-recovery.zip'));setNotice(result.manifest.complete?t('Private recovery contains references and image bytes. Verify the downloaded file.'):t('Recovery is incomplete: some older images are unavailable. Missing hashes are listed in its manifest.'));}
    catch(error){setNotice(translateMessage((error as Error).message));}
  }
  async function importFile(file:File) {
    try {
      if(file.size>96*1024**2)throw new Error(t('Import size limit exceeded.'));
      const context=await api.boardContext();let result:ConvertedBoard;
      if(/\.zip$/i.test(file.name)) {const recovered=await readPrivateBoardBundle(new Uint8Array(await file.arrayBuffer()));if(!recovered.manifest.complete)throw new Error(t('Incomplete recovery cannot be imported as a complete board. Keep the archive for recovery.'));result={board:prepareImportedBoard(recovered.board,context),assets:recovered.assets,source:recovered.rawBoard,report:{sourcePreserved:true,requiresReferenceReview:true,issues:[{code:'private-board-imported-as-unbound-copy'}]}};}
      else if(/\.canvas$/i.test(file.name))result=convertCanvasToBoard(await file.text(),context);
      else if(/\.board$/i.test(file.name))result={board:prepareImportedBoard(validateBoard(await file.text()),context),source:await file.text(),assets:{},report:{sourcePreserved:true,requiresReferenceReview:true,issues:[{code:'private-board-imported-as-unbound-copy'}]}};
      else result=await importExcalidraw(await file.text(),context,{validateImage:async(bytes,mimeType)=>{const bitmap=await createImageBitmap(new Blob([bytes.slice().buffer],{type:mimeType}));const result={width:bitmap.width,height:bitmap.height,mimeType};bitmap.close();return result;}});
      setCandidate(result);setImportName(file.name.replace(/\.[^.]+$/,'')+'-imported');
    }catch(error){setNotice(translateMessage((error as Error).message));}
  }
  async function commitImport() {
    if(!candidate)return;
    try {
      const context=await api.boardContext();if(!sameContext(context,candidate.board.referenceContext))throw new Error(t('References changed; review bindings before continuing.'));
      for(const asset of Object.values(candidate.board.assets)) {const bytes=candidate.assets[asset.sha256];if(!bytes)throw new Error(t('A required board image is missing or changed.'));await api.uploadBoardAsset(assetDataURL(asset,bytes).split(',')[1],context);}
      const target=importName.trim().replace(/\.board$/i,'')+'.board';await api.saveBoard({path:target,board:candidate.board,context},true);
      // Preserve the original import bytes as an explicit download; original files are never overwritten.
      downloadBoardFile(new Blob([candidate.source],{type:'application/json'}),target.replace(/\.board$/i,'-original.json'));
      setCandidate(null);onSaved();setNotice(t('Imported copy created. Open it from Files and review its note references.'));
    }catch(error){setNotice(translateMessage((error as Error).message));}
  }


  async function restoreVersion(id:string) {
    if(!state.draft)return;
    try {
      if(state.draft.dirty)throw new Error(t('Synchronize or export this draft before restoring history.'));
      const context=await refreshWorkspaceContext(api.boardContext);setContext(context);
      const remote=await api.restoreBoard({path,id,baseHash:state.draft.hash,context});
      await session.replaceAfterReview(remote,context);await session.hydrateAssets();setEngineRevision(value=>value+1);setVersions(null);onSaved();
      setNotice(t('Version restored. References retain their original context and may need review.'));
    }catch(error){setNotice(translateMessage((error as Error).message));}
  }

  const selectedCards=cards.filter(card=>selected.includes(card.id));
  return <section className="board-view" aria-label={t('Visual board')}>
    <header className="board-toolbar"><strong>{path.split('/').at(-1)?.replace(/\.board$/i,'')}</strong><span role="status">{t(state.status==='device'?'Saved on this device':state.status==='saved'?'Saved':state.status==='saving'?'Saving…':state.status==='loading'?'Loading…':state.status==='editing'?'Saving on this device…':'Save needs attention')}</span>{offlineReady&&<span>{t('Drawing tools ready offline')}</span>}<button disabled={!board} onClick={()=>void api.history(path).then(setVersions).catch(error=>setNotice(translateMessage(error.message)))}>{t("Version history")}</button><button onClick={()=>void privateRecovery()} disabled={!board}>{t('Private recovery')}</button><button onClick={()=>void session.save().then(onSaved)} disabled={!board||stale}>{t('Save')}</button><details><summary>{t('Share')}</summary><p>{t('Export contains visible note excerpts. Unavailable cards use placeholders.')}</p>{(['excalidraw','png','svg'] as const).map(kind=><button key={kind} onClick={()=>void share(kind)}>{kind.toUpperCase()}</button>)}</details></header>
    {(state.error||notice)&&<p className="board-notice" role="alert">{state.error||notice}</p>}
    {exportReport.length>0&&<details className="board-note-list"><summary>{t("Conversion report")}</summary><ul>{exportReport.map(message=><li key={message}>{message}</li>)}</ul></details>}
    {needsReview&&<div className="board-notice" role="alert">{t('Reference review required')} <button disabled={state.draft?.dirty} onClick={()=>setReview(Object.fromEntries(cards.map(card=>[card.id,''])))}>{t('Review references')}</button></div>}
    {review&&<div className="board-review"><p>{t('Choose each note explicitly. Empty choices remain unbound.')}</p>{cards.map((card,index)=><label key={card.id}>{t('Note card')} {index+1}<select value={review[card.id]} onChange={event=>setReview({...review,[card.id]:event.target.value})}><option value="">{t('Keep unbound')}</option>{files.filter(file=>file.kind==='markdown').map(file=><option key={file.path}>{file.path}</option>)}</select></label>)}<button onClick={()=>void reviewReferences()}>{t('Confirm reference review')}</button><button onClick={()=>setReview(null)}>{t('Cancel')}</button></div>}
    <div className="board-actions"><button onClick={()=>importInput.current?.click()}>{t("Import as a copy")}</button><input ref={importInput} hidden type="file" accept=".canvas,.excalidraw,.board,.zip" onChange={event=>{const file=event.target.files?.[0];if(file)void importFile(file);event.target.value="";}}/><label>{t('Add note card')}<select aria-label={t('Choose a note')} value={target} onChange={event=>setTarget(event.target.value)}><option value="">{t('Choose a note')}</option>{files.filter(file=>file.kind==='markdown').map(file=><option key={file.path} value={file.path}>{file.path}</option>)}</select></label><button disabled={!target||stale} onClick={()=>void addNote()}>{t('Add')}</button><button disabled={stale} onClick={()=>imageInput.current?.click()}>{t('Add image')}</button><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void addImage(file);event.target.value='';}}/>{selectedCards.map(card=><button key={card.id} onClick={()=>void openCard(card.id)}>{t('Open note')}</button>)}</div>
    {versions&&<div className="board-review"><h3>{t("Version history")}</h3><ul>{versions.map(version=><li key={version.id}>{new Date(version.createdAt).toLocaleString()} <button disabled={state.draft?.dirty} onClick={()=>void restoreVersion(version.id)}>{t("Restore version")}</button></li>)}</ul><button onClick={()=>setVersions(null)}>{t("Close")}</button></div>}
    {candidate&&<div className="board-review"><h3>{t('Review imported copy')}</h3><p>{t('Original source is preserved. Imported note cards stay unbound until explicitly reviewed.')}</p><label>{t('Board name')}<input aria-label={t('Imported board name')} value={importName} onChange={event=>setImportName(event.target.value)}/></label><details><summary>{t('Conversion report')} ({candidate.report.issues.length})</summary><ul>{candidate.report.issues.map((issue,index)=><li key={index}>{conversionDescription(issue.code)}</li>)}</ul></details><button onClick={()=>void commitImport()}>{t('Create imported copy')}</button><button onClick={()=>setCandidate(null)}>{t('Cancel')}</button></div>}
    <div className="board-stage" onDragOverCapture={event=>{if(event.dataTransfer.types.includes('text/x-notesprig-file'))event.preventDefault();}} onDropCapture={event=>{
      const path=event.dataTransfer.getData('text/x-notesprig-file');if(!path)return;event.preventDefault();event.stopPropagation();
      if(stale||!board||!engine.current||!files.some(file=>file.path===path&&file.kind==='markdown'))return;
      const position={clientX:event.clientX,clientY:event.clientY};void loadBoardRuntime().then(async runtime=>{const api=engine.current;if(!api)return;const point=runtime.viewportCoordsToSceneCoords(position,api.getAppState());const card=await createNoteCard(path,point);api.updateScene({elements:[...api.getSceneElementsIncludingDeleted(),card],captureUpdate:runtime.CaptureUpdateAction.IMMEDIATELY});}).catch(error=>setNotice(translateMessage(error.message)));
    }}>{board&&state.status!=='loading'&&<BoardEngine key={`${board.boardId}:${board.referenceContext.epoch}:${engineRevision}`} documentKey={`${board.boardId}:${board.referenceContext.epoch}`} renderKey={JSON.stringify(visibleIds.map(id=>previews[id]))} initialScene={{elements:board.scene.elements as unknown as ExcalidrawElement[],appState:board.scene.appState as Partial<AppState>}} files={state.files as BinaryFiles} previews={previews} visibleCardIds={visibleIds} onViewportChange={setViewport} onReady={api=>{engine.current=api;}} onPersistentChange={({elements,appearance})=>{
      try {const latest=session.state.draft!.board;session.edit({...latest,scene:{elements:elements as unknown as BoardElement[],appState:appearance}});}catch(error){setNotice(translateMessage((error as Error).message));}
    }} onSelectionChange={setSelected} onOpenCard={id=>void openCard(id)} theme={theme} readOnly={stale} onBlockedIngress={()=>setNotice(t('Use the NoteSprig toolbar to import files.'))}/>}</div>
    <details className="board-note-list"><summary>{t('Note cards')} ({cards.length})</summary><ul>{cards.map(card=><li key={card.id}><span>{cardMetadata(card)?.binding.path}</span><button onClick={()=>{if(!engine.current)return;engine.current.scrollToContent([card as unknown as ExcalidrawElement],{fitToContent:true,maxZoom:1});}}>{t('Locate')}</button><button disabled={stale||cardMetadata(card)?.binding.state!=='bound'} onClick={()=>void openCard(card.id)}>{t('Open note')}</button></li>)}</ul></details>
  </section>;
}

function conversionDescription(code:string) {
  const descriptions:Record<string,string>={
    'markdown-converted-to-plain-text':t('Markdown becomes plain text.'),
    'group-converted-to-frame':t('Groups become organizational frames.'),
    'canvas-style-and-layout-review':t('Review converted styles and layout.'),
    'unsupported-content-placeholder':t('Attachments require a separate import.'),
    'link-converted-to-static-card':t('Link cards become static text.'),
    'reference-review-required':t('Reference review required.'),
    'private-board-imported-as-unbound-copy':t('Reference review required.'),
    'edge-label-layout-changed':t('Labels may change their layout.'),
    'static-note-snapshot':t('Cards become static note excerpts.'),
    'note-placeholder':t('Unavailable content uses a visible placeholder.'),
    'unsupported-element-placeholder':t('Unavailable content uses a visible placeholder.'),
    'missing-image-placeholder':t('Unavailable content uses a visible placeholder.'),
    'private-metadata-stripped':t('Private metadata is removed.'),
    'snapshot-truncated':t('Long excerpts are shortened.'),
    'deleted-element-omitted':t('Deleted content is omitted.'),
    'unused-image-omitted':t('Unused images are omitted.'),
    'invalid-binding-removed':t('Invalid drawing bindings are removed.'),
    'frame-clipping-disabled':t('Organizational frames do not clip contents.'),
    'web-embed-link':t('Web embeds are exported as link cards.'),
  };return descriptions[code]||t('Review converted styles and layout.');
}
