import { parseDocument } from 'yaml';
// Only parse YAML delimited by standalone lines. Keep all source text on errors;
// metadata must never select an executable parser from a language suffix.
export function parseFrontmatter(source) {
    const fallback = { content: source, data: {} };
    if (!/^\uFEFF?---[ \t]*\r?\n/.test(source))
        return fallback;
    const match = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m);
    if (!match)
        return { ...fallback, error: "The YAML block is missing its closing delimiter." };
    try {
        const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true });
        if (document.errors.length)
            throw document.errors[0];
        const data = document.toJS({ maxAliasCount: 50 }) || {};
        if (typeof data !== 'object' || Array.isArray(data))
            throw new Error("Properties must be name: value pairs.");
        JSON.stringify(data);
        return { data, content: source.slice(match[0].length) };
    }
    catch {
        return { ...fallback, error: "Invalid YAML properties. The original text was preserved in the editor." };
    }
}
