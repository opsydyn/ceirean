# Offline Colima Readiness Foundation

## Approval And Evidence Boundary

Assessed in `/private/tmp/ceirean-colima-readiness` on 2026-10-23, branch
`codex/colima-readiness-c1`, starting at `0f1b432`. The owner approved the written
[design](../superpowers/specs/2026-10-22-colima-readiness-design.md) on 2026-10-22
and separately approved C1 implementation with subagent execution on 2026-10-23.
This is offline foundation evidence, not permission to run actual host preflight,
activate native diagnostics or execute replay.

C1 delivers private strict report/manifest schemas and pure readiness policy,
bounded host/config readers, sanitized preflight projection and a preflight-only
CLI. There is no Stage 2 executor, production worker/receipt, ledger integration,
replay-blocker mutation or native activation path. Real host resources, installed
clients, daemon/storage/security/network identities and Chromium remain unobserved.
Every preflight report stays `nativeReadiness: Unqualified` and
`canExecuteReplay: false`; its activation draft remains Unresolved.

## Delivered And Reviewed Tasks

| Task                       | Commits            | Evidence and review boundary                                                                                                                                                                                                           |
| -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: contracts/policy        | `0f1b432..76f8ea6` | 14 focused tests; five laws, seeds 0/1/163, 1000 runs per seed/law (15000 primary cases), unchanged budgets; independently approved after clarification that container ceilings are not VM allocation caps.                            |
| 2: host reader             | `76f8ea6..61a28a3` | Ten synthetic tests / 51 assertions, focused types/root check; independently approved with one deferred pre-I/O guard coverage minor.                                                                                                  |
| 3: safe preflight          | `61a28a3..196f55f` | 38 cumulative focused tests / 402 assertions, focused types/root check; independently approved with host acquisition explicitly transferred to Task 4.                                                                                 |
| 4: CLI/acquisition         | `196f55f..2e99143` | Initial `c36b77e` followed by reviewed parser fix `2e99143`; 65 focused tests. Duplicate/conflicting/malformed vm_stat headers/free-page records now stay Unknown. Scoped re-review approved, no open finding.                         |
| 5: deferred guard coverage | `1b59157`          | Twelve table cases for runtime-invalid IDs, relative root/executable/HOME paths and untrusted version parents; finite errors and zero filesystem/spawner calls. 66 focused tests / 525 assertions and focused types/root check passed. |

Guard coverage tests existing rejection behavior, not a new production fix. An
isolated scratch copy with guard validation bypassed failed with `Unexpected
guard I/O`; the real production source was never changed. The restored/actual
reader passes. Directory/FIFO metadata and hostile replacement cases use owned
fixtures/injected platform services, not claims of hostile-tree or native FIFO
safety. Synthetic process timeout/cancellation waits for owned child exit; that
is not Colima/container/volume cleanup qualification.

The retained raw evidence is in
`.superpowers/sdd/2026-10-22-colima-readiness/`: task briefs/reports/reviews,
ledger `progress.md`, RED/GREEN logs and restricted `run.sh`. Task 5 focus logs
are `task-5-guards-red.log`, `task-5-guards-green.log`,
`task-5-focused-final.log` and `task-5-check.log`. Initial outer-sandbox rejection
and the initial lint failure are retained; the final harness checks passed with
no rule exceptions. A first isolated-copy negative-control attempt lacked a
workspace dependency link; only the subsequent behavioral failure is RED proof.

## Verification Gates

All qualification uses credential-free temporary HOME, empty inherited
environment, explicit PATH, denied real `.env` reads and denied external
network through the existing restricted runner. No dependency installation or
upgrade was performed in Task 5. Owned synthetic loopback sockets are permitted
only for established full-suite fixtures, not operational listeners.

The controller's historical full-gate run covered code at `1b59157`. Results
were checked against retained raw logs:

- `bun --no-env-file run check`: exit 0, zero lint warnings/errors, all files formatted.
- `moon run :typecheck --force --no-actions`: exit 0, all ten workspace tasks,
  5.177s.
- `moon run :test --force --no-actions`: exit 0, all ten workspace test tasks,
  **1227 tests, zero failures**, 4m24.248s. C1 contributes 66 tests.
- Existing migration-storage native refinement law: all 3000 fresh-database cases
  (seeds 0/1/163, 1000 each) in 148083.89ms within the unchanged 180000ms bound.
  This SQLite/ledger test is not native Colima readiness evidence.

Raw logs are `controller-final-check.log`, `controller-final-types.log` and
`controller-final-tests.log` in the retained plan scratch. These gates bind code
head `1b59157` (closure Markdown only through `8a2a4a7`). The authorized final
fixwave below supersedes that code head. New full-gate counts on the stable fix
head are pending the controller; 1227 is historical, not the fixed-head total.
Property seeds/run counts/timeouts were not reduced.

Task 5 review completed. Whole-branch review of `0f1b432..8a2a4a7` returned
With fixes (I1, I2, M1, M2). Fixer self-review is not acceptance; fresh scoped
rereview and controller full gates remain pending. Passing synthetic gates does
not qualify native readiness or authorize merge/push.

## Final Fixwave Contracts

The authorized single fixwave starts at `8a2a4a7`. Manifest decoding now verifies
SHA-256 using Bun's cryptographic hasher over canonical JSON: exclude only the
top-level `manifestDigest`, recursively sort object keys lexically, retain array
order and values, and schema-encode compact JSON as UTF-8 without a newline.
Approval validation and both aggregation entrypoints verify this content binding.
Old digests cannot approve or aggregate changed argv, resource configuration,
destinations or cleanup. Rehashing changed content still requires newly matching
approval and evidence; this is content identity, not operator-authentication proof.

