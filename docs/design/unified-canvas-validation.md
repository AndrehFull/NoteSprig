# Unified Canvas validation and release gates

This is an executable acceptance plan, not a report of passing tests. Read the [design](unified-canvas.md) and [review record](unified-canvas-review.md).

## 1. Decisive prototype gate

Build a disposable, version-pinned vertical slice after design approval. It must contain one real Markdown reference card, a native shape, a bound arrow, and a managed image in the same engine scene. Run it with the production CSP, local fonts/assets, host CSS, and existing application shortcuts.

Use public scene APIs and element IDs for assertions. Avoid relying on private upstream DOM class names for geometry or binding correctness. A test-only adapter may expose sanitized scene state in test builds; it must not become an unauthenticated production debug endpoint.

| ID | Required experiment | Pass condition |
| --- | --- | --- |
| V01 | Select, move, resize, group and bind the host card at 50%, 100%, and 200% zoom; probe rotation separately | Correct native world-coordinate deltas and native bound element IDs; no independent drag/selection state; rotation either passes the recorded matrix or is explicitly restricted with import/export fallback |
| V02 | Compare native and host elements in frames, overlapping groups, clipping and stacking | Declared behavior is correct in both the live view and static export; unsupported combinations must be restricted explicitly or block the design |
| V03 | Passive card activation, Open/Edit, touch, keyboard focus and scrolling | Host toolbar/list remains usable without activating card body; no accidental note edits or simultaneous pan/text handling |
| V04 | Single gesture, duplicate/remove card, note editing, normal save echo, theme/language changes | One board gesture is one board undo step; source note unchanged by card actions; note undo is separate; ordinary refreshes do not clear board history |
| V05 | Open board A, switch to B, return; delayed note/image response from A | No data or requests applied to B; drafts remain correctly scoped; late operations are cancelled or discarded |
| V06 | Export rotated/clipped/transparent/framed cards with bound arrows and image | Every supported visible item has a faithful documented projection or labeled placeholder; live scene/undo unchanged |
| V07 | Deny all unapproved external network destinations | Normal drawing, note cards, assets, export and installed offline editing use only permitted local resources |
| V08 | Native load/save/export, clipboard/drag-drop ingress, Ctrl/Cmd+S/O/Z, app commands and modals | Wrapper cannot be bypassed; the focused board, note editor, input or modal alone receives its intended action |
| V09 | Pan through many different cards, including previously visited offscreen cards | At most 20 expensive previews active; cancelled/deduplicated bounded reads; hidden embeds do not accumulate full renderers |
| V10 | Fresh installation, first editor download, offline after warm load, SW upgrade with dirty scene | Minimal shell stays separate; readiness is truthful; no lost draft, missing required resource falsely declared available, or forced destructive reload |

All V tests are P0. Record exact package lock, browser/OS, hardware, scene fixture, network trace and observed limitations. The reviewer can approve the design while these tests remain unexecuted; the feature cannot pass P0 without them.

## 2. Data integrity and fault injection

