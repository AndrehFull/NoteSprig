# Experimental visual boards

NoteSprig can combine freehand drawing, shapes, arrows, images, and live Markdown note cards on one Excalidraw surface. Enable **Settings → Enable experimental visual boards**, then choose **New visual board**. The existing JSON Canvas editor remains available.

This feature is opt-in while the release checks described in the [validation plan](design/unified-canvas-validation.md) are completed. Automated browser checks do not establish physical phone, tablet, screen reader, or large-board performance compatibility.

## Drawing and note cards

Use the drawing toolbar for geometry and undo/redo. Add an existing Markdown note with **Add note card**, or drag a Markdown file from Files into the board. Cards show bounded, read-only excerpts. Use their **Open note** action or the **Note cards** list to edit the underlying note in the adjacent pane. Editing, duplicating, or deleting a card does not create or delete the note itself. An ordinary drawing arrow does not change Markdown links.

The note list provides keyboard access to locating and opening cards. Excerpts refresh after note changes. At most 20 visible cards request previews, with three requests in progress at a time. Frames organize items without clipping. Native selection, dragging, resizing, rotation, and undo remain owned by Excalidraw.

The global graph can display a board's verified **contains** links when attachments are enabled. Multiple cards for one note produce one derived graph connection. Stale, unbound, and deleted cards do not create active connections.

## Save and recovery states

- **Saving on this device…** means an IndexedDB checkpoint is pending.
- **Saved on this device** means the scene, newly added image bytes, and pending upload information were committed together locally.
- **Saving…** means required images and the conditional scene update are being sent to the server.
- **Saved** means the server acknowledged that scene revision. Later edits remain pending until separately acknowledged.
- **Save needs attention** preserves the draft and exposes the error. A conflict does not merge arbitrary scene JSON or overwrite the other version.

Keep the tab open if browser storage fails. **Private recovery** can export both cached work and current in-memory work. Verify the downloaded file before discarding anything; starting a download is not confirmation that the file was saved successfully.

Signing out checks pending work across all workspace scopes, quarantined drafts, and in-memory sessions. Synchronize it, recover it, or explicitly choose to discard it. Unidentified drafts from older app versions are quarantined instead of automatically assigned to the current vault; **Recover as a new note** creates a separate Markdown file.

Durable board checkpoints are spaced approximately 45 seconds apart. Structural operations force a checkpoint. Board undo is a separate, session-local history.

## Reference review

Boards record a vault identity, restore generation, and reference epoch. Renaming, deleting, merging, restoring, or reusing occupied note paths can invalidate previous bindings. A file appearing at the same path does not establish that it is the original note.

A stale board blocks live resolution and editing through its cards. **Review references** requires choosing each note explicitly, or keeping it unbound. The server checks the context again when reading an excerpt, opening a card's editor, saving subsequent note edits, saving a board, or restoring a version. Restored versions retain their original reference context for review.

Local documents, drafts, board image bytes, and pending uploads are separated by vault identity and restore generation. A server backup restore rotates the generation. Old local work remains available for explicit recovery.

## Importing and sharing

Use **Import as a copy** to review a `.canvas`, `.excalidraw`, `.board`, or private board ZIP before creating a separate `.board` file. Original files are preserved. Note references imported from another document remain unbound until reviewed. Canvas Markdown becomes plain text, groups become organizational frames, and unsupported attachments receive visible placeholders. The conversion report identifies these changes.

**Share** offers `.excalidraw`, PNG, and SVG. Note cards become static shapes and text. These exports remove internal live-reference metadata and marker URLs, but **include visible note excerpts**. Unavailable content receives a labeled placeholder and a fidelity report. PNG/SVG output is limited to 16 million pixels; use JSON for larger geometry.

A **private recovery ZIP** contains the original board context and verified image bytes. It is private transfer material. If an older required image is unavailable, its manifest explicitly lists the missing hash and labels the recovery incomplete. Such a bundle cannot be imported as a complete board. Source Markdown notes are not silently bundled.

## Files and limits

Boards use a versioned, readable `.board` JSON envelope. Image bytes are immutable SHA-256 addressed files under `attachments/notesprig-board-assets`. Generic uploads, renames, deletion, and ancestor-folder operations cannot replace managed assets. The initial implementation does not garbage collect them, because history, undo, trash, and unsynchronized work can still depend on older bytes.

| Resource | Limit |
| --- | --- |
| Board JSON | 4 MiB |
| Native scene elements, including deleted history | 5,000 |
| Note cards | 200 |
| Managed images | 100 |
| Individual image | 8 MiB; 4,096 pixels per dimension |
| Total decoded image area | 16 million pixels |
| Total compressed image bytes | 64 MiB |
| Structural transaction | 100 file operations; 128 MiB staged before/after bytes |

Only static PNG, JPEG, and WebP images are accepted. The server decodes and validates them before accepting a scene. Other Markdown, Canvas, and Bases document limits remain 2 MiB; ordinary attachments remain limited to 50 MiB.

## Offline dependencies and deployment

The application shell and drawing feature have separate caches. Opening a board prepares the pinned drawing chunks and local fonts, checking their SHA-256 hashes. **Drawing tools ready offline** appears only after every required dependency is verified. It describes drawing dependencies; each board's private scene and images still need local checkpoints.

The app retains old public chunks for open clients. A missing drawing chunk produces a recovery message instead of automatically reloading or clearing work. Reconnect and reload when ready. Cache growth and controlled cleanup are follow-up release checks.

All fonts are served locally. The pinned engine includes an external font fallback; production CSP denies it. SVG font subsetting can fall back to embedding the complete local font under strict CSP. No `unsafe-eval` permission is added. The upstream engine and font licenses remain distinct from NoteSprig's MIT license; see [font provenance](legal/board-fonts/README.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

Docker builds prepare and verify the font assets and distribute their notices and corresponding font source under `/legal/`. Managed board assets and reference metadata belong in the same vault backup as the notes. AI providers, collaborative editing, inline note editing, and interactive Bases cards are separate future features.
