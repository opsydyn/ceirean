# Local Pinned Manifest Evidence

Source: local Git objects for `opsydyn/fold-kit-experiments`, pinned commit
`1183e3c067f873fdd29f14f06030515929c1b956`. This is local inspection evidence,
not a remote-current or hosted execution claim.

## Observed Artifact

The real replay entrypoint ran with Bun 1.4.2, `--no-env-file` and `--no-install`
against the existing local FoldKit checkout. It exited 0, emitted one validated
JSON line and left stderr empty.

- [Exact stdout artifact](baseline-1183e3c.jsonl), retained without reformatting.
- UTF-8 size including newline: **28997 bytes**.
- SHA-256: `561921809193dbbefb62c063e8ba38cf57b9eede061208731eb74e454de21847`.
- Coverage: **14 manifests**, **224 dependency-section entries**.
- Provenance: `LocalGitObjects`.

The report includes all paths from the approved fixed baseline. Named/default
catalog lookups and literals remain distinguishable. Selected facts:

| Declaration                          | Observed value       |
| ------------------------------------ | -------------------- |
| FoldKit through default catalog      | `0.170.0`            |
| Effect through default catalog       | `4.1.0`              |
| Astro through default catalog        | `7.4.0`              |
| Astro integration FoldKit peer range | `>=0.170.0 <0.171.0` |
| Viz FoldKit peer range               | `>=0.167.0 <0.171.0` |

These are declaration facts, not installed dependency or compatibility results.

## Independent Local Cross-Check

Separate fixed-SHA Git tree/content reads confirmed the root manifest:

- Regular-file mode `100644`.
- Git blob `ca89ff061ccfcd0debad786b5ab939d27ee65b26`.
- Raw-byte SHA-256 `ecf472d5f1ce01c59c2311da8095f5cf7e154c4f108aef44bcb342b442a4160d`.

These match the generated report. Selected root catalog declarations were also
compared with the fixed-SHA source, not a working-tree package manifest.

## Verification

Local verification passed: 233 domain tests, 28 replay tests, all 12 workspace
typechecks, root lint/format and whitespace checks. This is local implementation
evidence, not hosted qualification.

The actual entrypoint regression first emitted valid manifest JSON but exited 1
because its exit-code schema omitted 0. After adding 0, the same subprocess
regression passed. Deadline tests cover acquisition, work and delayed disposal;
uninterruptible cleanup is joined rather than reported as an instant kill.

An independent read-only review confirmed the baseline artifact and found a
decoder issue: refined record-key schemas could silently omit empty/oversized
dependency, engine or catalog keys. The regression failed before the fix and
passed after switching to unfiltered record keys with explicit whole-key
validation. Valid keys at the 4096-character boundary remain present. The
retained valid-baseline report is byte-for-byte unchanged by this correction.

Deferred minor: fake process finalizer tests demonstrate scope cleanup, not
direct native OS-process termination. No production leak was observed. A future
controlled live-child cancellation/overflow test is still useful; this evidence
does not claim that native termination qualification.

## Boundaries

No target dependency install, repository script/import, baseline/browser run,
model-generated command, image build, deployment, route/webhook activation or PR
write occurred. Historical replay and retained observer research are unchanged.
Hosted source retrieval and a hosted report require a separately approved design.
