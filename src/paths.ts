export function normalizeTarget(raw: string) {
  let decoded = raw.trim(); try { decoded = decodeURIComponent(decoded); } catch { /* Literal percent. */ }
  return decoded.split('#')[0].replace(/\\/g, '/').replace(/^\/+|\.md$/gi, '').replace(/^\.\//, '');
}
export function resolveAsset(raw: string, origin: string, paths: string[]) {
  let target = raw.split('#')[0]; try { target = decodeURIComponent(target); } catch { /* Literal percent. */ }
  const clean = (value: string) => { const parts: string[] = []; for (const part of value.replace(/\\/g, '/').split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); } return parts.join('/'); };
  const folder = origin.split('/').slice(0, -1).join('/');
  const relative = clean(`${folder}/${target}`), root = clean(target);
  if (paths.includes(relative)) return relative;
  if (paths.includes(root)) return root;
  const suffix = paths.filter((file) => file.endsWith(`/${root}`));
  return suffix.length === 1 ? suffix[0] : root;
}
export function headingId(value: string) { return value.toLocaleLowerCase().replace(/<[^>]*>/g, '').replace(/[*_`~]/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-'); }
