# Unified Canvas implementation plan

Status: approved implementation design (v2), after three independent review rounds. This approves the plan; feature feasibility and release readiness remain gated. This document describes planned behavior, not functionality already implemented or a completed feasibility test. The existing Canvas remains the supported implementation until the gates below pass.

Design baseline: 7 November 2026. Candidate drawing engine: **`@excalidraw/excalidraw@0.18.1`**, pinned exactly for the feasibility work. Project documentation is English; the application must support English and Brazilian Portuguese.

Companion documents: [validation and release gates](unified-canvas-validation.md), [review record](unified-canvas-review.md), [current architecture](../architecture.md).

## 1. Product decision

Build one NoteSprig board where native drawing objects and cards referring to real vault notes share the same surface. Excalidraw owns drawing geometry and board interactions. NoteSprig owns note content, references, persistence, recovery, and project workflows.

| Responsibility | Owner |
| --- | --- |
| Shapes, freehand, text, frames, arrows, grouping, selection, movement, resizing, zoom, board undo | Excalidraw |
| Live note previews, opening/editing notes, reference review, application commands and translations | NoteSprig |
| File validation, optimistic concurrency, recovery journal, assets, history, backups | Vault/API |
| Derived contains-links, later explicit project relationships | Knowledge index |

There must be one canonical board scene, one coordinate/selection system, and one board undo history. Host previews may read engine coordinates for visibility; they must not introduce an independently transformed overlay or a second drag engine.

### First coherent release

- Native drawing tools, text, frames, images, visual arrows, and note-reference cards in one board.
- A live card shows the current title and a bounded, sanitized Markdown excerpt. Define the supported preview subset during the prototype: headings, paragraphs, lists, passive task indicators, and code text. Complex blocks receive a labeled Open note affordance. Existing `.canvas` rendering stays available.
- Add a note by picker, keyboard command, or explorer drag/drop. The picker works on touch devices without drag/drop.
- Open/Edit acts on the source Markdown file in the existing pane. Preview bodies are passive; there is no nested editor, media player, or scrolling region in the first release.
- Move, resize, select, duplicate, and remove cards using the drawing engine. Duplicating a card duplicates its reference; removing it never deletes its note.
- Layout locking is labeled **Lock board layout**. It is a local interaction mode, not an access-control feature.
- Save/reopen, local recovery, conflicts, complete asset handling, import/export with fidelity reports, and both interface languages are release requirements.
- The graph may show `board contains note` edges derived from verified references. Drawing an ordinary arrow does not edit Markdown or create a note-to-note relationship.

### Later increments

Explicit project relationships, templates, and status presentation follow the core release. Interactive note editing inside cards, live Bases/Kanban widgets, automatic task write-back, arbitrary web embeds, complex media previews, AI generation, and multiuser collaboration are separate proposals with their own acceptance gates. They are not prerequisites or implied capabilities of the embedded editor.

## 2. Supported integration and prototype decision

Use the official React package through a small adapter, without an upstream fork. Verified 0.18.1 extension points include `renderEmbeddable`, `validateEmbeddable`, `customData`, `onLinkOpen`, `updateScene`, `addFiles`, and `history.clear()`.

The upstream custom embeddable layer uses the engine's transforms, and embeddables can bind arrows. Custom content receives pointer interaction only after activation. These facts justify a prototype; they do not establish successful application UX or exports.

Internal card links use a reserved same-origin prefix such as `/_notesprig/board-card/` and an opaque marker. The canonical target is the validated namespaced element metadata, not the marker URL. The marker must not be treated as a filesystem path or a public document identity. Duplication must preserve a valid marker and reference without creating a second note.

