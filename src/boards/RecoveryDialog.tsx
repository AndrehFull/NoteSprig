import { volatileBoardRecovery } from './session';
import { useEffect, useState } from 'react';
import { localEntries, pendingPrivateWork, removeLocal } from '../storage';
import { t } from '../i18n';
import { api } from '../api';
import { downloadFile as downloadBoardFile } from '../download';
export default function RecoveryDialog({onClose,onDiscard,onRecovered,volatileNotes}:{volatileNotes:()=>unknown;onClose:()=>void;onDiscard:()=>Promise<void>;onRecovered:()=>void}) {
  const [entries,setEntries]=useState<[string,unknown][]>([]),[checked,setChecked]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{void pendingPrivateWork().then(setEntries);},[]);
  async function exportRecovery() {
    try {
      const all=await localEntries();
      const base64=(bytes:Uint8Array)=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
      const json=JSON.stringify({type:'notesprig-device-recovery',version:1,entries:all,volatileNotes:volatileNotes(),volatileBoards:volatileBoardRecovery()},(_key,value)=>value instanceof Uint8Array?{type:'bytes-base64',data:base64(value)}:value);
      downloadBoardFile(new Blob([json],{type:'application/json'}),'notesprig-private-device-recovery.json');
      setMessage(t('The download was requested. Verify the file before discarding drafts.'));
    } catch(error){setMessage((error as Error).message);}
  }
  async function recover(key:string,value:unknown) {
    const note=value as{content?:string};if(typeof note.content!=='string')return;
    try {await api.create(`Recovered/${crypto.randomUUID()}.md`,note.content);await removeLocal(key);setEntries(await pendingPrivateWork());onRecovered();}
    catch(error){setMessage((error as Error).message);}
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={t('Private recovery')}><h2>{t('Private recovery')}</h2><p>{t('Unsynchronized work exists in this or another workspace. Recovery files contain private notes, references, and images.')}</p><ul>{entries.map(([key,value])=><li key={key}><code>{key}</code>{key.startsWith('quarantine:')&&typeof(value as{content?:string})?.content==='string'&&<button onClick={()=>void recover(key,value)}>{t('Recover as a new note')}</button>}</li>)}</ul>{message&&<p role="status">{message}</p>}<button onClick={()=>void exportRecovery()}>{t('Download private device recovery')}</button><label className="settings-row">{t('I verified my recovery file or choose to discard this work.')}<input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/></label><div className="modal-actions"><button onClick={onClose}>{t('Cancel')}</button><button className="destructive" disabled={!checked} onClick={()=>void onDiscard()}>{t('Discard pending work and sign out')}</button></div></section></div>;
}
