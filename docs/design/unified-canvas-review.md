# Unified Canvas review record

Status: written draft v2 approved by all three independent reviewers after three rounds. Design approval only; prototype and release gates remain unexecuted. This record concerns the implementation plan, not validation of a finished feature. See the [plan](unified-canvas.md) and [acceptance gates](unified-canvas-validation.md).

## Method

Three independently tasked agents reviewed architecture/integration, persistence/security/offline behavior, and product/accessibility/QA. The coordinator inspected the repository and consolidated their findings. Reviewers were asked to identify blockers and contradictions, not to approve a predetermined answer. Acceptance requires no unresolved plan-level P0/P1 ambiguity and explicit retention of unexecuted prototype/release gates.

## Round 1 — independent investigation and design corrections

| Finding | Resolution in the written draft |
| --- | --- |
| Two independent canvas engines would duplicate geometry, selection, and undo | One official Excalidraw engine, with supported host embeddables |
| Official custom React rendering does not prove full native parity | P0 gates for activation, transforms, clipping, stacking, focus/touch, and export |
| Native image serialization may omit bytes and deleted objects | Explicit `.board` envelope and external immutable assets; no first-release GC |
| Current file lifecycle is hardcoded to existing suffixes | Document-kind registry/change map covers every lifecycle path |
| A board hash does not protect identity of an offline-added target after path reuse | Guarded reference reads/open/save/export, transactional epoch/occupation state, explicit review |
| Pre-rename undo can restore old target paths | Recovery copy before authoritative replacement; explicit structural board-history boundary |
| Arbitrary live Markdown widgets are too broad for an initial passive card | Bounded sanitized excerpts; existing pane for editing; rich interactive widgets deferred |
| Root note references could drift from copied metadata/indexes | Canonical reference metadata lives only in scene elements; indexes are derived |
| Same-origin vault replacement can cross-contaminate drafts | Vault and restore-generation scoping; identity check before cache hydration/upload; quarantine |
| Lazy import does not prevent the current SW from precaching all drawing resources | Minimal shell and versioned on-demand feature/font cache with truthful readiness |
| Upstream offscreen embeds may remain mounted | Bounded memoized previews, request dedup/cancellation, visibility activation and traverse-many-cards test |
| Custom JSX is not automatically part of native image export | Separate bounded snapshot projection, fidelity report and explicit placeholders |
| Native menus/shortcuts could bypass the persistence wrapper | Host-controlled load/save/export and focus-aware shortcut gate |

The persistence reviewer reproduced the board-hash/path-reuse case with a disposable synthetic vault. The coordinator independently repeated it with an empty Project.canvas, A.md -> B.md rename, a different new A.md, and an offline-style card update under the unchanged board hash. Both temporary vaults were removed; no personal vault was used. This is evidence for the proposed reference guard, not a claim that the new guard is implemented.

### Deliberate tradeoffs

- Path references plus conservative global review are accepted as a smaller first-release design than a vault-wide note-identity migration. A matching path is never enough to prove identity. Unrelated structural changes may still require review; measure and disclose that cost.
- In-card editing and live Bases widgets are deferred. Notes remain live through safe previews and explicit Open/Edit in the existing pane.
- `.board` is an honest native application format. `.excalidraw` output is a portable static projection with explicit fidelity limits.
- Asset garbage collection is deferred to preserve history, undo, drafts and trash safely.

## Round 2 — written draft review

All three reviewers read the actual v1 plan and acceptance document and requested changes before approval.

| Reviewer / finding | Correction in v2 |
| --- | --- |
| Architecture: `BinaryFileData` requires `dataURL`, not a cast Blob URL | Public-API dataURL hydration, separate host object URLs, base64/decode-memory measurement |
| Architecture: `validateEmbeddable` receives a URL only | Derived marker recognition map, independent renderer metadata checks, safe eligibility for stale/missing cards |
| Architecture: point/text/metadata complexity can exceed element-count assumptions | Explicit per-element and aggregate budgets before hydration/export; adversarial fixture |
| Product: private native recovery conflicts with share-export privacy wording | Separate disclosed private native bundles from metadata-stripped sharing projections |
| Product/data: uncached old assets make universal complete-recovery promises false | Verified complete vs explicitly incomplete manifests, preservation and reset prerequisites |
| Product: unconditional rotation gate conflicts with permitted compatibility restrictions | Essential geometry remains mandatory; rotation/clipping restrictions require an explicit tested matrix |
| Product: recording manual failures could waive claimed core support | Ratified browser/device/assistive-tech matrix; core failures on claimed targets block release |
| Data: logout only checked current work | Preflight across drafts, blobs/outbox, other scopes and quarantine before session invalidation/cleanup |
| Data: journal cleanup is not a durable transaction decision | Explicit commit/recovery/ACK boundary, fsync requirements, fault injection and staged transaction budgets |
| Coordinator: guarded opening could still leave subsequent editor writes unguarded | Context accompanies card-originated note writes and all scoped mutation routes |
| Coordinator: native paste/drop can bypass host validation | Wrapper-controlled ingress with restriction/failure gate |
| Coordinator: old feature chunks may disappear after deployment | Bounded asset-version policy and recovery-preserving controlled upgrade, rather than indefinite retention promises |

No reviewer was asked to waive an objection for consensus. The prototype and release evidence remain unexecuted.

## Round 3 — corrected written-draft re-review

All three reviewers re-read the actual corrected documents and returned **APPROVE PLAN**, with no remaining plan-level P0/P1 objection in their scope.

| Independent reviewer | Final verdict | Explicit boundary |
| --- | --- | --- |
| Architecture/integration | APPROVE PLAN | Supported-API behavior, projection fidelity, CSP/fonts, memory and performance still need P0 evidence |
| Persistence/security/offline | APPROVE PLAN | Fault injection, restore/quota/offline cases still need execution; a post-COMMIT error must hold the read/mutation barrier until roll-forward completes |
| Product/UX/accessibility/QA | APPROVE PLAN | Core workflows must pass the claimed support matrix; device/screen-reader and measured performance gates cannot be waived |

The coordinator accepted the same bounded design and made the fail-closed interpretation explicit in the transaction section. This is a clarification of the approved barrier contract, not a claim that the current queue already implements it.

## Consensus and execution status

The review reached unanimous **plan** approval. No unresolved critical/important design objection was found in the final review. Unanimity is scoped to these reviewers and this version, not a guarantee that implementation will uncover no additional issues.

P0 implementation, benchmarks, automated feature tests, and manual accessibility/device tests have not been performed. Existing application checks are not evidence that a proposed new renderer works.


## Documentation validation

The local documentation check verifies linked files/images and excludes machine-specific home paths. Runtime dependencies and application code were not changed by this planning task. No new drawing-engine integration test or performance result is claimed. The pre-existing application test baseline remains separate from this design review.