- `validateEmbeddable` receives only a URL. Build a derived recognized-marker map from the already validated scene; the callback checks exact same-origin marker membership. The renderer independently checks the element metadata. Recognized stale/missing/unbound cards remain eligible for safe placeholders; eligibility is not permission to read a target. Arbitrary HTTP URLs and foreign embeds remain inactive.
- Every recognized card, including missing, invalid, stale, or virtualized cards, returns a safe React node. Returning `null` would activate the upstream iframe fallback.
- Intercept link opening and route through guarded vault resolution. The reserved route must never fall through to an iframe, external navigation, or an unguarded note endpoint.
- Replace/disable native scene load/save/export menus and shortcuts that could bypass the wrapper. Control clipboard and file-drop ingress too: image/scene validation and local dependency persistence precede engine ingestion. If public hooks cannot guarantee this, restrict those ingress paths and expose host picker commands; prove the restriction in P0. The host and engine need focus-aware shortcut arbitration with `handleKeyboardGlobally=false`.
- Provide Open/Edit in a host toolbar and keyboard-accessible list for the selected card. Always-clickable controls inside a passive preview are not assumed.
- Preview changes, language/theme switches, save acknowledgements, and asset hydration must not add board undo entries or mark the scene dirty.
- Host-card rotation, frame clipping, and stacking require an explicit compatibility matrix. If a combination fails the public-API prototype, disable/restrict it visibly for the MVP and provide an import/export fallback; essential selection/movement/resizing/binding cannot be waived. A restriction must be enforceable through supported APIs without surprise geometry rewrites or a hidden second history; otherwise the gate fails.

**P0 vertical slice:** one real note card, native shapes, a bound arrow, and an image must pass interaction, save/reopen, undo, offline, export, CSP, and touch/focus checks in [the gate matrix](unified-canvas-validation.md). If supported embeddables fail, retain the current Canvas and revise this plan. A fork or independent overlay requires a new architecture decision.

## 3. Storage and source-of-truth model

### Native NoteSprig document

Use a versioned **`.board`** document. It is a NoteSprig format, not a renamed `.canvas` or a claim of native `.excalidraw` compatibility.

Conceptual envelope; actual schemas and engine field allowlists are implementation deliverables:

```json
{
  "type": "notesprig-board",
  "schemaVersion": 1,
  "boardId": "opaque-uuid",
  "referenceContext": {
    "vaultId": "opaque-uuid",
    "restoreGeneration": "opaque-token",
    "epoch": "opaque-token"
  },
  "scene": {
    "elements": [],
    "appState": { "viewBackgroundColor": "#ffffff" }
  },
  "assets": {
    "engine-file-id": {
      "sha256": "sha256-of-exact-stored-bytes",
      "mimeType": "image/png",
      "byteLength": 12345,
      "width": 640,
      "height": 480
    }
  },
  "extensions": {}
}
```

A note-card element carries `customData.notesprig` with a metadata version, `kind: note-card`, binding state (`bound`, `missing`, or `unbound`), canonical vault-relative target path, and optional heading/block fragment. There is no second authoritative reference list; indexes are derived from active scene elements. A fragment is not a filesystem path.

Markdown is authoritative for note content. The board must not store another editable Markdown copy. Cached previews and export snapshots are explicitly derived, revision-labeled data.

Persist an allowlisted engine app-state subset that changes the document's appearance. Selection, tools, dragging, collaborators, clipboard/file handles, hover, camera, and viewport state are not document content. Camera/layout preferences are scoped browser preferences. Stable serialization/fingerprints must prevent unchanged scenes from generating writes.

Preserve bounded, safe unknown fields without executing them. Record the adapter/engine format baseline with the schema. Unknown schema versions or unsupported element types open in a recoverable read-only mode rather than being normalized into a lossy save. Upstream restore/serialization must not silently drop unsupported source data.

### Managed image assets

