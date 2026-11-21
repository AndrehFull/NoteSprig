import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, FolderCog, Pencil, Plus, X } from 'lucide-react';
import { t } from '../i18n';
import type { VaultEntry } from '../api';
import { Modal } from './NoteTools';

/** The default vault keeps a translated name until the user renames it. */
export const vaultLabel = (vault: VaultEntry | undefined) => !vault ? t('My vault') : vault.default && vault.name === 'My vault' ? t('My vault') : vault.name;

/** Obsidian-style vault menu: the vault name opens a list of vaults and the vault manager. */
export function VaultSwitcher({ vaults, currentId, onSwitch, onManage }: { vaults: VaultEntry[]; currentId: string; onSwitch: (id: string) => void; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const current = vaults.find((vault) => vault.id === currentId);
  return <div className="vault-switcher" ref={root}>
    <button className="vault-switcher-button" aria-haspopup="menu" aria-expanded={open} aria-label={`${t('Switch vault')} (${vaultLabel(current)})`} title={t('Switch vault')} onClick={() => setOpen(!open)}><span>{vaultLabel(current)}</span><ChevronDown size={13}/></button>
    {open && <div className="file-context-menu vault-menu" role="menu" aria-label={t('Vaults')}>
      {vaults.map((vault) => <button key={vault.id} role="menuitemradio" aria-checked={vault.id === currentId} onClick={() => { setOpen(false); if (vault.id !== currentId) onSwitch(vault.id); }}>
        <span className="vault-menu-check">{vault.id === currentId && <Check size={13}/>}</span>{vaultLabel(vault)}
      </button>)}
      <hr/>
      <button role="menuitem" onClick={() => { setOpen(false); onManage(); }}><span className="vault-menu-check"><FolderCog size={13}/></span>{t('Manage vaults…')}</button>
    </div>}
  </div>;
}

export function VaultManager({ vaults, currentId, onSwitch, onCreate, onRename, onClose }: { vaults: VaultEntry[]; currentId: string; onSwitch: (id: string) => void; onCreate: (name: string) => Promise<void>; onRename: (id: string, name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<void>) {
    setBusy(true); setError('');
    try { await task(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  const create = (event: FormEvent) => { event.preventDefault(); if (name.trim()) void run(() => onCreate(name)); };
  const rename = (event: FormEvent) => { event.preventDefault(); if (renaming) void run(async () => { await onRename(renaming.id, renaming.name); setRenaming(null); }); };
  return <Modal onClose={onClose}>
    <div className="modal-heading"><h2>{t('Vaults')}</h2><button className="icon-button" aria-label={t('Close')} onClick={onClose}><X size={18}/></button></div>
    <p className="muted small">{t('Each vault is a separate folder of notes with its own links, graph, history, trash, and settings.')}</p>
    <ul className="vault-list" aria-label={t('Vaults')}>
      {vaults.map((vault) => <li key={vault.id} className={vault.id === currentId ? 'current' : ''}>
        {renaming?.id === vault.id
          ? <form onSubmit={rename}><input autoFocus aria-label={t('Vault name')} value={renaming.name} maxLength={60} onChange={(event) => setRenaming({ id: vault.id, name: event.target.value })}/><button className="quiet-button" disabled={busy || !renaming.name.trim()}>{t('Save')}</button><button type="button" className="quiet-button" onClick={() => setRenaming(null)}>{t('Cancel')}</button></form>
          : <><span className="vault-name">{vaultLabel(vault)}{vault.id === currentId && <small>{t('Current')}</small>}</span>
            <button className="mini-icon" aria-label={t('Rename vault {v0}', { v0: vaultLabel(vault) })} title={t('Rename')} onClick={() => setRenaming({ id: vault.id, name: vaultLabel(vault) })}><Pencil size={13}/></button>
            {vault.id !== currentId && <button className="quiet-button" disabled={busy} onClick={() => onSwitch(vault.id)}>{t('Open vault')}</button>}</>}
      </li>)}
    </ul>
    <form className="vault-create" onSubmit={create}>
      <label htmlFor="vault-create-name">{t('Create a new vault')}</label>
      <div><input id="vault-create-name" value={name} maxLength={60} placeholder={t('Vault name')} onChange={(event) => setName(event.target.value)}/><button className="primary-button" disabled={busy || !name.trim()}><Plus size={14}/>{t('Create and open')}</button></div>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
