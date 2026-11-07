# User guide

NoteSprig runs in your browser and stores a personal vault on your server. The interface supports English and Brazilian Portuguese. English is the default. Choose the language on the login screen or in Settings → Language; the preference is stored in this browser. Language changes do not translate notes, rename files, or alter saved vault settings.

## Navigate the workspace

| Action | Shortcut or location |
| --- | --- |
| Global graph | `Ctrl+G` or the network icon in the left ribbon |
| Local graph | Open a note, then use its graph action or the graph's Local button |
| Open a file | File explorer or `Ctrl+O` |
| Command palette | `Ctrl+P` |
| New note | `Ctrl+N` |
| Search | `Ctrl+Shift+F` |
| Toggle editing/reading | `Ctrl+E` |
| History | File context menu |
| Recover deleted files | Trash icon in the ribbon |

Some shortcuts are reserved by the browser or operating system. The command palette also exposes Canvas, Bases, templates, daily notes, slides, recording, and note composition tools.

Tabs can be pinned, reordered, and split into two pane groups. Layout, bookmarks, and appearance preferences belong to the browser you are using. Daily-note, template, and attachment settings are saved in `.notesprig/settings.json` in the vault.

## Link notes across folders

Use wikilinks or relative Markdown links:

```markdown
[[Projects/Atlas]]
[[Projects/Atlas|Project overview]]
[Project overview](Projects/Atlas.md)
```

Markdown paths are relative to the source file. In a note inside `Projects/`, `[Index](../Index.md)` points to a note in the parent directory. Wikilinks also support aliases and heading/block references. Ambiguous names may require a more specific path.

The graph draws relationships from actual links in your files. Notes without links appear as isolated nodes. The local graph starts from the selected note; graph controls adjust depth, filters, groups, and forces. Renaming or moving files through the app updates supported references, including references across folders.

## Edit and organize

Markdown supports source mode, live preview, and reading mode. Properties use YAML frontmatter. Templates and configurable daily notes are available from the command palette.

A `.canvas` file stores cards, groups, and connections as JSON. Unknown JSON fields are preserved. Canvas URLs open externally; file cards open their referenced note for editing. PNG export is schematic and does not fully render all media.

A `.base` file stores structured views in YAML. Table, list, cards, and Kanban layouts support filtering, sorting, grouping, formulas, property editing, and CSV export. Unsupported functions show an error. Arbitrary JavaScript is not evaluated as a formula.

## Import and export

Folder import preserves supported Markdown, Canvas, Bases, and attachment paths. Hidden configuration folders are skipped, and existing files are not overwritten. The command palette also provides ZIP import and export.

| Item | Current limit |
| --- | --- |
| Text documents | 2 MB |
| Individual attachments | 50 MB |
| Expanded ZIP import | 128 MB |
| Historical versions | Up to 100 per path |
| Cached attachments | Up to 40 entries, each below 10 MB |

ZIP export contains visible vault files. It does not include hidden history, trash, or settings. Use an [encrypted backup](deployment.md#encrypted-backups) for a complete copy.

## Recover changes

History supports comparison and restoration. Deleting moves a file or folder into `.trash`; restoration does not overwrite an existing destination. Structured operations use a journal to recover interrupted changes.

The app checks content hashes before saving. When a server file and local draft conflict, keep a copy rather than overwriting another edit. Use one app instance per vault; real-time collaboration and coordinated editing between independent offline tabs are not implemented.

## Work offline

Open the compiled application on localhost or HTTPS while connected first. The PWA caches the interface, and the app stores documents and drafts locally. Attachments become available as they are viewed and cached within the limits above. Uncached content still needs a connection.

Pending drafts survive a reload. Reconnect to synchronize them and resolve conflicts. Logging out synchronizes pending changes and clears the private app cache when successful. Clearing all browser storage can permanently remove unsynchronized drafts.

Offline storage is specific to the browser and device. The server vault remains the shared source for access from other devices. Notes are not end-to-end encrypted; use HTTPS and protect the server and browser profile.
