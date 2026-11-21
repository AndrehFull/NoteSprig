export const BOARD_LIMITS = Object.freeze({ bytes: 4 * 1024 ** 2, elements: 5000, cards: 200, assets: 100, assetBytes: 8 * 1024 ** 2, totalAssetBytes: 64 * 1024 ** 2, pixels: 16000000, dimension: 4096, pointsPerElement: 20000, points: 100000, textPerElement: 50000, totalText: 500000, depth: 20, nodes: 500000 });
export const MANAGED_ASSET_ROOT = 'attachments/notesprig-board-assets';
export const CARD_PREFIX = '/_notesprig/board-card/';
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const id = /^[a-zA-Z\d_-]{1,128}$/;
const formats = new Set(['rectangle','diamond','ellipse','line','arrow','freedraw','text','image','frame','embeddable']);
const mimes = new Set(['image/png','image/jpeg','image/webp']);
const appearanceFields = ['viewBackgroundColor','gridSize','gridStep','gridModeEnabled'];
export class BoardError extends Error { constructor(message, code='INVALID_BOARD', status=400, detail={}) { super(message); this.name='BoardError'; this.code=code; this.status=status; this.detail=detail; } }
const requireValue = (condition, message, code='INVALID_BOARD', status=400) => { if (!condition) throw new BoardError(message,code,status); };
export function utf8Bytes(text) { return new TextEncoder().encode(text).byteLength; }
export function validVaultPath(path) { return typeof path==='string' && path.length<=1024 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(p=>p && p===p.trim() && !p.startsWith('.') && !/[<>:"|?*\u0000-\u001f]/.test(p)); }
export function isManagedPath(path) { return path===MANAGED_ASSET_ROOT || String(path).startsWith(MANAGED_ASSET_ROOT+'/'); }
export function protectsManagedPath(path) { return isManagedPath(path) || MANAGED_ASSET_ROOT.startsWith(String(path)+'/'); }
export function validContext(context) { return context && ['vaultId','restoreGeneration','epoch'].every(key=>typeof context[key]==='string'&&uuid.test(context[key])); }
export function sameContext(a,b) { return Boolean(validContext(a)&&validContext(b)&&['vaultId','restoreGeneration','epoch'].every(key=>a[key]===b[key])); }
export function sameWorkspace(a,b) { return Boolean(a&&b&&a.vaultId===b.vaultId&&a.restoreGeneration===b.restoreGeneration); }
export function boardScope(context) { requireValue(validContext(context),'Invalid workspace identity.'); return `${context.vaultId}:${context.restoreGeneration}`; }
export function cardMetadata(element) { const m=element?.customData?.notesprig; return m?.version===1&&m.kind==='note-card'?m:null; }
export function boardCards(board, includeDeleted=false) { return (board.scene?.elements||[]).filter(e=>(includeDeleted||!e.isDeleted)&&cardMetadata(e)); }
export function persistedAppearance(state={}) { return Object.fromEntries(appearanceFields.filter(k=>state[k]!==undefined).map(k=>[k,state[k]])); }
export function createBoard(context, boardId=crypto.randomUUID()) { requireValue(validContext(context),'Invalid workspace identity.'); return { type:'notesprig-board', schemaVersion:1, boardId, referenceContext:{...context}, scene:{elements:[],appState:{viewBackgroundColor:'#ffffff'}}, assets:{}, extensions:{} }; }
export function validateBoard(input) {
  const text=typeof input==='string'?input:JSON.stringify(input);
  requireValue(typeof text==='string'&&utf8Bytes(text)<=BOARD_LIMITS.bytes,'Board exceeds 4 MiB.','BOARD_TOO_LARGE',413);
  let board;try{board=JSON.parse(text);}catch{throw new BoardError('Invalid board JSON.');}
  requireValue(board?.type==='notesprig-board'&&board.schemaVersion===1,'Unsupported board version.','UNSUPPORTED_BOARD',422);
  let visited=0;function safe(value,depth=0){requireValue(depth<=BOARD_LIMITS.depth&&++visited<=BOARD_LIMITS.nodes,'Board complexity limit exceeded.');if(value&&typeof value==='object'){for(const key of Object.keys(value)){requireValue(!['__proto__','constructor','prototype'].includes(key),'Unsafe board property.');safe(value[key],depth+1);}}else if(typeof value==='number')requireValue(Number.isFinite(value),'Non-finite board number.');}safe(board);
  requireValue(uuid.test(board.boardId||'')&&validContext(board.referenceContext),'Invalid board identity.');
  requireValue(board.scene&&Array.isArray(board.scene.elements)&&board.scene.elements.length<=BOARD_LIMITS.elements,'Invalid board element list.');
  requireValue(board.assets&&typeof board.assets==='object'&&!Array.isArray(board.assets),'Invalid board asset manifest.');
  let assetBytes=0,pixels=0,points=0,textBytes=0,cards=0;const ids=new Set();
  requireValue(Object.keys(board.assets).length<=BOARD_LIMITS.assets,'Too many board images.');
  for(const [fileId,asset]of Object.entries(board.assets)){
    requireValue(id.test(fileId)&&!['__proto__','constructor','prototype'].includes(fileId)&&asset&&/^[a-f\d]{64}$/.test(asset.sha256||'')&&mimes.has(asset.mimeType),'Invalid board image.');
    requireValue(Number.isSafeInteger(asset.byteLength)&&asset.byteLength>0&&asset.byteLength<=BOARD_LIMITS.assetBytes,'Board image exceeds 8 MiB.');
    requireValue(['width','height'].every(k=>Number.isSafeInteger(asset[k])&&asset[k]>0&&asset[k]<=BOARD_LIMITS.dimension),'Invalid image dimensions.');
    assetBytes+=asset.byteLength;pixels+=asset.width*asset.height;
  }
  requireValue(assetBytes<=BOARD_LIMITS.totalAssetBytes&&pixels<=BOARD_LIMITS.pixels,'Board image budget exceeded.');
  for(const element of board.scene.elements){
    requireValue(element&&id.test(element.id||'')&&!ids.has(element.id),'Invalid or duplicate element ID.');ids.add(element.id);
    requireValue(formats.has(element.type),'Unsupported board element.','UNSUPPORTED_BOARD',422);
    requireValue(['x','y','width','height','angle'].every(k=>typeof element[k]==='number'&&Number.isFinite(element[k])&&Math.abs(element[k])<=1e7),'Invalid board geometry.');
    requireValue(element.width>=0&&element.height>=0,'Negative board size.');
    if(element.points){requireValue(Array.isArray(element.points)&&element.points.length<=BOARD_LIMITS.pointsPerElement&&element.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7)),'Invalid freehand points.');points+=element.points.length;}
    if(element.text!==undefined){requireValue(typeof element.text==='string'&&element.text.length<=BOARD_LIMITS.textPerElement,'Board text limit exceeded.');textBytes+=element.text.length;}
    if(element.type==='image')requireValue(typeof element.fileId==='string'&&Object.hasOwn(board.assets,element.fileId),'Image manifest entry missing.','MISSING_ASSET',422);
    const metadata=cardMetadata(element);
    if(metadata){cards++;const binding=metadata.binding;requireValue(element.type==='embeddable'&&typeof element.link==='string'&&element.link.startsWith(CARD_PREFIX)&&uuid.test(element.link.slice(CARD_PREFIX.length)),'Invalid note card marker.');requireValue(binding&&['bound','missing','unbound'].includes(binding.state)&&validVaultPath(binding.path)&&binding.path.toLowerCase().endsWith('.md')&&!isManagedPath(binding.path),'Invalid note reference.');requireValue(binding.fragment===undefined||typeof binding.fragment==='string'&&binding.fragment.length<=1024,'Invalid note fragment.');}
  }
  requireValue(cards<=BOARD_LIMITS.cards&&points<=BOARD_LIMITS.points&&textBytes<=BOARD_LIMITS.totalText,'Board complexity budget exceeded.');
  requireValue(board.scene.appState&&typeof board.scene.appState==='object'&&!Array.isArray(board.scene.appState),'Invalid board appearance.');
  return board;
}
export function canonicalJSON(value) { if(Array.isArray(value))return '['+value.map(v=>canonicalJSON(v)??'null').join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';return JSON.stringify(value); }
export function boardFingerprint(board) { return canonicalJSON(board); }
