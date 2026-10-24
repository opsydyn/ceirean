# Local Effect Durable Object Probe

Private compatibility probe, not a production service. Alchemy 2.0.0-beta.83
runs an Effect-native Worker and SQLite-backed DO in local workerd.
Qualified locally on macOS ARM64; Linux/hosted execution is not established here.

```sh
moon run cloudflare-ledger:test
moon run cloudflare-ledger:typecheck
```

The test runner creates an owned temporary working directory and home, strips
inherited environment variables, disables telemetry and supplies no credentials.
Alchemy's test harness runs with `dev: true`; the only resource is the local
Worker and its DO binding. The endpoint binds loopback. Do not run this stack
with `alchemy deploy`, add remote resources or import the operational tunnel
stack. Test-only fault/corruption routes are not production endpoints.

The existing pure ledger policy decides transitions. The probe stores a
canonical snapshot and committed event records in one synchronous SQLite
transaction and validates them by replay before accepting further work. This
is not the native adapter's filesystem ownership or WAL protocol.

`skipLibCheck` applies only to this private probe, as approved for the installed
Alchemy declarations. Our source remains strict; no lint rules are disabled.

Local evidence does not establish distributed failover, production durability,
container isolation or end-to-end repair execution.

The suite also runs 150 generated command sequences and two separate runtime
generations against the same persisted namespace. The Seed phase closes runtime
scopes but retains deployment metadata; Verify checks recovery and then destroys
the local deployment. Deleting metadata between generations would create a new
namespace instead of testing recovery.

The parent supervises intentional startup/assertion-failure fixtures and checks
that all recorded child processes are gone after every generation. Their expected
nonzero exits are not suite failures. A compile-only negative test ensures the
stack refuses non-local mode before resource assembly.

The response-loss scenario discards the response body without interpreting it;
it is an application-level lost acknowledgement, not simulated packet loss.
See [the measured assessment](../../docs/assessments/local-effect-do.md).