- Map engine file IDs to immutable SHA-256 content-addressed assets. Paths are derived by the server from digest and validated MIME, not accepted as arbitrary client paths.
- Store bytes in a regular managed attachment subtree, provisionally `attachments/notesprig-board-assets/`, so normal vault ZIP export can include dependencies. The subtree is app-managed: generic upload, rename, overwrite, folder move, delete, import overwrite, and trash endpoints must reject mutations affecting it. Dedicated validated asset operations may create immutable objects.
- The explorer may show a clearly protected/collapsed managed folder. Hiding it in UI must not omit it from archive traversal or backups.
- Never garbage-collect assets in the first release. Current scenes, undo, history, trash, and offline drafts can retain references absent from the visible board. Failed saves may leave harmless orphan objects; report disk growth and define GC separately later.
- The pinned public `BinaryFileData` contract requires a `dataURL`. Hydrate engine `BinaryFiles` from verified bytes using that contract; do not cast a Blob URL to a DataURL. Host preview Blob/object URLs are separate resources and must be revoked on disposal, logout, or vault changes. Bound and measure base64/string copies and decoded-image memory. Portable native export hydrates exact file bytes. Native database serialization alone is insufficient because it omits image bytes.

### Starting limits to validate in the prototype

| Resource | Initial policy |
| --- | --- |
| `.board` JSON, decoded UTF-8 | 4 MiB |
| Scene elements, including retained deleted elements | 5,000 |
| Note-reference cards | 200 |
| Managed image records per board | 100 |
| Individual static raster | 8 MiB; width/height no more than 4,096 |
| Total referenced decoded image pixels | 16 million |
| Total referenced compressed asset bytes | 64 MiB |
| Mounted expensive note previews | At most 20 per active board |
| Concurrent preview loads / asset uploads | At most 3 / 2 |
| Existing Markdown, Canvas, Bases / unrelated attachments | Preserve 2 MiB / 50 MiB policies |

P0 must also ratify per-element and aggregate freehand-point, text, metadata byte/depth, geometry, and export-area bounds. Enforce them before engine hydration; the JSON byte cap alone is not a complexity budget.

Validate exact encoded request sizes as well as file limits. The existing JSON request bound is 12 MiB; prove the serialized 4 MiB document fits with headroom, or add a board-specific bounded route without globally relaxing other document limits. Limits belong in one shared kind policy, with server enforcement. Oversize or unsupported imports fail before mutation and preserve the source. No silent element/image truncation or downscaling.

MVP raster formats are validated static PNG/JPEG/WebP. Reject animated content, SVG, and unsupported image formats before passing them to the drawing engine, or offer a separate explicit future conversion. Choose and pin a maintained server validation approach during P0; validate signatures, dimensions, MIME agreement, byte and pixel budgets, and bounded decode failure. Export output has an independent pixel/area budget.

## 4. Reference identity, rename, and restore protocol

A matching board hash proves board concurrency, not identity of a referenced file. For example, an offline card can point to A.md after A was renamed and a different file was created at A.md, while the board's old hash still matches.

V1 uses path references with conservative freshness guards rather than a vault-wide per-note identity migration.

### Durable reference state

Maintain versioned state under `.notesprig/` containing a stable `vaultId`, a `restoreGeneration`, an opaque `referenceEpoch`, and an occupied-note-path ledger including tombstones. Seed existing eligible target paths at activation. Update these records in the same mutation queue and recovery journal as structural operations.

- Rotate the reference epoch on rename/move, deletion, target replacement, identity-affecting merge, reuse of an occupied path, and relevant restore operations. Record both old and new occupied paths.
- A genuinely new never-occupied path and an ordinary content edit need not rotate it. If freshness/occupation cannot be established, rotate conservatively.
- First-release card binding selects existing Markdown files only. Missing or imported references never auto-bind merely because their path later exists.
- A known rename can rewrite saved matching card paths transactionally; deletion marks matching bindings missing. Updating an envelope's context must not bless unrelated stale/unreviewed bindings. Otherwise retain its old context and require review.
- Native `.board` duplicate within the same verified vault creates a new board ID and rechecks bindings. Foreign import starts unbound. Detect duplicate board IDs before hydrating a boardId-scoped draft: maintain/rebuild a derived boardId-to-path uniqueness index under the same lifecycle discipline. A copied file with duplicate ID requires an explicit recovery/import choice; never pick one path silently.

### Guard every reference use

