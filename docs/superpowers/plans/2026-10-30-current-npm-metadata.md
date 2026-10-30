# Current Generated-Consumer Metadata

Approved scope: freeze the four current npm consumer profiles and prove offline
metadata replay. No target installation/scripts, image build, browser execution,
publication, webhook/route changes or hosted activation.

1. Pin inert projections to the four reviewed source files at `be0427e`.
   Preserve generated common/dataset and packed pure/adapter profiles separately.
   Validate local paths and root dependency maps. Observe failing tests first.
2. Acquire bounded exact-version public npm metadata, without redirects, from
   versions in the current Bun lock and historical npm locks, plus the explicit
   adapter `foldkit@0.169.0`. Run npm 10.9.9 package-lock-only under the existing
   offline network tripwire. Freeze resulting locks and minimal replay metadata.
3. Replay every profile from no lockfile and an independent metadata-only cache;
   fail closed for empty/missing/tampered metadata. Verify lint, all typechecks and
   tracked executor tests. Document evidence and commit only this slice.

Ruling: resolution uses the reviewed frozen version cohort, not moving npm latest
tags. This makes preparation reproducible; it is not a claim about today's
unconstrained npm resolution. Native Linux installation remains unqualified.

Shared interface: locks retain local vendor metadata and exact dependency maps;
replay compares complete normalized lock data, not only artifact counts.

Progress: baseline 12 typechecks and strict lint/format passed before edits.

Task 1: complete. Inert profiles and exact local policy observed RED then GREEN;
object-order regression fixed with schema-derived equivalence. Historical vendor
versions remain restricted by the original wrapper.

Task 2: complete. Retained capture `ceirean-current-npm-qDDNlU` resolved all four
profiles and replayed from a second metadata-only cache. Committed snapshot pin
`afbc49f88b06f39f1b64d321952cb0768e843b7fa57446c78d260f19993d496f`.

Final review: independent reviewer found two P2 issues. Both were reproduced RED:
pending body cancellation held the scope indefinitely; well-formed modified cache
metadata passed when locks were unchanged. Fixed with bounded cancellation plus
nonzero refusal, and cache-byte authentication before/after replay. Both GREEN.
No deferred findings. Full final verification recorded in the evidence file.

Task 3: complete. 669 tracked-executor/current-npm tests passed, 0 failed;
12 workspace typechecks and strict lint/format passed. Native Node replay after
the review fixes matched all four locks and authenticated metadata cache bytes.
Observer-canary/readiness-staging work is intentionally excluded from this slice.