| ID | Scenario | Required result |
| --- | --- | --- |
| D01 | Offline new drawing and image -> reload -> reconnect | Exact scene and image bytes recover and upload before scene acknowledgement |
| D02 | Crash after asset commit but before board commit | Old board remains valid; harmless orphan retained |
| D03 | Crash after board commit but before acknowledgement; retry | Same persistent fingerprint is acknowledged; no duplicate objects or repeated semantic history checkpoints |
| D04 | Edit during upload and successful acknowledgement of prior revision | Later content remains dirty and is saved next |
| D05 | Two clients edit the same board | Typed conflict preserves both revisions; no automatic JSON merge |
| D06 | Old board draft adds A.md after server renames A to B and creates a different A | Save, preview read, Open/Edit and export binding reads reject stale context; wrong note is never silently shown |
| D07 | Delete a referenced note, reload board, then reuse its old path | Missing binding stays missing/unbound; occupation and epoch changes are journaled |
| D08 | Move a containing folder with saved and offline-added references | Known saved references update transactionally; stale drafts require review; ambiguous/unproven mapping is never guessed |
| D09 | Restore old board history/trash after rename/path reuse | Old context is not stamped current; binding review precedes live resolution |
| D10 | Interrupt rename/delete/reference-state journal before/after durable decision, each destination write, cleanup and ACK; inject ENOSPC/write/fsync failures | Consistent epoch/ledger/files/boards; no rollback of acknowledged operations; operation-budget failure occurs before mutation |
| D11 | Same-origin switch to another vault, or restore older backup metadata | New context established before reads/uploads; old draft is quarantined; restore generation is rotated |
| D12 | Failed IDB/quota write, blob write, upload, or hash verification | No false Saved/Ready offline state; dirty state retained; recovery completeness verified; missing dependencies reported explicitly; no false complete-package claim |
| D13 | Remove image -> save -> undo; history/trash restoration | Required bytes still exist; no first-release garbage collection |
| D14 | Review cancel or failed recovery snapshot before structural replacement | Draft and pending dependencies remain untouched; no undo reset or scene replacement occurs |
| D15 | Missing media or unbound card on import/export | Visible placeholder and fidelity entry, preserved source, no blank omission or unsafe auto-binding |
| D16 | Generic overwrite/move/delete/import targeting managed asset subtree or its ancestor | Backend rejects operation before mutation; dedicated immutable upload remains idempotent |
| D17 | Foreign scene includes internal-looking metadata and remote embeds/images/font/library links | Zero note-body reads based on unbound metadata and zero unexpected external requests before explicit allowed action |
| D18 | Malformed schema, duplicate IDs, invalid geometry, oversized JSON/pixels, bad MIME/hash, unsafe archive path | Bounded rejection before committing active data; no partial board or silent truncation |
| D19 | Full paused backup -> restore to another directory | Boards, assets, history/trash and metadata verify; reference context refresh is explicit; previous destination preserved on failure |
| D20 | Unscoped legacy dirty browser cache during cache-schema upgrade | Recoverable quarantine remains available; old content is not silently assigned to another workspace |
| D21 | Logout offline with new-image outbox and quarantined dirty work; cancel recovery/discard | Cookies, drafts, blobs and quarantine remain intact; no private-store cleanup before explicit resolution |
| D22 | Open a card's note, then rename/delete/reuse the target path before saving the editor, including identical replacement bytes | Guarded target write rejects stale context; matching content hash alone cannot authorize rebinding |
| D23 | Recovery while old server image bytes are uncached or evicted | Complete export is not claimed; incomplete manifest lists missing dependencies, locally unique bytes are preserved, destructive reset requires resolved prerequisites/explicit disclosed choice |
| D24 | One pathological freehand array, huge text run, deeply nested/large customData, duplicate copied boardId | Enforce ratified complexity limits and identity uniqueness before engine hydration or scoped-cache assignment |

D tests are release-blocking. The current 46-test suite remains a baseline, updated only where deliberately changed contracts are documented; preserve existing file, authentication, language, import and recovery coverage.

## 3. UX, accessibility, and languages

P0 must ratify a supported browser/device/assistive-technology matrix with version floors and a reproducible primary desktop, Android touch, iOS/Safari, and screen-reader baseline. All core host keyboard/focus/undo and claimed touch workflows must pass on advertised targets. A core failure on such a target blocks release; writing it in a limitations list is not a waiver. Narrowing the support matrix requires an explicit product/reviewer decision before claiming support.

- Keyboard-only users can add a reference, select elements through a labeled list, open/edit a note, duplicate/remove/nudge/resize a card, and access its properties without dragging. Host action targets should be at least 44 CSS pixels on touch layouts.
- Delete in a text field cannot remove a card or file. Ctrl/Cmd+Z acts on the focused document. Escape exits the nearest interaction. Closing a picker/editor/modal returns focus to the initiating control or a predictable selected-card list item.
- At 390×844, toolbar, picker and saved-state information remain usable without horizontal document scrolling. Test Android touch and iOS/Safari on actual devices separately from viewport-resize automation. Screen-reader review uses a recorded NVDA/VoiceOver/browser configuration. Record failures honestly and enforce the supported-target release bar; do not claim an accessibility conformance level without evidence.
- English and pt-BR cover host controls, dialogs, statuses, review/fidelity reports and accessibility names, and map correctly to the pinned editor's locale identifiers. Switching preserves note content, files, editor text/undo and scene history.
- Clearly label server-saved, device-only, pending images, reference review, conflict, and cache failure. `Ready offline` requires verified dependencies, not a successful shell cache or navigator.online.
- Missing/stale cards offer review/rebind/open-recovery actions. Ordinary arrows are visual; graph containment and later explicit note relationships show distinct provenance.

## 4. Performance measurements

Ratify the hardware and budgets during P0 before treating them as release criteria. Until then these are proposed targets, not measured claims. Record CPU/RAM/device model, OS, browser/version, viewport, cold/warm cache, connection, fixture bytes and element counts. Use a reproducible desktop baseline and a physical lower-memory mobile baseline.

| Fixture | Native shapes | Note cards | Images | Purpose |
| --- | --- | --- | --- | --- |
| Small | 100 | 10 | 5 | Routine operation |
| Normal | 500 | 50 | 20 | Candidate supported workload |
| Stress | 2,000 | 200 | 100 | Diagnose limits; not an advertised promise |

All fixtures must satisfy the board, asset and decoded-pixel limits. Asset count alone is not a memory budget. Pan across more cards than the active-preview cap.

Candidate normal-fixture targets: warm-open p95 no more than 3 seconds desktop / 5 seconds mobile; input-to-visible-feedback p95 no more than 100 / 200 ms; no sustained pan below 30 / 20 fps. Define the duration/sampling method before measuring. Measure cold engine/font download separately rather than hiding it in a warm metric.

