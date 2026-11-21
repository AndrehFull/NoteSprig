import { t, translateMessage } from '../i18n';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import { api } from '../api';
import { getLocal, localBatch, setLocal } from '../storage';
import { currentContext, scopedKey } from '../workspace';
import { boardFingerprint, boardScope, validateBoard, sameWorkspace, persistedAppearance, type BoardDocument, type BoardAsset, type ReferenceContext } from '../../shared/board-schema.mjs';
import type { BinaryFiles, DataURL } from '@excalidraw/excalidraw/types';

export type BoardDraft = { path:string; board:BoardDocument; hash:string; dirty:boolean; pending:boolean; fingerprint:string; workspaceContext?:ReferenceContext };
export type BoardSessionState = { draft?:BoardDraft; files:BinaryFiles; status:'loading'|'editing'|'device'|'saving'|'saved'|'error'; error?:string };
const sessions = new Map<string, BoardSession>();
export const bytesHash = async (bytes:Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(value=>value.toString(16).padStart(2,'0')).join('');
function bytesBase64(bytes:Uint8Array) { let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));return btoa(binary); }
export function assetDataURL(asset:BoardAsset,bytes:Uint8Array):DataURL { return `data:${asset.mimeType};base64,${bytesBase64(bytes)}` as DataURL; }
export function base64Bytes(base64:string) { return Uint8Array.from(atob(base64),character=>character.charCodeAt(0)); }
function persistentBoard(input:BoardDocument) { const board=validateBoard(input);board.scene.appState=persistedAppearance(board.scene.appState);return board; }

