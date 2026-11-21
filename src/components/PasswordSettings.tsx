import { useEffect, useState, type FormEvent } from 'react';
import { t, translateMessage } from '../i18n';
import { api } from '../api';

/** Change the sign-in password. Other devices are signed out; this browser stays signed in. */
export function PasswordSettings() {
  const [changeable, setChangeable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.passwordStatus().then((status) => setChangeable(status.changeable)).catch(() => setChangeable(false)); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== repeat) { setMessage({ error: true, text: t('The passwords do not match.') }); return; }
    setBusy(true); setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent(''); setNext(''); setRepeat('');
      setMessage({ error: false, text: t('Password changed. Other devices were signed out.') });
    } catch (error) { setMessage({ error: true, text: translateMessage((error as Error).message) }); }
    finally { setBusy(false); }
  }
  if (changeable === null) return null;
  return <details className="settings-detail" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary>{t('Password')}</summary>
    {changeable ? <form className="password-form" onSubmit={submit}>
      <label className="settings-field">{t('Current password')}<input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required/></label>
      <label className="settings-field">{t('New password')}<input type="password" autoComplete="new-password" minLength={12} value={next} onChange={(event) => setNext(event.target.value)} required/></label>
      <label className="settings-field">{t('Repeat password')}<input type="password" autoComplete="new-password" minLength={12} value={repeat} onChange={(event) => setRepeat(event.target.value)} required/></label>
      <button className="primary-button" disabled={busy}>{t('Change password')}</button>
    </form> : <p className="muted small">{t('This password is managed on the server (NOTESPRIG_PASSWORD_HASH or the development password) and cannot be changed here.')}</p>}
    {message && <p className={message.error ? 'form-error' : 'muted small'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </details>;
}
