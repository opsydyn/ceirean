# Disabled Single-Use Operator Command

**Goal:** Prepare a fixed-target operator command, disabled by default, with sanitized output and one deadline enclosing its complete runtime lifetime.

**Architecture:** An exact-argument/config gate precedes a lazy single-use operation. The operation validates the desired policy, constructs the existing patched runtime in temporary storage, invokes only readiness/status RPCs and disposes it. The command suppresses upstream logs, validates allowlisted output and applies a 45-second cooperative deadline outside runtime provisioning. The application probe retains its 15-second sub-budget.

**Spec:** approved next slice in `docs/runbooks/private-operator-probe.md`.

## Boundaries

- No real preview, credentials, deployment, routes, webhooks, container or hosted activation during implementation/testing.
- `CEIREAN_OPERATOR_PREVIEW=approved` is an accidental-invocation guard, not human authorization. Do not set it in persistent config or use it with the real operation now.
- Tests may pass that guard only to injected synthetic operations. Child-process tests must stay disabled or reject arguments before the live operation.
- Preserve the pinned dependencies, universal Effect rules, expired hosted policy, consumed session and unrelated observer research.
- Deadline cancellation is cooperative and joins finalizers, not a hard process kill or provider rollback/token revocation guarantee.

## Tasks

- [x] Test the argument/default-disabled guard, single invocation, fixed failures, strict output schema and credential/log non-disclosure first.
- [x] Implement the lazy fixed-target runtime boundary, strict policy validation, temporary runtime state and command/main entrypoint.
- [x] Test deadline during runtime construction and RPC work, failure and disposal, plus real disabled CLI process output. No live provider calls. Verify real local workerd stdout/stderr suppression too.
- [x] Update runbooks, verify full infrastructure tests/all typechecks/lint/format and obtain independent review. Commit only this verified slice.

## Execution Record

Baseline: all 12 workspace typechecks and root lint/format passed. Existing observer research remained untouched.

RED: five command assertions failed against an empty implementation (default-disabled, argument rejection, observation, failure redaction and strict output). The real CLI process also failed the disabled/usage contract against an empty entrypoint. GREEN: the command gate, fixed report/refusal schema, overall deadline and main writer passed those cases. A 100-case non-approved-guard property reported Passed.

Native output investigation found the pinned SDK forwards workerd stdout/stderr directly, outside Effect logging. A real local Worker emitted output canaries and a captured subprocess reproduced the leak. The operator's Runtime wrapper now supplies a discard sink before SDK forwarding; both native streams are verified absent after the fix. No suppression or platform-rule exception was added.

Lifecycle tests cover runtime construction, probe work, failure, successive invocation scopes and disposal. A deadline during delayed finalization waits for cleanup and then emits TimedOut; it is deliberately not represented as a hard process deadline. Desired-policy validation occurs before runtime construction, with the documented limit after local file reading.

Initial whole-slice verification: 92 infrastructure Bun tests, nine Node acquisition tests, all 12 typechecks, root lint/format and whitespace checks passed. No real preview, Cloudflare credential/file access, hosted operation or persistent guard change occurred. Independent review and commit follow.

Independent review identified an important native configuration-dump bypass: the SDK reads WORKERD_DUMP_CONFIG and can persist a local bearer token before output suppression. A synthetic counter regression was observed RED (operation ran) and GREEN after refusing the setting through Effect Config before policy/token/runtime work. The result remains only InvalidConfiguration, never the dump path. No provider patch or lint exception was needed. Final gates follow after this fix.

Remaining evidence limits: parent Bun dotenv loading is invocation-dependent, policy size validation follows reading, cancellation is cooperative, and no real preview/hosted readiness or token-revocation behavior is verified. Separate Effect-log canaries during synthetic layer acquisition/finalization are additional coverage, not evidence of a known output defect; the boundary suppresses logs across the entire operation and actual native stream suppression is tested.

Final gates after the review fix: 93 infrastructure Bun tests across 17 files (274 assertions) and the nine-test Node prerequisite passed, all 12 workspace typechecks passed, root lint/format and whitespace checks passed. The review's important configuration-dump finding is fixed and regression-tested RED/GREEN. No lint rules or dependency versions changed. The guarded real operation was never invoked, no live guard was persisted, and no credential files, deployment state, cloud resource, webhook or route was accessed or changed. Existing observer research stays unstaged.