Require expected vault ID, restore generation, and reference epoch for binding selection, preview fetch, opening/editing a target, export snapshot reads, and board save. The guard travels with subsequent writes from a card-opened Markdown editor, not just the initial read: rename/delete/path reuse while that editor is open must block a stale write even if a replacement file has identical bytes/hash. All scoped private document/asset mutation routes enforce vault ID and restore generation server-side as well as in the client. Resolve/read under the structural mutation queue or an equivalent snapshot-and-retry protocol. Validate again inside the actual board commit, not before waiting for its queue.

An old-context card shows a labeled cached snapshot or an unbound placeholder. It must not transparently fetch/open whatever now occupies the path. The board UI cannot bypass this by calling the existing unguarded note-by-path endpoint.

Epoch mismatch produces a typed reference-review response distinct from scene hash conflict, authentication failure, quota failure, missing target, and missing asset. V1 deliberately applies conservative global review after structural changes, including potentially unrelated changes. This is a documented usability cost, to measure in P0. Automatic clearance based only on path existence is forbidden. Per-binding generations or canonical-binding proofs can be designed later.

### Preserve drafts before structural replacement

Before importing over a board, accepting an authoritative structural revision, restoring history/trash, or resetting board undo, preserve a recoverable local scene, reference context, and pending asset dependencies. If that persistence fails, do not replace the local scene. Offer recovery export with verified completeness: a self-contained bundle is possible only when every manifest dependency is available. If old server assets are absent locally, clearly label an incomplete bundle and enumerate missing hashes/revisions; retain the source draft and all available pending bytes. Fetch dependencies before replacement, or require an explicit acknowledgement of the disclosed incomplete recovery. A locally unique pending blob must be preserved durably or included in the verified recovery before any reset; dispatching a browser download alone is not proof of recovery. Cancel never discards state.

Review presents old and authoritative paths where there is evidence, otherwise clearly labels deleted, missing, replaced, unbound, or unknown targets. Choices include preserve a recovery copy, explicitly select/rebind a current target, remove a reference, or accept the authoritative revision. Cancel leaves the draft untouched. Rebinding reads current previews under the new context; there is no bulk “paths exist, trust all” shortcut.

On accepted authoritative structural scene replacement, apply a documented **board undo boundary** using the public history-reset API and show a notice. Ordinary save echoes, preview changes, locale/theme changes, and note edits never clear board undo. Note content editing retains its own document-scoped undo. Board undo never changes Markdown content or trashes a referenced file.

### Vault replacement and restore

Namespace private drafts, previews, cached documents, image blobs, and outbox entries by `vaultId + restoreGeneration`; board work also uses `boardId`. Authenticated bootstrap establishes that context before any network upload or cache hydration. Offline startup uses only the last authenticated workspace. On reconnection, compare identity before flushing any outbox.

Old unscoped dirty caches must be preserved in a recovery quarantine until explicitly associated with the current vault. They cannot be used silently for live cards. Before logout invalidates a cookie or clears any private storage, inspect dirty scenes, note drafts, upload outboxes, locally unique blobs, and quarantined work in every workspace scope. Sync successfully, or block logout pending an explicit recovery/discard decision. Download dispatch is not recovery confirmation; cancellation preserves session and all stores. Only after those preconditions may logout clear private data, including new stores, legacy quarantine, private media, and object URLs. Public engine/font caches can remain.

Backup restoration rotates restore generation and reference freshness after extraction/verification and before committing the restored directory. Merely restoring the old metadata token is insufficient. Restored board/history bindings with old context stay unbound/review-required. A same-origin switch to a different vault quarantines old drafts rather than uploading them to the new vault.

### Durable transaction and acknowledgement boundary

