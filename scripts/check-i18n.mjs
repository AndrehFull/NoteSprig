import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const en = JSON.parse(await readFile('src/locales/en.json', 'utf8'));
const pt = JSON.parse(await readFile('src/locales/pt-BR.json', 'utf8'));
const errors = [];
const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
if (JSON.stringify(Object.keys(en).sort()) !== JSON.stringify(Object.keys(pt).sort())) errors.push('Locale catalogs have different keys.');
for (const [key, text] of Object.entries(en)) {
  if (!text || !pt[key]) errors.push(`Empty translation: ${key}`);
  if (parameters(text) !== parameters(pt[key] || '')) errors.push(`Mismatched placeholders: ${key}`);
}
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'locales') await walk(file);
    else if (/\.tsx?$/.test(file)) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && !Object.hasOwn(en, node.arguments[0].text)) errors.push(`${file}: missing catalog key: ${node.arguments[0].text}`);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
await walk('src');
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Verified ${Object.keys(en).length} English/Brazilian Portuguese messages, placeholders, and source keys.`);
