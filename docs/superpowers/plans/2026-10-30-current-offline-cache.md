# Current Offline Cache Composition

Approved slice: acquire the exact 12-archive npm delta and compose offline cache
inputs, reusing the retained 897 archives. Preserve unrelated observer work.
No image build/pull/publication, target scripts, browser, cloud or hosted activation.

1. Derive and validate the union of current fixed-source registry candidates and
   frozen npm profiles. Bind retained input inventory/receipt bytes; reject SRI,
   URL, identity and source substitutions. Test first.
2. In a fresh owned directory, re-read retained bytes, acquire only missing exact
   canonical npm URLs, and compose the complete artifact set plus npm content and
   metadata cache. Re-read every artifact and cache entry, then replay all four
   npm locks offline with the native network guard. Keep budgets unchanged.
3. Obtain an independent read-only review; fix important findings with regression
   tests. Run strict lint/format, all typechecks and tracked executor tests. Record
   actual bytes/digests, update roadmap/runbook and commit only this slice.

Ruling: local composition produces portable registry inputs and npm cache, not a
fabricated Bun-native cache. The configured Docker daemon is unavailable; native
Linux install/warm-up remains separately unqualified. Calling portable input
composition Linux runtime proof would hide a real acceptance gap.

Shared interface: canonical sorted union identities determine new artifact indexes;
source indexes remain bound to the verified retained inventory. Partial output is
owned by this operation and must never remove or overwrite retained inputs.

Preflight: 12 workspace typechecks and strict lint/format passed at `9a8faa1`.

Task 1: complete. Exact union and ownership tests observed RED then GREEN;
300 seeded set-difference properties pass. Fixed-source plan is 897 retained /
12 missing / 909 total. Retained inventory and receipt pins authenticated.

Task 2: complete. Prepared `/private/tmp/ceirean-current-offline-Rg2onJ`, inventory
SHA `940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`.
All 909 archives and content-store copies were re-read; all four npm locks replayed
offline on native Node 24.15.0/npm 10.9.9. No Linux acceptance claim.

Final independent review: one P2 late native mkdir/cleanup race. Fixed by draining
new directory mutations before cleanup; the filesystem-service fixture observed
RED then GREEN. No lint exception/native boundary added; no deferred findings.

Task 3: complete. Final tracked-executor suite passed 695 tests across 60 files,
0 failures and 28,688 assertions. All 12 workspace typechecks and strict lint/
format passed. Roadmap/runbook/evidence distinguish the completed portable
inputs from the remaining Linux-native cache warm-up. Unrelated observer work
remains outside the verified commit.
