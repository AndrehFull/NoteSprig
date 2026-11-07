# Architecture

NoteSprig is a browser application backed by a Node.js API and a single filesystem vault. Docker packages the compiled interface and API together; there is no external database service.

## Components

| Component | Responsibility |
| --- | --- |
| `src/` | React and TypeScript workspace, commands, editors, graphs, and views |
| `src/components/` | CodeMirror editing, Markdown rendering, Canvas, structured views, and navigation |
| `server/index.mjs` | HTTP API, authentication integration, and static file serving |
| `server/vault.mjs` | File operations, path validation, hashes, history, trash, and recovery journal |
| `server/auth.mjs` | Password hashing and session validation |
| `src/storage.ts` | IndexedDB document cache and local drafts |
| `scripts/service-worker.js` | Compiled application shell and attachment caching |
| `scripts/backup.mjs` | Encrypted backup creation and verified restoration |
| `branding.json` | Shared public name, description, slogan, and theme metadata |

The development frontend runs in Vite on port 5173 and proxies `/api` to Node on port 4317. A compiled installation serves both from Node on port 4317.

## Files and persistence

The vault contains Markdown notes, JSON Canvas documents, YAML Bases documents, and binary attachments. Internal settings, versions, and recovery data live in `.notesprig/`; deleted items live in `.trash/`. These directories remain private to the server rather than being imported as user documents.

Writes are atomic and check expected content hashes. Renames and other multi-file operations use a recovery journal. This model detects conflicting edits but does not implement distributed transactions or real-time collaboration. Run one API process per vault.

IndexedDB stores browser copies and pending drafts. Preferences and workspace layout use browser storage. The service worker caches the interface and a bounded set of viewed attachments. These caches do not replace a server backup.

## Rendering and graphs

CodeMirror handles editing. Markdown is rendered with sanitization, syntax highlighting, KaTeX math, and Mermaid diagrams. Graph data comes from parsed links and metadata; D3 forces position nodes on a Canvas 2D surface.

Structured-view formulas are interpreted by supported operators and functions rather than evaluated as JavaScript. External application plugins are not loaded.

## Trust boundaries

Password authentication grants access to one vault. There are no per-user accounts or per-note permissions. Production requires a configured password hash and session secret. The trusted HTTPS proxy is responsible for external TLS termination; the server handles session cookies and authenticated file operations.

Server filesystem access also grants access to readable notes. Encryption protects backup archives, not live files on the server. See [SECURITY.md](../SECURITY.md) and [deployment](deployment.md).

## Development compatibility

The two compatibility modules retain only the identifiers needed to read earlier metadata, browser storage, environment variables, sessions, and backups. See [migration](migration.md). Changes to these formats need regression coverage before release.
