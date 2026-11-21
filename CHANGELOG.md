# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org/); each release has a matching Docker image `ghcr.io/andrehfull/notesprig:<version>`. NoteSprig is self-hosted software; there is no hosted service.

## Unreleased

### Added

- First-run password setup in the browser, gated by a one-time code from the server log; the session secret is generated automatically. `NOTESPRIG_PASSWORD_HASH` and `SESSION_SECRET` become optional.
- Change the password in Settings; other devices are signed out.

### Changed

- Updated lucide-react to 1.x, d3-force to 3.0.1, and the checkout, setup-node, and upload-artifact actions; removed the deprecated @types/dompurify stub (DOMPurify ships its own types).
- Updated the build to Vite 8 with @vitejs/plugin-react 6 (production builds are much faster), DOMPurify 3.4.18, Mermaid 12.3 (its elkjs layout dependency is now offered under EPL-2.0 OR GPL-3.0-or-later and is distributed under EPL-2.0), and concurrently 10.

## 0.1.0 — 2026-11-21

First public release.

### Added

- English and Brazilian Portuguese interfaces, persistent language selection, localized editor search, and a Brazilian Portuguese README.

- Browser workspace with folders, bookmarks, pinned tabs, and split panes.
- Markdown source editing, live preview, reading mode, properties, templates, and daily notes.
- Wikilinks, relative links, aliases, references, backlinks, search, and global/local graphs.
- Visual canvases and YAML-based structured views.
- Attachments, folder/ZIP import and export, history, trash, and conflict recovery.
- Installable PWA, cached documents, offline drafts, and reconnection handling.
- Password authentication, Docker packaging, encrypted backup and restoration tools.
- Public documentation, contribution guidance, security policy, CI, and dependency notices.
- Excalidraw-based Canvas (`.board`) combining drawings, images, and live Markdown note cards, with guarded note references, versioned saves, offline drafts, private recovery bundles, and `.excalidraw`/PNG/SVG sharing.
- Web embeds for any `https` address in the Canvas, including bare domains and pasted links; embeds export as link cards.
- Conversion of legacy `.canvas` files into a separate Canvas copy; the original file is kept.
- Multiple vaults: switch, create, rename, and remove (recoverably) vaults from the file explorer, each with its own files, history, settings, and workspace; automated backups include every vault.

### Changed

- Docker images are published to GitHub Container Registry for amd64 and arm64 after CI passes: `edge` from main, versioned tags and `latest` from releases, with build provenance attestations. Compose pulls the image by default.

- Adopted the NoteSprig identity, with compatibility for earlier metadata, browser storage, sessions, and backup formats.

### License

- Adopted the MIT License for original project code and documentation. Third-party components retain their respective terms.
