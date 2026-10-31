# Current Linux CI Preparation: Local Evidence

Date: 31 October 2026. Scope: approved local implementation only. No source push,
upload, acquisition, Docker/VM run, CI dispatch, image build, provider call or
hosted activation occurred. Read-only upstream action/checksum metadata was
consulted; the controller checksum remains unverified. Existing observer
experiments and registrations were preserved, unstaged.

## Implementation

| Task                                                               | Commit    |
| ------------------------------------------------------------------ | --------- |
| Portable descriptors and fresh filesystem authority                | `2d7d5a3` |
| Worker seed retention and owned phase cleanup                      | `098b245` |
| Fixed CI inputs, controller, native candidate and archive readback | `26721eb` |
| Inactive manual workflow, worksheet, runbook and maps              | `4a60786` |

The 909-artifact fixture retains SHA-256
`940aa23f265976b010a49411e4db462b4900ade09ecdda0994a1d585a35435ed`.
The source, tree, lock and npm snapshot pins are unchanged. Actual local Git-blob
staging reproduced all 2,107 files and the original source inventory hash without
source tar extraction or repository execution.

## Final Verification

- Complete tracked executor Bun suite plus new ownership regressions: **762 passed,
  0 failed**, 72 files, 30,465 assertions. Optional fixed-source tests were enabled.
- All **12 Moon typechecks** passed.
- Root oxlint with warnings denied and oxfmt check passed; no Effect rule exception.
- Dedicated Moon CI task: **16 passed, 0 failed**, including the newly registered
  ownership regressions and fixed-source staging.
- Diff whitespace checks passed.

Logs: `/private/tmp/ceirean-ci-final-tests.log`,
`/private/tmp/ceirean-ci-final-types.log`,
`/private/tmp/ceirean-ci-final-check.log`. The failing ownership reproductions are
in `/private/tmp/ceirean-ci-review-red.log`.

## Independent Review And Fix Pass

One fresh-context reviewer inspected `9c7ae74..4a60786` and found two important
cleanup defects. No additional blocker was identified in cache authority,
portable links/modes, fixed input layout or worker bundle placement.

1. Interrupted Docker creation could return an empty listing before late daemon
   creation, yet cleanup reported success. The regression first failed, then
   passed for volume, stager and consumer creation. Requests are now recorded
   before dispatch, settled only on successful acknowledgement and retained as
   unknown after interruption/nonzero exit. Observed owned objects can be removed;
   absent listings do not resolve a pending request.
2. A failed removal deleted scratch/ownership, so a subsequent cleanup silently
   passed. Its regression failed first and now passes: failed removal retains
   root and authority, and subsequent cleanup still performs removal/readback.

A related third regression also failed first: creation of a private directory
followed by failed identity capture must not become no-op successful cleanup.
An unresolved directory claim now refuses deletion and confirmation. All three
regressions pass using fake filesystem/process services; no real Docker call ran.
The single implementer fix pass was verified by the complete suite, not a second
independent review.

## Rulings And Retained Limits

- A fresh CI receipt describes its own downloads, not the original Mac receipt;
  durable inventory data never restores WeakMap authority. Incorrect custody
  claims would invalidate later evidence, so fresh filesystem admission is required.
- A reserved case copy is promoted only through its verified live handle;
  ordinary root reservations are unchanged. Incorrect promotion refuses or
  invalidates cache authority rather than bypassing reservations.
- Keep the general input reader at 2 MiB; use inode-checked cache reading for
  the separately bounded 64-MiB descriptor. A wrong bound causes refusal.
- Preserve actual tar modes instead of using its mode-changing portable option;
  UID/GID archive fields are inert and never restored. Independent archive
  readback refuses content, link or mode drift.
- The exact inventory is formatter-exempt data; all source lint rules remain
  universal. Byte drift fails the compiled inventory hash.
- Native worker ordering, Docker transport/isolation/runtime compatibility and
  Linux install success remain unqualified. Fakes do not authorize execution;
  actual incompatibility may still cause the future bounded run to fail.
- Operational entry/outcome persistence, controller checksum, unified acquisition
  timing and aggregate artifact acceptance remain explicit publication blockers.
  The draft always refuses, including when placeholder pins are replaced.
- Remote source/implementation identity and artifact-service retention were not
  tested because nothing was published/uploaded. Local success is not remote proof.
- Ambiguous acquisition or incomplete identity capture keeps cleanup unknown and
  retains authority/scratch. This can require manual reconciliation; no automatic
  retry or speculative deletion is authorized.
- Pre-existing observer work is outside this slice and remains unchanged; it is
  not included in the verified commit set or cleanup ownership.

No minor review findings were deferred. The next bounded product step is the
reviewed runnable CI handoff in the [worksheet](../../../qualification/current-linux-cache-run-worksheet.md),
then separate exact-source/workflow publication and one-attempt approvals.
Cloudflare image/baseline execution remains a later gate.
