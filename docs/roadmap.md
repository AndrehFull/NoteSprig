# Roadmap

NoteSprig is in early development. This roadmap describes priorities rather than release dates or guaranteed commitments. Implemented workflows and their limits are documented in the [user guide](user-guide.md).

## Current foundation

The workspace includes linked Markdown notes, graphs, Canvas, structured views, attachments, history, trash, offline drafts, and Docker packaging. The interface supports English and Brazilian Portuguese.

## Near-term priorities

- Validate daily use, accessibility, and performance with larger vaults.
- Exercise deployment, monitoring, external backups, and recovery in a real hosting environment.
- Improve onboarding and expand language coverage based on community contributions.
- Expand regression coverage around document formats and interrupted operations.

## Experimental unified visual boards

A [reviewed implementation plan](design/unified-canvas.md) defines a single visual board combining an Excalidraw drawing engine with live NoteSprig note references. It includes [prototype/release gates](design/unified-canvas-validation.md) and an [independent review record](design/unified-canvas-review.md). An opt-in implementation now embeds Excalidraw for drawing and passive note cards, with guarded references, scoped local checkpoints, managed images, import/export, and private recovery. See the [visual board guide](visual-boards.md). Automated feasibility tests are implemented; physical device, assistive technology, sustained performance, and destructive filesystem validation remain release gates. Existing Canvas files remain supported. Project workflow templates and explicit relationship provenance follow the core release.

## Planned AI integration

Support an external API provider with explicit provider configuration, selected note context, visible sources, and review before applying generated changes. This is not implemented, and no AI provider is configured in the current application.

Provider terms, transmitted context, cost controls, and credential storage must be considered as part of that implementation.

## Future exploration

Improve search, organization, automation, and structured views according to actual workflows. Separate user accounts, native clients, end-to-end encryption, and real-time collaborative editing are not available in the current product and have no scheduled release.
