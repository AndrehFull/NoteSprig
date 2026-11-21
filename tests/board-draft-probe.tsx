// Isolated test entry. This module is never imported by the production application.
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../src/api';
import { BoardSession, boardSession, clearBoardSessions, dirtyBoards, saveAllBoards, volatileBoardRecovery } from '../src/boards/session';
import { bootstrapWorkspace, forgetWorkspace, currentContext, scopedKey } from '../src/workspace';
import { clearPrivateCache, getLocal, setLocal, localEntries, localBatch, pendingPrivateWork } from '../src/storage';
import { useDocuments } from '../src/useDocuments';
import { createBoard, boardFingerprint, boardScope, type ReferenceContext } from '../shared/board-schema.mjs';
import { bytesHash } from '../src/boards/session';
import { LEGACY_MEDIA } from '../src/legacy';

const initialContext: ReferenceContext = { vaultId: '11111111-1111-4111-8111-111111111111', restoreGeneration: '22222222-2222-4222-8222-222222222222', epoch: '33333333-3333-4333-8333-333333333333' };
const boardId = '44444444-4444-4444-8444-444444444444';
const copy = <T,>(value:T):T => structuredClone(value);
let session: BoardSession, savePromise:Promise<boolean>|undefined, online = false, remote: any;
let uploads:any[] = [], saves:any[] = [], failures: ('before'|'after'|'conflict')[] = [], heldUpload: (()=>void)|undefined, heldSave:(()=>void)|undefined;
let pauseUpload = false, pauseSave = false, failCheckpoint = false, aborts=0;
let events:string[] = [], docs:any, noteError:any, noteRemote:any, errors:any[]=[], noteReads:any[]=[];
Object.defineProperty(navigator, 'onLine', { configurable:true, get:()=>online });
const originalPut=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey) {
  const request=originalPut.call(this,value,key);
  if(failCheckpoint&&String(key).includes(':asset:')) {failCheckpoint=false;aborts++;this.transaction.abort();}
  return request;
};
api.board = async () => copy(remote);
api.boardAsset = async () => {throw new Error('No remote asset fixture');};
api.uploadBoardAsset = async (base64,context) => {
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),sha256=await bytesHash(bytes);
  uploads.push({sha256,context:copy(context)});
  if(pauseUpload) {pauseUpload=false;await new Promise<void>(resolve=>{heldUpload=resolve;});}
  return {sha256,mimeType:'image/png',byteLength:bytes.length,width:1,height:1};
};
api.saveBoard = async payload => {
  saves.push(copy(payload));const failure=failures.shift();
  if(pauseSave) {pauseSave=false;await new Promise<void>(resolve=>{heldSave=resolve;});}
  if(failure==='before')throw new Error('Simulated network failure before commit');
  if(failure==='conflict')throw Object.assign(new Error('The board changed elsewhere.'),{status:409,data:{code:'BOARD_CONFLICT'}});
  if(boardFingerprint(remote.board)!==boardFingerprint(payload.board)) {
    if(payload.baseHash!==remote.hash)throw Object.assign(new Error('Stale board base hash'),{status:409});
    remote={path:payload.path,board:copy(payload.board),hash:`server-${saves.length}`};
  }
  if(failure==='after')throw new Error('Simulated lost acknowledgement');
  return copy(remote);
};
api.note=async(path,context)=>{noteReads.push({path,context});if(noteError)throw noteError;return copy(noteRemote);};
api.save=async note=>({...copy(noteRemote),content:note.content,hash:'saved-note'});
function Harness(){const current=useDocuments(()=>{},(error,draft)=>errors.push({message:String(error),draft}));useEffect(()=>{docs=current;});return <output>Persistence probe ready</output>;}
async function reset(context=initialContext) {
  await clearBoardSessions();forgetWorkspace();await clearPrivateCache();await bootstrapWorkspace(async()=>context);
  online=false;uploads=[];saves=[];failures=[];pauseUpload=false;pauseSave=false;events=[];failCheckpoint=false;aborts=0;noteError=undefined;errors=[];noteReads=[];
  remote={path:'Board.board',board:createBoard(context,boardId),hash:'server-original'};
  noteRemote={path:'A.md',title:'A',content:'# original',body:'# original',hash:'note-original',kind:'markdown',properties:{},aliases:[],tags:[],links:[],size:10,mtime:1};
  sessionStorage.setItem('notesprig.unlocked','true');
}
async function open(){session=boardSession('Board.board');await session.initialize();session.subscribe(()=>events.push(session.state.status));return copy(session.state);}
async function edit(label:string,image=false) {
  const board=copy(session.state.draft!.board);board.extensions.label=label;const additions=new Map<string,Uint8Array>();
  if(image){const bytes=new Uint8Array([1,2,3,4]),sha256=await bytesHash(bytes);board.assets.image={sha256,mimeType:'image/png',byteLength:4,width:1,height:1};board.scene.elements=[{id:'image',type:'image',fileId:'image',x:0,y:0,width:1,height:1,angle:0}];additions.set(sha256,bytes);}
  session.edit(board,additions);return copy(session.state);
}
const probe={
  reset,open,edit,get state(){return copy(session?.state);},get remote(){return copy(remote);},get uploads(){return copy(uploads);},get saves(){return copy(saves);},get events(){return [...events];},get errors(){return copy(errors);},get aborts(){return aborts;},
  context:()=>currentContext(), key:scopedKey,entries:localEntries,pending:pendingPrivateWork,get:getLocal,set:setLocal,batch:localBatch,bootstrap:(context:ReferenceContext)=>bootstrapWorkspace(async()=>context),legacyMedia:LEGACY_MEDIA,
  online:(value:boolean)=>{online=value;}, fail:(kind:'before'|'after'|'conflict')=>failures.push(kind),holdUpload:()=>{pauseUpload=true;},holdSave:()=>{pauseSave=true;},releaseUpload:()=>{heldUpload?.();heldUpload=undefined;},releaseSave:()=>{heldSave?.();heldSave=undefined;},
  startSave:()=>{savePromise=session.save();return true;},awaitSave:()=>savePromise,save:()=>session.save(),checkpoint:()=>session.checkpoint(),failCheckpoint:()=>{failCheckpoint=true;},cache:()=>session.cachedAssets(),clearSessions:clearBoardSessions,dirty:dirtyBoards,saveAll:saveAllBoards,volatile:volatileBoardRecovery,
  loadNote:(context?:ReferenceContext)=>docs.load('A.md',context),noteState:()=>copy(docs.ref.current),editNote:(content:string)=>docs.edit('A.md',content),noteFailure:(status?:number)=>{noteError=status?Object.assign(new Error('Reference review required'),{status}):new Error('Offline');},
  putNote:(value:any)=>docs.put({...copy(noteRemote),...value}), docsReady:()=>Boolean(docs),
  reconcile:()=>docs.reconcile([{...noteRemote,mtime:2}]),reads:()=>copy(noteReads),activate:()=>docs.activateWorkspace(),connected:()=>docs.connected(),recover:()=>docs.recover(),
  isolatedSession:(path:string)=>new BoardSession(path),scope:boardScope,
};
await reset();createRoot(document.getElementById('root')!).render(<Harness/>);Object.assign(window,{__draftProbe:probe});