Diagnostic reports require exact approval (`manifestDigest`, `startMs`,
`deadlineMs`) and actual diagnostic `execution` (`startedAtMs`, `completedAtMs`).
Each check and cleanup record carries that approval and its own `observed`
interval. Missing/malformed/reversed records reject; mismatched or out-of-window
observations cannot Pass. The diagnostic interval must preserve the manifest's
cleanup reserve, and activation's complete command budget must fit at its start.
Timely cleanup follows diagnostics and completes no later than the absolute
deadline. Cleanup completing after the deadline must be explicitly `CleanupOnly`,
including an interval crossing the deadline; it remains retained diagnostic
evidence but always prevents overall Pass. No TTL, scheduler or executor is added.

Owned test launchers use the absolute running `process.execPath` and disable
environment-file loading. Production PATH-disabled execution is unchanged.
Only six unused value exports and the unused `CheckId` type export are narrowed;
their implementations, needed types and runtime fixtures remain.

Focused RED/GREEN, types, root-check and report-only scanner evidence are retained
as `final-fix-*` in the same scratch directory. The complete command/results
handoff is `final-fix-report.md`; fresh scoped rereview and fixed-head full gates
are controller-owned, not claimed here. The original five laws retain seeds
0/1/163 and 1000 runs each; two additional provenance laws use the same budgets.
The bounds law rehashes its mutations to test ceilings independently of digest
validation. No full repository test/type suite is rerun by the fixer.

## Post-Fix Controller Verification And Open Review Finding

Controller verification on code head `a2c1287` passed root lint/format, all ten
workspace typechecks and all ten test tasks: **1236 tests, zero failures** in
4m49.151s. The private probe contributes 75 tests / 596 assertions and 21000
primary property cases. Existing native ledger refinement retained 3000 cases,
155003.26ms within the unchanged 180000ms bound. Raw `controller-postfix-*`
logs and explicit successful process exits are retained in the plan scratch.

Whole-branch review covered `0f1b432..8a2a4a7`; scoped fix review covered
`8a2a4a7..a2c1287`. The latter cleared manifest-content binding, interpreter
portability and export narrowing, but **ReadyToMerge remains No**: direct typed
`diagnosticOutcome` accepts fractional execution/check timestamps as Pass even
though the unknown-input summarizer rejects them. Interval ordering checks do
not substitute for safe-integer schema validation at that entrypoint.

This is a real remaining private-contract defect, not a native execution exploit
or a passing acceptance gate. The single final fix wave is exhausted; retain the
counterexample and require a bounded follow-up with execution/check interval
schema guards and direct typed regression tests before merge. No finding was
waived because a C2 executor is absent. These closure notes do not extend the
reviewed code ranges; only Markdown changes follow the measured code head.

## Fallow Report-Only

The existing cached Fallow 3.34.1 native binary ran under the same restricted
runner, both telemetry kill switches, no cache and no type-aware analysis:

```sh
bash .superpowers/sdd/2026-10-22-colima-readiness/run.sh \
  env FALLOW_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 \
  node_modules/.bun/@fallow-cli+darwin-arm64@3.34.1/node_modules/@fallow-cli/darwin-arm64/fallow \
  --no-cache --no-type-aware --format json dead-code
```

Historical raw output: `task-5-fallow.json`; stderr: `task-5-fallow.stderr.log`,
in the plan scratch. **Exit 1: ten findings, nine error-severity and one warning.**
The authorized fixwave rerun is `final-fix-fallow.json` and
`final-fix-fallow.stderr.log`: **exit 1, three findings, two error-severity runtime
fixtures and one retained warning; zero unused exports/types.** Neither run is a
clean Fallow gate. No suppression, policy/config change or installation occurred.
Findings and dispositions:

- Two unused-file findings: `tests/child.ts` and `tests/cli-child.ts` in the probe.
  These are runtime-loaded synthetic process fixtures, referenced by paths/copies
  in tests rather than ordinary import edges; they were exercised by focused tests.
- Six formerly unused value exports in `src/contracts.ts`: `readinessBounds`,
  `Reason`, `DiagnosticIdentity`, `Artifact`, `CheckEvidence`, `CleanupEvidence`,
  plus the unused `CheckId` type export, are now private. Implementations and
  needed type exports are retained; all seven scanner findings are absent on rerun.
- One existing warning for retained `@modelcontextprotocol/sdk` in
  `probes/github-admission/package.json`, preserved for compatibility/security work.

The scan reported no unresolved/unlisted imports, cycles or new dependency
finding. Architecture boundaries/rule packs were not configured and therefore
not measured; zero counts do not qualify them. Scanner findings do not change
the native evidence boundary or authorize cleanup beyond this task's scope.

## Remaining Gates

The [runbook](../runbooks/colima-readiness.md) maps every native check to its C2
prerequisites. Production installed-client candidates deliberately remain
Unsupported: reviewed executable identities and version-aware client-only
semantics are absent. Conservative canonical YAML is a documented acceptance
limitation, not an instruction to alter real config. Parent-directory and
executable trust are composition prerequisites, not properties proved by the CLI.

First close the typed-timing review finding above. After C1 acceptance,
separately authorize host preflight, then plan/review/implement
C2 with exact image/browser, daemon, storage/quota, security, network, resource,
argv/budget and cleanup identities. A further explicit manifest/window approval
is required for activation. No actual host preflight, Colima/Docker client,
daemon, VM/container, Chromium, consumer repository, operational ledger, model,
secret, ingress, registry/download or publication was exercised by this task.
Plan C native readiness and replay acceptance remain incomplete.
