import { t } from './i18n';
import jsep from 'jsep';
import { formatDate } from './templates';
import type { NoteSummary } from './types';
type Ast = {
    type: string;
    [key: string]: unknown;
};
export type BaseRow = {
    file: NoteSummary;
    properties: Record<string, unknown>;
};
const blocked = new Set(['constructor', 'prototype', '__proto__']);
const parsed = new Map<string, Ast>();
export function evaluateBase(expression: string, row: BaseRow, formulas: Record<string, string> = {}, extra: Record<string, unknown> = {}, stack = new Set<string>()): unknown {
    if (expression.length > 10000 || stack.size > 24)
        throw new Error(t("Expression exceeds the allowed limit."));
    let ast = parsed.get(expression);
    if (!ast) {
        ast = jsep(expression) as Ast;
        if (parsed.size > 300)
            parsed.clear();
        parsed.set(expression, ast);
    }
    const name = row.file.path.split('/').at(-1) || row.file.path, extension = name.match(/\.([^.]+)$/)?.[1] || '';
    const file = { name: name.replace(/\.[^.]+$/, ''), basename: name.replace(/\.[^.]+$/, ''), fullname: name, path: row.file.path, folder: row.file.path.split('/').slice(0, -1).join('/'), ext: extension, size: row.file.size, mtime: new Date(row.file.mtime), ctime: new Date(row.file.mtime), tags: row.file.tags, links: row.file.links.map((link) => link.target) };
    const formulaMarker = {};
    const numeric = (value: unknown) => value instanceof Date ? value.getTime() : Number(value);
    const own = (object: unknown, key: string): unknown => {
        if (blocked.has(key))
            throw new Error(t("Property access is not allowed."));
        if (object === formulaMarker) {
            if (stack.has(key))
                throw new Error(t("Circular formula."));
            if (!Object.hasOwn(formulas, key))
                return null;
            return evaluateBase(formulas[key], row, formulas, extra, new Set([...stack, key]));
        }
        if (key === 'length' && (typeof object === 'string' || Array.isArray(object)))
            return object.length;
        return object && typeof object === 'object' && Object.hasOwn(object, key) ? (object as Record<string, unknown>)[key] : null;
    };
    function method(object: unknown, property: string, args: unknown[]) {
        if (blocked.has(property))
            throw new Error(t("Method not allowed."));
        if (object === file) {
            if (property === 'hasTag')
                return file.tags.some((tag) => tag === String(args[0]).replace(/^#/, '') || tag.startsWith(`${String(args[0]).replace(/^#/, '')}/`));
            if (property === 'inFolder')
                return file.folder === args[0] || file.folder.startsWith(`${args[0]}/`);
            if (property === 'hasLink')
                return file.links.some((target) => target === args[0] || target.replace(/\.md$/i, '').endsWith(`/${String(args[0]).replace(/\.md$/i, '')}`));
            if (property === 'hasProperty')
                return Object.hasOwn(row.properties, String(args[0]));
        }
        if (property === 'isEmpty')
            return object == null || object === '' || Array.isArray(object) && !object.length;
        if (property === 'toString')
            return String(object ?? '');
        if (property === 'contains' || property === 'includes')
            return Array.isArray(object) ? object.includes(args[0]) : String(object ?? '').includes(String(args[0]));
        if (property === 'containsAny' && Array.isArray(object))
            return args.flat().some((item) => object.includes(item));
        if (property === 'containsAll' && Array.isArray(object))
            return args.flat().every((item) => object.includes(item));
        if (typeof object === 'string') {
            if (property === 'lower' || property === 'toLowerCase')
                return object.toLocaleLowerCase();
            if (property === 'upper' || property === 'toUpperCase')
                return object.toLocaleUpperCase();
            if (property === 'trim')
                return object.trim();
            if (property === 'startsWith')
                return object.startsWith(String(args[0]));
            if (property === 'endsWith')
                return object.endsWith(String(args[0]));
            if (property === 'split')
                return object.split(String(args[0]));
            if (property === 'slice')
                return object.slice(Number(args[0]), args[1] === undefined ? undefined : Number(args[1]));
            if (property === 'replace')
                return object.replace(String(args[0]), String(args[1]));
        }
        if (typeof object === 'number') {
            if (property === 'toFixed')
                return object.toFixed(Math.max(0, Math.min(12, Number(args[0] || 0))));
            if (property === 'round') {
                const factor = 10 ** Math.max(0, Math.min(12, Number(args[0] || 0)));
                return Math.round(object * factor) / factor;
            }
            if (property === 'abs')
                return Math.abs(object);
            if (property === 'floor')
                return Math.floor(object);
            if (property === 'ceil')
                return Math.ceil(object);
        }
        if (object instanceof Date && property === 'format')
            return formatDate(object, String(args[0] || 'YYYY-MM-DD'));
        if (Array.isArray(object)) {
            const numbers = object.filter((value) => typeof value === 'number');
            if (property === 'join')
                return object.join(String(args[0] ?? ', '));
            if (property === 'unique')
                return [...new Set(object)];
            if (property === 'sum')
                return numbers.reduce((sum, value) => sum + value, 0);
            if (property === 'mean')
                return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
            if (property === 'min')
                return Math.min(...numbers);
            if (property === 'max')
                return Math.max(...numbers);
        }
        throw new Error(t("Unsupported function: {v0}", { v0: property }));
    }
    function evaluate(node: Ast, depth = 0): unknown {
        if (depth > 80)
            throw new Error(t("Expression is too deeply nested."));
        const run = (value: unknown) => evaluate(value as Ast, depth + 1);
        if (node.type === 'Literal')
            return node.value;
        if (node.type === 'Identifier') {
            const key = String(node.name);
            if (blocked.has(key))
                throw new Error(t("Identifier not allowed."));
            if (key === 'file')
                return file;
            if (key === 'note')
                return row.properties;
            if (key === 'formula')
                return formulaMarker;
            if (Object.hasOwn(extra, key))
                return extra[key];
            return own(row.properties, key);
        }
        if (node.type === 'ArrayExpression')
            return (node.elements as Ast[]).map(run);
        if (node.type === 'MemberExpression')
            return own(run(node.object), node.computed ? String(run(node.property)) : String((node.property as Ast).name));
        if (node.type === 'UnaryExpression') {
            const value = run(node.argument);
            if (node.operator === '!')
                return !value;
            if (node.operator === '-')
                return -numeric(value);
            if (node.operator === '+')
                return numeric(value);
        }
        if (node.type === 'ConditionalExpression')
            return run(node.test) ? run(node.consequent) : run(node.alternate);
        if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
            const left = run(node.left);
            if (node.operator === '&&')
                return left && run(node.right);
            if (node.operator === '||')
                return left || run(node.right);
            if (node.operator === '??')
                return left ?? run(node.right);
            const right = run(node.right);
            const a = left instanceof Date ? left.getTime() : left, b = right instanceof Date ? right.getTime() : right;
            switch (node.operator) {
                case '==':
                case '===': return a === b;
                case '!=':
                case '!==': return a !== b;
                case '>': return (a as number) > (b as number);
                case '>=': return (a as number) >= (b as number);
                case '<': return (a as number) < (b as number);
                case '<=': return (a as number) <= (b as number);
                case '+': return typeof a === 'string' || typeof b === 'string' ? String(a ?? '') + String(b ?? '') : numeric(a) + numeric(b);
                case '-': return numeric(a) - numeric(b);
                case '*': return numeric(a) * numeric(b);
                case '/': return numeric(a) / numeric(b);
                case '%': return numeric(a) % numeric(b);
                case '**': return numeric(a) ** numeric(b);
            }
        }
        if (node.type === 'CallExpression') {
            const callee = node.callee as Ast;
            if (callee.type === 'Identifier' && callee.name === 'if') {
                const args = node.arguments as Ast[];
                return run(args[0]) ? run(args[1]) : args[2] ? run(args[2]) : null;
            }
            const args = (node.arguments as Ast[]).map(run);
            if (callee.type === 'MemberExpression')
                return method(run(callee.object), callee.computed ? String(run(callee.property)) : String((callee.property as Ast).name), args);
            const name = String(callee.name);
            if (name === 'number')
                return Number(args[0]);
            if (name === 'string')
                return String(args[0] ?? '');
            if (name === 'list')
                return args;
            if (name === 'date')
                return new Date(String(args[0]));
            if (name === 'now')
                return new Date();
            if (name === 'today') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                return today;
            }
            if (name === 'min')
                return Math.min(...args.map(Number));
            if (name === 'max')
                return Math.max(...args.map(Number));
            if (name === 'link')
                return String(args[1] ?? args[0] ?? '');
            throw new Error(t("Unsupported function: {v0}", { v0: name }));
        }
        throw new Error(t("Unsupported expression."));
    }
    return evaluate(ast);
}
export function matchesBaseFilter(filter: unknown, row: BaseRow, formulas: Record<string, string>, depth = 0): boolean {
    if (depth > 30)
        throw new Error(t("Filter is too deeply nested."));
    if (filter === undefined || filter === null)
        return true;
    if (typeof filter === 'string')
        return Boolean(evaluateBase(filter, row, formulas));
    if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new Error(t("Invalid filter format."));
    const object = filter as Record<string, unknown>;
    for (const key of ['and', 'or', 'not'])
        if (Array.isArray(object[key])) {
            const values = object[key] as unknown[];
            const matches = (value: unknown) => matchesBaseFilter(value, row, formulas, depth + 1);
            return key === 'and' ? values.every(matches) : key === 'or' ? values.some(matches) : !values.some(matches);
        }
    throw new Error(t("Filter requires and, or, or not."));
}