Structural metadata and affected boards/files must have a durable common decision. Extend the current recovery journal rather than assuming several atomic file renames form one transaction. Use bounded staged preimages/postimages plus a manifest. One acceptable protocol stages and fsyncs all required data and intent, records and fsyncs a COMMIT decision before applying destinations, deterministically rolls committed operations forward on startup, and acknowledges only after destination files/directories and reference state are durable. Uncommitted intents must leave the prior state available. Cleanup is idempotent; a stale cleanup record must never roll back an acknowledged transaction. If journal removal represents the decision instead, its parent directory must be fsynced before success.

Hold the application mutation/read barrier while applying/recovering a structural operation. If a failure occurs after durable COMMIT, remain fail-closed until deterministic roll-forward succeeds; do not let the existing generic mutation-queue catch/resume behavior expose a partially applied transaction. Health/readiness must reflect the recovery barrier. Inject failures after each stage, decision, destination write, cleanup, and before/after ACK. ENOSPC, write, and fsync errors cannot produce a success acknowledgement.

Proposed preflight transaction budget: at most 100 affected documents, 128 MiB combined staged preimage/postimage bytes, and a 2 MiB manifest, plus verified free-space headroom. Ratify during P0. Stream bounded staged files rather than building an unbounded base64 JSON journal. Reject over-budget operations before mutation with an actionable error; never silently split one requested atomic operation. Immutable asset commits separately fsync their bytes and containing directories before they are acknowledged as dependencies.

Guarantees cover operations mediated by this single API process. Arbitrary external filesystem writers, metadata rollback, cloning a whole directory, and undetected delete/recreate sequences are not identity-safe. Provide an explicit Reconcile external changes procedure that preserves drafts, invalidates context, reindexes occupation, and requires binding review before resuming. Do not claim an ordinary watcher can perfectly infer file identity.

## 5. Save, offline, and history lifecycle

Use an explicit board controller connected to the shared document store, not independent per-card API fetches. Scope caches as above. Deduplicate referenced-note reads; cancel obsolete requests; show dirty local note content as such. Never bypass guarded reads or inject content from an unscoped legacy cache.

Save order:

1. Validate the persistent scene and asset policy. Coalesce UI-only changes away.
2. Commit scene draft, new Blob records, base hash/context, and upload outbox atomically in IndexedDB. Only then show **Saved on this device**. This means successful browser transaction completion, using strict IDB durability where supported; it is not an absolute guarantee against browser eviction or hardware failure.
3. Upload missing immutable assets idempotently. Verify their digests and manifests.
4. Commit the board conditionally using base hash and expected reference context. The server verifies all dependencies before atomic file write.
5. Acknowledge only the exact saved fingerprint. Changes made during upload remain dirty and form the next save. Lost acknowledgements retry identical bytes; do not manufacture new timestamps or history entries on retry.

An asset failure cannot leave a committed board that claims a missing dependency. A failed scene save can leave unused assets, retained safely. A 409 never triggers a blind JSON/element merge; retain both versions and offer a recovery copy or explicit replacement after review.

Separate save durability from retained historical checkpoints. Proposed starting cadence: local debounce up to 250 ms after completed edits; network save around 800 ms after a settled edit; a 30–60 second coalesced historical checkpoint during active editing, plus forced checkpoints before structural replacement/import/restore and a final settled checkpoint. Flush on document/tab switch and explicit Save; browser unload is best effort, so crash recovery must not rely on unload. P0 must measure and finalize the policy without snapshotting selection/camera or consuming the 100-version history in seconds.

| Visible state | Meaning |
| --- | --- |
| Unsaved / storing draft | No successful durable acknowledgement yet |
| Saved on this device | Scene and required new blobs committed locally |
| Waiting for asset upload | Local dependencies retained; server save incomplete |
| Saving | Conditional server scene commit pending |
| Saved on server | Scene and all required assets acknowledged |
| Reference review / conflict | Local draft preserved; automatic save blocked |
| Local storage failure | Keep memory, warn clearly, offer manifest-verified complete or clearly incomplete recovery export |

