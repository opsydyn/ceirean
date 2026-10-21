# Task 6 Incremental Behavioral Evidence

All commands below ran in /private/tmp/leviathan-compatibility with
`env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR"` prepended.
These are focused development results, not the final full gate block.
No pre-change baseline was rerun.

## Config And Argv

RED command:
`bun --no-env-file --no-install test apps/github-ingress/tests/config.test.ts`

After dependency linking and module scaffolding, both real behavioral tests
failed against parsers returning Result.fail('NotImplemented'):
`0 pass / 2 fail`, with `error: NotImplemented` at each successful-decode
assertion. Earlier missing-module/dependency errors were setup failures, not
counted as behavioral RED.

GREEN, same command after schema/argv implementation:
`2 pass / 0 fail / 26 expect() calls`.

A subsequent inherited-property argv case was RED:
`['start', '--config', '/a', 'toString', 'ignored']` was incorrectly accepted;
`Expected: true / Received: false` at Result.isFailure. Fixed by requiring
Object.hasOwn on the documented flag-name table. Focused re-verification pending
at this progress checkpoint.

## Listener Limits

RED command:
`bun --no-env-file --no-install test apps/github-ingress/tests/listener.test.ts --test-name-pattern 'fifth|rolling|eight'`

Against a 501 stub, all three tests failed behaviorally:
fifth request expected 429, received 501; accepted rate-window request expected
200, received 501; deadline ownership expected non-aborted signal, received
undefined. `0 pass / 3 fail / 1 filtered out`.

GREEN command:
`bun --no-env-file --no-install test apps/github-ingress/tests/listener.test.ts`

`4 pass / 0 fail / 75 expect() calls`, including actual ephemeral loopback.
The sandbox refused the native bind; the exact command passed with escalation.

## CLI State Commands

RED command:
`bun --no-env-file --no-install test apps/github-ingress/tests/cli.test.ts`

Real init expected `{ _tag: 'Initialized' }`, stub returned
`{ _tag: 'NotImplemented' }`: `0 pass / 1 fail`.

GREEN, same command after acquisition/composition implementation:
`1 pass / 0 fail / 7 expect() calls`. Real init/status/configure operated with
nonexistent key/secret files. Revision checks and file permissions were asserted.

## Public Projection And Main

RED command:
`bun --no-env-file --no-install test apps/github-ingress/tests/restart.test.ts --test-name-pattern 'local refusal|main forces'`

`0 pass / 2 fail`: recorded local refusal expected disposition Rejected,
received Recorded; the child expected NativePending, received MainReturned
from the entrypoint stub. Those tests preceded their fixes.

GREEN shutdown command, using the task's specified 30000ms test budget:
`bun --no-env-file --no-install test --timeout 30000 apps/github-ingress/tests/restart.test.ts --test-name-pattern 'main forces'`

`1 pass / 0 fail / 17 expect() calls`, 10.72s overall. Actual child received
SIGTERM while injected abort-ignoring HTTP remained pending. It exited 1 at the
ten-second main deadline with only `{"_tag":"FailedShutdown"}` on stderr.
Separate status showed zero decisions/receipts/evidence; the same ledger then
reopened for a fresh successful synthetic admission. An earlier focused command
without the explicit timeout hit Bun's default 5000ms harness budget; that
failure is retained here and was not a production shutdown result.

## Body Ownership Regression

The slow-body test failed at the specified 30000ms harness deadline: the finite
503 response arrived but underlying stream cancellation was never observed.
Diagnostic phase output showed `stream.locked=true, request.bodyUsed=false`.
The listener had made a second Request from the original input, leaving the
original body's real ownership behind a Bun Request relay. The explicit
AbortSignal already reaches captureRequestBody, so the unnecessary Request
copy was removed; the original request now goes directly to the bridge.

GREEN command:
`bun --no-env-file --no-install test --timeout 30000 apps/github-ingress/tests/restart.test.ts --test-name-pattern 'slow body'`

`1 pass / 0 fail / 5 expect() calls`, 243ms overall. Diagnostic phases observed
bodyUsed=true, finite deadline response, cancellation, deferred cleanup release,
then disposal completion. Diagnostics will be removed before final gates.

## Other Focused Qualification

Signed admission, restart replay/conflict while fake HTTP is unavailable, and
credential-mode refusal were added as qualification tests against the existing
composed behavior and passed immediately. These are not claimed as RED cycles.

Two-second attempt and six-second total-authority tests use Bun controlled
timers plus explicit deferred HTTP phases. They passed in the run where the
slow-body ownership regression failed: `2 pass / 1 fail`. No HTTP retries or
detached decisions were observed after controlled native release.

## Remaining Work

Additional cancellation/storage/path/import checks, removal of diagnostics,
focused rechecks, self-review, final sequential full gate block, integrity
checks, final report and verified local commit remain pending. No reviewer or
agent was dispatched. No live GitHub/API/credentials/tunnel/push/merge was used.

## Subsequent RED/GREEN And Final Source Freeze

The synchronous-handler regression was RED: listener.fetch rejected with the
native CliError rather than producing a sanitized response. After capturing the
synchronous invocation with Result.try, the focused command passed. The same
focused run rechecked the inherited-property argv regression: 3 pass, 0 fail,
29 assertions (synchronous failure plus config/argv tests).

Final inspection found unconditional cwd exclusion incorrectly classified HOME
as a repository. The native host factory was exported for direct qualification
without a runtime/server side effect. RED command:
`bun --no-env-file --no-install test apps/github-ingress/tests/cli.test.ts --test-name-pattern 'native host'`
expected repositoryRoots=[] and received [test-owned cwd]. GREEN after checking
the cwd .git marker: 1 pass, 0 fail, 5 assertions. Parent repository markers
remain the storage adapter's responsibility. The check does not claim discovery
of arbitrary external repositories or build roots.

The first final-gate attempt is preserved in pre-host-fix/. It passed install,
check, six typechecks, domain (211) and engine (300), but was stopped before
dependent suites because host source changed during inspection. It is NOT used
as final changed-source qualification. The full block will restart sequentially.

Frozen staged application tree: 712a7c1eaf007a39e2dfb4321ea69529c7b1393b.
Staged source root before report/evidence additions:
0493af59dfb94b6cc64fab87572e3aa65db6c929.

## Final Qualification

All remaining work described above was subsequently completed for that frozen
application tree. Final sequential gates: install/check, six typechecks, six
suites (903 passing, zero failing), unstaged/staged diff checks and integrity
audit. See 01-20 evidence artifacts and the final task-6-report.md. No further
application source edits occurred during that final qualification block.
