# Local Effect Durable Object Probe

Private compatibility probe, not a production service. Alchemy 2.0.0-beta.83
runs an Effect-native Worker and SQLite-backed DO in local workerd.

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