`Ready offline` is separate: the scene, direct note previews at their last verified context/revisions, managed media, editor chunks/styles, and necessary fonts must actually be present. Offline previews are labeled with their cached/stale status rather than advertised as universally current server content. Report unavailable items and storage estimates. Browser persistence requests are advisory, not a guarantee. Evict clean fetch caches first; never evict dirty scenes/outbox dependencies. Failed quota writes must never display a saved state.

## 6. Import, export, and legacy compatibility

| Operation | Contract |
| --- | --- |
| Open existing `.canvas` | Continue the current renderer and its supported behavior |
| Convert `.canvas` | Explicitly create a new `.board`; original unchanged; map cards/groups/arrows and report fidelity; review note bindings |
| Import `.excalidraw` | Validate sizes/types/images; stage assets before commit; import native geometry; unknown host metadata remains unbound |
| Import `.board` from another workspace | Validate version/assets; assign a new board ID; preserve content, require explicit target rebinding |
| Same-vault duplicate | New board ID, shared immutable assets, verified references; no duplicate Markdown files |
| Export private native `.board` transfer/recovery bundle | Manifest, scene, reference paths/context, and verified image bytes; explicitly disclosed as private, not a share-safe projection; source Markdown files are not included silently |
| Export `.excalidraw`, PNG, SVG | Explicit static projection with fidelity report and preview snapshots |

Private native transfer/recovery bundles preserve binding context for recovery; cross-vault/old-context import still requires review and never trusts it automatically. Complete native bundles contain every declared asset; incomplete emergency recovery bundles use an explicit incomplete manifest/label and cannot pass a complete-roundtrip check. Sharing projections (`.excalidraw`, PNG, SVG) have a different privacy/fidelity contract.

A fidelity report enumerates unsupported types, bounded excerpts, unknown properties, inaccessible media, and flattened/live features. Preserve original import bytes or an explicit source artifact in the recovery bundle when a conversion cannot round-trip them. Never claim conversion is lossless merely because drawing geometry survives.

Export captures one immutable scene revision and identified note/asset revisions. It creates a separate bounded projection: host cards become supported static native shapes/text or raster previews. Preserve visible position, size, rotation, opacity, frame/group membership, and arrow bindings where representable. Never alter the live scene or undo stack just to export. Missing content receives a visible labeled placeholder and report entry, never a blank omission.

Portable drawing exports strip internal marker URLs, binding epochs, and private live-reference metadata by default. Explain that visible note excerpts are included in static snapshots. An optional metadata-preserving export, if ever offered, needs an explicit disclosure. Reimporting a third-party projection does not automatically reactivate live bindings.

Existing ZIP expanded-size limit remains 128 MiB; larger vaults use full encrypted backups. A portable board export has its own bounded archive/import policy. Backups include reference state, protected assets, boards, history, and trash, and run with writes quiesced. Restore verifies manifests/digests before success.

## 7. PWA, security, licensing, and performance

The current PWA build precaches every JavaScript/CSS/font asset. A lazy React import alone will still download the editor during service-worker installation. Split a minimal app-shell precache from versioned on-demand drawing-engine/font resources. Show feature download/readiness and preserve installed feature caches for controlled old clients where storage permits. Define a bounded version policy during P0, not indefinite server retention: a client whose missing old chunks are no longer served must preserve work and offer a controlled upgrade before first editor use, not force-reload a dirty board. Test that case, cache eviction, and upgrade/reload with dirty boards. Feature cache eviction must clear its readiness flag. Private note/blob cleanup is independent of public editor resource caching.

Host required fonts/assets locally. Explicitly disable unconfigured collaboration, external library installation, sharing/upload services, arbitrary embeddables, and AI/network actions. Test production CSP, workers, font URLs, CSS isolation, and browser network traces with external destinations denied. An imported scene must not trigger remote fetches or read vault notes before explicit binding/loading approval.

Reuse authentication, origin checks, path protections, HTML sanitization, and optimistic concurrency on all new routes. Validate dangerous property names, IDs, finite/bounded geometry, counts, frame/binding consistency, digests, MIME and archive paths. Unsupported future fields are data, never executable configuration. Protect managed assets in the backend, not only UI.

