import { t, getLocale } from './i18n';
export function formatDate(date: Date, format = 'YYYY-MM-DD') {
    const pad = (value: number) => String(value).padStart(2, '0');
    const tokens: Record<string, string> = { YYYY: String(date.getFullYear()), YY: String(date.getFullYear()).slice(-2), MMMM: date.toLocaleString(getLocale(), { month: 'long' }), MMM: date.toLocaleString(getLocale(), { month: 'short' }), MM: pad(date.getMonth() + 1), M: String(date.getMonth() + 1), DD: pad(date.getDate()), D: String(date.getDate()), dddd: date.toLocaleString(getLocale(), { weekday: 'long' }), ddd: date.toLocaleString(getLocale(), { weekday: 'short' }), HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()) };
    return format.replace(/\[[^\]]*\]|YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|HH|mm|ss|M|D/g, (token) => token.startsWith('[') ? token.slice(1, -1) : tokens[token]);
}
export function applyTemplate(source: string, title: string, date = new Date()) {
    return source.replace(/\{\{(date|time|title)(?::([^}]+))?\}\}/g, (_all, key: string, pattern?: string) => key === 'title' ? title : formatDate(date, pattern || (key === 'date' ? 'YYYY-MM-DD' : 'HH:mm')));
}
export type VaultSettings = {
    dailyFolder: string;
    dailyTemplate: string;
    dailyFormat: string;
    templatesFolder: string;
    attachmentFolder: string;
};
export const defaultVaultSettings: VaultSettings = { dailyFolder: t("Daily"), dailyTemplate: '', dailyFormat: 'YYYY-MM-DD', templatesFolder: 'Templates', attachmentFolder: 'attachments' };
