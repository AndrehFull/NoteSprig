import { getLanguage, setLanguage, t, type Language } from '../i18n';

export function LanguageSelector() {
  return <label className="settings-row language-selector">
    <span>{t('Language')}</span>
    <select aria-label={t('Interface language')} value={getLanguage()} onChange={(event) => setLanguage(event.target.value as Language)}>
      <option value="en" lang="en">English</option>
      <option value="pt-BR" lang="pt-BR">Português (Brasil)</option>
    </select>
  </label>;
}