Also record initial and incremental transferred bytes, peak heap/decode/export memory, number and size of preview fetches, active preview count, IDB usage/quota failures, save counts and export latency. A scene with no persistent changes sends zero saves. Candidate export budget: at most 16 million output pixels and bounded asset/content snapshots; settle exact memory and time limits experimentally.

Failure requires a documented change of supported limits/UX/implementation and reviewer reapproval. Do not quietly weaken a budget to mark a test green.

## 5. Import/export acceptance

- `.board` save/reopen/bundle roundtrip preserves supported scene, asset bytes/IDs, bindings and safe extension fields. Cross-vault restore/import still requires re-binding under its context rules.
- `.canvas` conversion is a new file, retains the original, and maps supported text/file/link/group cards and connectors. Unknown fields or unsupported media appear in the report and a preserved source artifact.
- Native `.excalidraw` images import before board commit. Native export hydrates its own portable images and uses explicit static host-card projections.
- Test native Excalidraw opening the exported projection. Snapshot text is intentionally static. A return trip does not promise restored live NoteSprig bindings or full Markdown fidelity.
- Export captures a stable scene plus exact source revisions (including any explicitly chosen local drafts). Do not read mutable latest content repeatedly while composing the result. Missing/review-required references are placeholders until resolved.
- Export reports are accessible and localized. Share projections omit hidden Markdown sources, freshness tokens, and private live path metadata by default. Private native transfer/recovery bundles explicitly disclose and preserve required reference paths/context, with guarded reimport. Incomplete emergency packages cannot satisfy complete native-roundtrip checks.

## 6. Existing-code change map

| Area | Existing locations | Planned responsibility |
| --- | --- | --- |
| Workspace/doc kinds | `src/App.tsx`, `src/types.ts`, `src/api.ts`, `src/knowledge.ts` | Registry-aware dispatch, tabs, restoration, conflict-copy suffix, graph provenance |
| Editing surface | `src/components/CanvasView.tsx`, new board adapter/controller/preview components | Preserve legacy renderer; new single-engine board and safe host actions |
| Drafts and cache | `src/useDocuments.ts`, `src/storage.ts`, `src/legacy.ts` | Identity gate, scoped cache migration/quarantine, transactional blobs/outbox, typed save states |
| Vault and API | `server/vault.mjs`, `server/index.mjs`, new schemas/asset/reference services | Kind policies, conditional board commit, guarded target reads, protected assets, structural journal |
| Recovery | `src/components/Recovery.tsx`, server history/trash paths | Binding-aware history and restore, complete recovery export |
| Files and composition | `src/components/FileTree.tsx`, `src/components/ComposerModal.tsx`, rename/merge/import code | Protected subtree, generic kind support, reference invalidation and updates |
| PWA | `scripts/build-pwa.mjs`, `scripts/service-worker.js`, `src/main.tsx` | Minimal shell vs feature resources; dependency-aware readiness and upgrade |
| Backups | `scripts/backup.mjs`, `scripts/backup-vps.sh`, Docker/deploy docs | Complete asset/reference metadata, restore-generation rotation and manifest verification |
| Languages and legal | `src/locales/`, `scripts/check-i18n.mjs`, `scripts/third-party-notices.mjs`, license bundle | Two languages; nested copied font/asset notices and deterministic inventory |
| Validation | `tests/`, `.github/workflows/ci.yml`, Dockerfile/Compose | Regression/fault/production tests, fixture-only artifacts, reproducible image validation |

Proposed new module boundaries: shared document-kind/schema policy; server reference-state and managed-asset service; client board serialization/adapter/controller; scoped draft/outbox repository; bounded note-preview service; import/export projection adapters. Final filenames may vary; ownership boundaries and contracts must remain explicit.

## 7. Release evidence and stop conditions

A first-release candidate needs:

1. Passing P0 experiments and a recorded schema/limits/engine compatibility decision.
2. Passing automated integrity, migration, import/export, auth/CSP, English/pt-BR and offline scenarios, plus the regression baseline.
3. Passing core workflows on the ratified supported-target matrix, with recorded physical-device and screen-reader results; explicitly unclaimed environments and non-core restrictions stated publicly.
4. Passing production Docker build/runtime test and a complete encrypted backup/restore exercise.
5. Source/asset license inventory, no unintended external requests, synthetic public screenshots and secret scanning of the selected release tree.
6. Opt-in dogfood on copied representative vaults and a tested recovery/rollback procedure.

Any silent data loss, false durable-save acknowledgement, wrong-target binding, uncontrolled external fetch, broken undo ownership, bypassable wrapper persistence, or missing required dependency blocks release. The local feature flag stays off until the evidence exists. Plan consensus does not waive any gate.