Update runtime notices and include copied font/asset licenses as well as root package licenses; the existing top-level-only notice scan is not sufficient for newly distributed nested font assets. Pin the package/lockfile, verify React 19 compatibility and package exports from the installed release, and record dependency, engine/font, cold-load and export-memory sizes.

[Validation budgets](unified-canvas-validation.md) are proposed acceptance targets, not measurements. The prototype records desktop/mobile hardware and browser baselines, tests visibility-based expensive-preview activation, and pans through many previously visited cards: upstream embeds can stay mounted offscreen. Render memoized bounded previews rather than passing all appState through a whole-note renderer. The current FileCard's full recursive rich-content hydration is not the new preview implementation.

## 8. Work packages and delivery gates

| Phase | Work | Required exit evidence |
| --- | --- | --- |
| P0 — feasibility | Pin engine; prove native+host interactions, guarded reference prototype, export projection, CSP/fonts, offline feature loading, performance baselines | All P0 tests; explicit go/revise decision; finalize schema/limits/save cadence |
| P1 — foundations | Document-kind registry; schemas; vault identity/reference state; scoped cache migration; managed CAS assets; transactions and typed errors | Unit/integration tests for every lifecycle route, crash points, context mismatch and path reuse |
| P2 — unified editing | Board adapter/controller; passive live cards; picker/explorer; native tools and arrows; focus/undo rules; en/pt-BR; accessible actions | Core browser flows, no extra selection/drag authority, no note mutation from card operations |
| P3 — integrity and portability | Atomic draft+blobs/outbox; reconnect/conflicts; history/trash; `.canvas` and native import; static/portable exports; PWA readiness | Offline new-image recovery, quota/ack/crash tests, export fidelity and full backup restore |
| P4 — first release | Feature flag and opt-in dogfood; representative copied vaults; manual touch/screen-reader review; documentation; Docker/CI | All core workflows pass on the P0-ratified supported browser/device/assistive-tech matrix; no unresolved release blocker; supported limitations published |
| P5 — project workflows | Frames/templates and explicit relation metadata with provenance, then separately gated Bases/widgets | New behavior-specific tests; no implied task write-back or collaborative editing |

P1/P2 follow a successful P0. P3 depends on the foundation contracts; it is not postponed until after a public release. Project features use a stable board foundation. No delivery dates are promised before P0 establishes actual effort and limits.

A shared document-kind registry must cover suffix/type recognition, validation/limits, read/create/save, offline create/load/reconcile/prefetch, tab/workspace restore, conflict-copy suffix, explorer/icons, upload/import/ZIP, history/trash, rename/merge/reference updates, attachment classification, graph/preview/export, and backup checks. Adding only a renderer is insufficient. Record the mapping to existing files in the validation document.

## 9. Rollout and fallback

Ship behind an opt-in capability after all gates, using synthetic fixtures and copies of personal vaults during development. Keep existing `.canvas` files and renderer usable. Conversion is explicit and produces a new file plus report; no automatic in-place migration.

Reverting the UI must not remove saved `.board` data or assets. Provide read-only/recovery/export access when the editor feature is disabled. Unsupported versions preserve original bytes. Do not promise an older application version can interpret the new format; retain an encrypted pre-upgrade backup and exercise its restore.

The plan is accepted only when independent reviewers find no unresolved plan-level critical ambiguity. Renderer feasibility, benchmark results, manual accessibility, and release readiness require actual execution and separate evidence. Review consensus is not proof that the feature already works.

## Primary sources

- [Excalidraw 0.18.1 public integration types](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/types.ts).
- [0.18.1 embeddable rendering and activation](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/components/App.tsx).
- [0.18.1 element binding eligibility](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/element/typeChecks.ts).
- [0.18.1 serialization](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/data/json.ts) and [restore](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/data/restore.ts).
- [0.18.1 package metadata](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/package.json) and [license](https://github.com/excalidraw/excalidraw/blob/v0.18.1/LICENSE).
