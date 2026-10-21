# Local GitHub Ingress Qualification

## Current Candidate

Tasks 1-7 are accepted by the controller. Whole-branch acceptance remains pending
scoped final-fix review and controller verification; no merge or live acceptance
is implied. The original 916-test `b7f5d4e` qualification is historical, not proof
for the changed final-fix source. See the
[final-fix report](../evidence/local-github-ingress/final-fix/final-fix-report.md).
The [manifest](../evidence/local-github-ingress.json) binds actual final-source
gate exits, log hashes, suite/assertion totals and restored behavioral controls.
It keeps the tested source commit/tree separate from later docs/evidence commits.
The [runbook](../runbooks/local-github-ingress.md) is explicitly operator-gated.

Task 7 tests real child SIGKILL at pretransaction, staged decision/evidence,
committed-before-response and pending API phases, then reopens the same ledger
with synthetic credentials. Zero or one complete record, immutable matching
evidence, released ownership and duplicate replay without fresh API checks are
asserted. Late malformed-key and bind-failure cleanup coverage closes Task 6 M1.
An old valid snapshot demonstrably loses replay history; it is not reconciled
into a completeness or exactly-once claim. The report validator is pure schema
and consistency checking, not a filesystem/network measurer or cryptographic
attestation. The evidence tooling measures bytes and Git identities separately.
It cannot promote live or deployed flags; both remain false.

Five controls independently break evidence binding, policy revision comparison,
known-receipt replay, transaction rollback and abort cleanup ownership. Each
qualifying control fails twice for its intended assertion, restores exact source
bytes and passes. Initial replay/abort test selections that did not detect the
mutation are retained as nonqualifying attempts, not counted as RED or law cases.

Canonical historical evidence is archived losslessly under
`docs/evidence/local-github-ingress/`. Its index byte-compares 212 selected
members, including all seven accidentally tracked Task 6 scratch copies, before
index-only relocation. Original scratch files remain available until final review.
Task reports, final-source gate logs, review closures and every ledger ruling
(including cost if wrong) are retained. No future review result is fabricated.

Historical limitations remain: initial Task 5 broad-batch test-first history is
incomplete; later RED/GREEN cannot recreate it. Task 6 TDD material is a summary
with excerpts, distinct from its archived raw gate logs. The final fix preserves
known memory receipt metadata and compares paired fresh reordered histories
using normalized business outcomes. This corrects M2 coverage without asserting
a production ordering defect. The original 24000 new/168000 legacy primary
case budgets and all seeds remain unchanged. Readiness readers now accumulate
bounded newline messages with EOF/byte/deadline handling. Canonical outer archives
are payload-only and completely indexed; the unchanged nested Task 6 archive
retains historical AppleDouble/PAX metadata as an inspected exception. Moon
update advertisements are preserved, not lint warnings or proof of pristine
console output. Frozen installation is not zero-network evidence. No real key,
GitHub API, tunnel, deployed listener or production durability was qualified.

The Task 1 section below preserves its original source-specific findings; its
future-tense statements do not describe the current Task 6 application status.

## Task 1: Authentication And Bun Platform Compatibility

This is local dependency qualification, not permission to start ingress or use
live credentials. The application workspace is deferred to Task 6. No production
adapter module, listener, GitHub request, controller fallback, or credential
discovery is introduced by this task.

The private `@leviathan/github-adapter` workspace directly pins `jose: "6.2.12"`
and `effect: "4.0.5"`, with `@effect/platform-bun: "4.0.5"` as a development
dependency. Root `overrides["@effect/platform-node-shared"] = "4.0.5"` constrains
platform-bun's declared `^4.0.5` dependency. The app must declare platform-bun as
its own dependency when created; this test-only installation is not that app.

### Real Compatibility Checks

`packages/github-adapter/tests/compatibility.test.ts` imports the published
packages directly and runs under Bun, without a replacement crypto implementation
or filesystem mock. Four tests cover:

- Fresh synthetic RSA key generation, PKCS8 export/import, RS256 App-shaped JWT
  signing and verification with literal issuer/timestamps, and wrong-key refusal.
- Rejection of malformed PKCS8 headers and malformed encoded key data.
- Real exclusive file creation, typed `AlreadyExists` on a second open, unchanged
  contents, file/directory permission transitions, and successful scoped cleanup.
- Real test-owned file/directory cleanup after a typed synthetic scope failure.

The filesystem layer is the published Bun implementation. Its internal use of
platform-node-shared is not a Node controller fallback. Test-owned temporary
paths do not qualify production path validation, credential custody, SQLite
ownership, cancellation, HTTP behavior, or live GitHub authorization.

The workspace extends the existing strict tsconfig with `skipLibCheck: false`.
Its explicit uncached Moon tasks disable env-file loading, installation, and
retries. Universal lint configuration, existing cohort pins, and the two approved
declaration patches are unchanged.

### Artifact And Lock Identities

Public npm metadata, downloaded tarball SHA512, shipped exports/peers, lock
integrity, and every installed artifact file were compared for:

| Artifact                             | SHA512 Integrity                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `jose@6.2.12`                        | `sha512-9NiFmJEex0sy2Dk58j2UGBSHgUs2ypF9eZSu4L6vjOX3Dp96Sw1F3uL+H+D1sx02jZZdzUT0HgvCy59CuvXcWw==` |
| `@effect/platform-bun@4.0.5`         | `sha512-tB/GapZ/bVoCbwRgnojGP4TwopvkMoFoSCipXT1sf0guvG/2oRVhWzJW/1vkrYFEdLM7XyRnVVLrSJyqdok7DA==` |
| `@effect/platform-node-shared@4.0.5` | `sha512-a8rCdEkfZBGe9C6bsIjxVZuRp73svIyK5IHwHdDAVsvZXjrbkxusfI+rZ8WlX31RP1mKizwI/E72GQTNfdMWHw==` |

Both platform packages declare peer `effect: "^4.0.5"`; all existing and new
workspaces and both platform packages resolve to the same physical `effect@4.0.5`.
Jose declares no dependencies or peers. No new declaration patch is required.

All 262 baseline lock package entries remain structurally unchanged. Additions
are platform-bun, platform-node-shared, the adapter workspace link, and
`@types/ws@8.18.2`. Node-shared declares `ws: "^8.22.0"` and
`@types/ws: "^8.18.2"`; existing `ws@8.22.0` satisfies the former and is unchanged.
The new type package's `@types/node: "*"` resolves to existing `@types/node@26.6.5`.
There is no unrelated resolution upgrade.

- Baseline source: `4fdf876987668ea61bab1be30e5d04c48f0515e0`.
- Baseline lock SHA256: `a03b2f20874301814ba165f945b3fa55df5f20023f29ba5b873f3d16537cadc3`.
- Qualified lock SHA256: `74b793ca8c86d8dc38cad063675ce8be1f85cafc8241aae979f96a0b31e6f014`.
- Flue patch SHA256: `07d115c8c98bea3c28011afe76e838a89a5126b2f401bad1091af678c008931a`.
- Gaxios patch SHA256: `7ea7b1f29d158ab1595b71f798b71c9c44249ae29567b12dcf6d5d7e35239e3e`.

Exact commands, baseline/RED/GREEN/full-gate output, installed paths, actual test
counts, and the author's self-review are retained locally in
`.superpowers/sdd/2026-10-20-local-github-ingress/task-1-report.md` and its
`task-1-evidence/` directory. The controller owns independent review before any
dependent task. Local compatibility evidence does not approve a live rehearsal.
