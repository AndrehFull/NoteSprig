import { useSyncExternalStore } from 'react';
import english from './locales/en.json' with { type: 'json' };
import portuguese from './locales/pt-BR.json' with { type: 'json' };

export type Language = 'en' | 'pt-BR';
type Parameters = Record<string, string | number>;
const catalogs: Record<Language, Record<string, string>> = { en: english, 'pt-BR': portuguese };
const key = 'notesprig.language';
const listeners = new Set<() => void>();
function readPreference(): Language {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'pt-BR' ? 'pt-BR' : 'en'; }
  catch { return 'en'; }
}
let language = readPreference();
export function getLanguage(): Language { return language; }
export function getLocale(): string { return language === 'pt-BR' ? 'pt-BR' : 'en-US'; }
export function editorPhrases(): Record<string, string> { return language === 'pt-BR' ? portuguese : {}; }
export function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'pt-BR') return;
  language = next;
  try { localStorage.setItem(key, next); } catch { /* Keep the current session usable without persistent storage. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}
export function useLanguage(): Language {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage, () => 'en');
}
export function t(source: string, parameters: Parameters = {}): string {
  const template = catalogs[language][source] ?? catalogs.en[source] ?? source;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => parameters[name] === undefined ? placeholder : String(parameters[name]));
}

// Only use this for application messages, never for user-authored note content.
export function translateMessage(message: string): string {
  for (const source of Object.keys(english)) {
    for (const template of [source, catalogs['pt-BR'][source]]) {
      if (message === template) return t(source);
      if (!template.includes('{v')) continue;
      const names: string[] = [];
      const pattern = template.split(/(\{v\d+\})/).map((part) => {
        if (/^\{v\d+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      const match = message.match(new RegExp(`^${pattern}$`));
      if (match) return t(source, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
    }
  }
  return message;
}

if (typeof window !== 'undefined') {
  document.documentElement.lang = language;
  window.addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    language = readPreference(); document.documentElement.lang = language;
    for (const listener of listeners) listener();
  });
}