export class BoardSession {
  state:BoardSessionState={files:{},status:'loading'};
  listeners=new Set<()=>void>();
  context:ReferenceContext;
  private checkpointQueue:Promise<void>=Promise.resolve();
  private saveQueue?:Promise<boolean>;
  private pendingBlobs=new Map<string,Uint8Array>();
  private timer?:ReturnType<typeof setTimeout>;
  private initialized?:Promise<void>;
  private disposed=false;
  private controller=new AbortController();
  constructor(readonly path:string) {this.context=currentContext();}
  subscribe=(listener:()=>void)=>{this.active();this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.state;
  private active() {if(this.disposed)throw new Error('This board session has been closed.');}
  private update(next:Partial<BoardSessionState>) {if(this.disposed)return;this.state={...this.state,...next};for(const listener of this.listeners)listener();}
  private key(value:string) {return `workspace:${boardScope(this.context)}:${value}`;}
  get prefix() {return this.key(`board:${this.state.draft!.board.boardId}:`);}
  get draftKey() {return this.prefix+'draft';}
  initialize() {this.active();return this.initialized??=this.load();}
  private async load() {
    try {
      const id=await getLocal<string>(this.key(`board-path:${this.path}`));this.active();
      const cached=id?await getLocal<BoardDraft>(this.key(`board:${id}:draft`)):undefined;this.active();
      if(cached?.dirty||cached?.pending) {
        // Storage ownership and reference provenance are separate. A server-
        // restored scene may deliberately retain a historical reference context.
        if(cached.path!==this.path||!sameWorkspace(cached.workspaceContext||cached.board?.referenceContext,this.context))throw new Error('Board belongs to a different workspace.');
        validateBoard(cached.board);
      }
      let remote:Awaited<ReturnType<typeof api.board>>|undefined;
      try {remote=await api.board(this.path,this.context);}catch(error){if((error as {status?:number}).status||!cached)throw error;}
      this.active();
      const source=cached?.dirty||cached?.pending?cached:remote?{...remote,workspaceContext:{...this.context},dirty:false,pending:false}:cached;
      if(!source||source.path!==this.path||typeof source.hash!=='string')throw new Error('Invalid cached board draft.');
      if(!remote&&!sameWorkspace(source.workspaceContext||source.board?.referenceContext,this.context))throw new Error('Board belongs to a different workspace.');
      const board=persistentBoard(source.board),dirty=Boolean(source.dirty||source.pending);
      const draft:BoardDraft={...source,board,dirty,pending:dirty,fingerprint:boardFingerprint(board),workspaceContext:{...this.context}};
      this.update({draft,status:dirty?'device':'saved'});
      await localBatch({[this.draftKey]:draft,[this.key(`board-path:${this.path}`)]:board.boardId});this.active();
      await this.loadAssets(true);this.active();
      if(draft.dirty&&navigator.onLine)void this.save();
    }catch(error){this.update({status:'error',error:translateMessage((error as Error).message)});throw error;}
  }
  edit(board:BoardDocument,additions:Map<string,Uint8Array>=new Map()) {
    this.active();const next=persistentBoard(board),fingerprint=boardFingerprint(next),previous=this.state.draft!;
    if(next.boardId!==previous.board.boardId)throw new Error('Board identity cannot change during an edit.');
    if(fingerprint===previous.fingerprint)return;
    for(const [sha,bytes]of additions)this.pendingBlobs.set(sha,bytes.slice());
    this.update({draft:{...previous,board:next,fingerprint,dirty:true,pending:true},status:'editing',error:undefined});
    clearTimeout(this.timer);this.timer=setTimeout(()=>{if(!this.disposed)void this.checkpoint().then(()=>{if(!this.disposed&&navigator.onLine)return this.save();}).catch(()=>{});},600);
  }
  checkpoint() {
    const task=this.checkpointQueue.then(async()=>{
      this.active();const draft=this.state.draft;if(!draft)return;
      const blobs=new Map(this.pendingBlobs),prefix=this.prefix;
      try {
        await localBatch({[this.draftKey]:draft,[this.key(`board-path:${this.path}`)]:draft.board.boardId,...Object.fromEntries([...blobs].map(([sha,bytes])=>[prefix+`asset:${sha}`,bytes]))});
        this.active();
        for(const [sha,bytes]of blobs)if(this.pendingBlobs.get(sha)===bytes)this.pendingBlobs.delete(sha);
        if(this.state.draft?.fingerprint===draft.fingerprint&&draft.dirty)this.update({status:'device'});
      }catch(error){this.update({status:'error',error:t('Could not store the board in this browser. Keep this tab open and export recovery.')});throw error;}
    });
    this.checkpointQueue=task.catch(()=>{});return task;
  }
  save():Promise<boolean> {
    if(this.disposed)return Promise.resolve(false);
    if(this.saveQueue)return this.saveQueue;
    const task=(async()=>{
      try {
        await this.checkpoint();this.active();
        if(!navigator.onLine)return true;
        while(this.state.draft?.dirty) {
          const snapshot=this.state.draft,prefix=this.prefix;this.update({status:'saving',error:undefined});
          const assets=Object.values(snapshot.board.assets);let cursor=0;
          await Promise.all(Array.from({length:Math.min(2,assets.length)},async()=>{
            while(cursor<assets.length) {
              this.active();const asset=assets[cursor++],bytes=await getLocal<Uint8Array>(prefix+`asset:${asset.sha256}`);this.active();
              if(!bytes)throw new Error('A required image is unavailable. Export an incomplete recovery before reloading.');
              if(await bytesHash(bytes)!==asset.sha256)throw new Error('Board image integrity check failed.');this.active();
              const saved=await api.uploadBoardAsset(bytesBase64(bytes),snapshot.board.referenceContext,this.controller.signal);this.active();
              if((['sha256','mimeType','byteLength','width','height'] as const).some(key=>saved[key]!==asset[key]))throw new Error('Image upload integrity check failed.');
            }
          }));
          this.active();
          const saved=await api.saveBoard({path:this.path,board:snapshot.board,baseHash:snapshot.hash,context:snapshot.board.referenceContext},false,this.controller.signal);this.active();
          if(saved.path!==this.path||boardFingerprint(persistentBoard(saved.board))!==snapshot.fingerprint)throw new Error('The server acknowledgement does not match this board revision.');
          const current=this.state.draft!,dirty=current.fingerprint!==snapshot.fingerprint;
          this.update({draft:{...current,hash:saved.hash,dirty,pending:dirty},status:'saving'});
          await this.checkpoint();this.active();
          this.update({status:this.state.draft?.dirty?'editing':'saved'});
        }
        return true;
      }catch(error){this.update({status:'error',error:translateMessage(error instanceof Error ? error.message : String(error || 'Could not save the board.'))});return false;}
    })().finally(()=>{this.saveQueue=undefined;});
    this.saveQueue=task;return task;
  }
  async replaceAfterReview(remote:Awaited<ReturnType<typeof api.board>>,context:ReferenceContext) {
    this.active();if(this.state.draft?.dirty)throw new Error('Preserve or synchronize this draft before reviewing references.');
    if(!sameWorkspace(context,this.context)||remote.path!==this.path)throw new Error('Board belongs to a different workspace.');
    const board=persistentBoard(remote.board);if(board.boardId!==this.state.draft?.board.boardId)throw new Error('Board identity cannot change during an edit.');
    this.context={...context};const draft={...remote,board,dirty:false,pending:false,fingerprint:boardFingerprint(board),workspaceContext:{...context}};
    await localBatch({[this.draftKey]:draft,[this.key(`board-path:${this.path}`)]:board.boardId});this.active();this.update({draft,status:'saved',error:undefined});
  }
  private async loadAssets(allowMissing=false) {
    const files:BinaryFiles={...this.state.files};
    for(const [fileId,asset]of Object.entries(this.state.draft!.board.assets)) {
      this.active();let bytes=await getLocal<Uint8Array>(this.prefix+`asset:${asset.sha256}`);this.active();
      if(!bytes) {
        try {const remote=await api.boardAsset(asset,this.context);this.active();bytes=base64Bytes(remote.base64);}
        catch(error){if(this.disposed||!allowMissing)throw error;continue;}
      }
      if(await bytesHash(bytes)!==asset.sha256)throw new Error('Board image integrity check failed.');this.active();
      await setLocal(this.prefix+`asset:${asset.sha256}`,bytes);this.active();
      files[fileId]={id:fileId as FileId,dataURL:assetDataURL(asset,bytes),mimeType:asset.mimeType,created:0};
    }
    this.update({files});
  }
  async hydrateAssets() {this.active();await this.loadAssets();}
  async addImage(file:File) {
    this.active();if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024**2)throw new Error('Choose a static PNG, JPEG, or WebP image of up to 8 MiB.');
    const bitmap=await createImageBitmap(file),width=bitmap.width,height=bitmap.height;bitmap.close();this.active();
    if(width>4096||height>4096||width*height>16000000)throw new Error('Board image dimensions exceed the limit.');
    const bytes=new Uint8Array(await file.arrayBuffer()),sha256=await bytesHash(bytes);this.active();
    const asset:BoardAsset={sha256,mimeType:file.type as BoardAsset['mimeType'],byteLength:bytes.length,width,height},id=crypto.randomUUID() as FileId;
    this.update({files:{...this.state.files,[id]:{id,dataURL:assetDataURL(asset,bytes),mimeType:asset.mimeType,created:Date.now()}}});return{id,asset,bytes};
  }
  async cachedAssets() {const result:Record<string,Uint8Array>={};for(const asset of Object.values(this.state.draft!.board.assets)){const bytes=this.pendingBlobs.get(asset.sha256)||await getLocal<Uint8Array>(this.prefix+`asset:${asset.sha256}`);if(bytes)result[asset.sha256]=bytes;}return result;}
  volatileRecovery() {
    const assets:Record<string,{base64:string}>={};
    for(const [sha,bytes]of this.pendingBlobs)assets[sha]={base64:bytesBase64(bytes)};
    for(const [fileId,asset]of Object.entries(this.state.draft?.board.assets||{})) {
      const dataURL=this.state.files[fileId]?.dataURL;if(dataURL?.startsWith(`data:${asset.mimeType};base64,`))assets[asset.sha256]={base64:dataURL.split(',')[1]};
    }
    return{path:this.path,context:{...this.context},draft:structuredClone(this.state.draft),assets};
  }
  async dispose() {this.disposed=true;clearTimeout(this.timer);this.controller.abort();this.listeners.clear();await this.checkpointQueue;}
}
export function boardSession(path:string) {const key=scopedKey(`board-path:${path}`);let session=sessions.get(key);if(!session){session=new BoardSession(path);sessions.set(key,session);}return session;}
export async function saveAllBoards() {const results=await Promise.all([...sessions.values()].map(session=>session.save().catch(()=>false)));return results.every(Boolean);}
export function dirtyBoards() {return [...sessions.values()].some(session=>session.state.draft?.dirty||session.state.status==='editing');}
export function volatileBoardRecovery() {return [...sessions.values()].filter(session=>session.state.draft?.dirty||session.state.status==='error').map(session=>session.volatileRecovery());}
export async function clearBoardSessions() {const closing=[...sessions.values()];sessions.clear();await Promise.all(closing.map(session=>session.dispose()));}
