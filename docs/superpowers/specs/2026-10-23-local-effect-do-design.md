# Local Effect Durable Object Proof

## Intent

Prove Ceirean's existing Effect domain policy can execute against Durable Object
SQLite under the installed Alchemy local runtime. This is a compatibility probe,
not a production controller migration or a working repair executor.

## Approved Direction

Use a separate Alchemy-managed Worker and SQLite-backed Durable Object in local
workerd. Keep Alchemy `2.0.0-beta.83` and Effect `4.0.5` pinned. Do not import the
existing infrastructure stack or change the paused Alchemy upgrade.

Alternatives considered: direct Wrangler/Miniflare would add a second local
orchestration surface; Rivet would introduce another hosting platform. Alchemy
already supplies local workerd and Effect-native Durable Objects, so reuse it.

## Boundaries

- New private probe at `probes/cloudflare-ledger`; no production wiring.
- Reuse `@ceirean/engine/journal-policy` decisions, codecs, bounds and recovery.
- Leave native migration storage, Flue, XState and domain policy unchanged.
- Assemble dependencies at the owning service or exported boundary; no local
  helper provisioning and no lint-rule exceptions.
- No cloud credentials, environment-file loading, telemetry, remote bindings,
  DNS, tunnels, containers, model calls, GitHub mutation or public ingress.
- A temporary loopback-only test endpoint is permitted during the suite. Stop
  all owned processes at completion or failure.
- Audit the isolated resource graph and provider behavior before starting it.
  Fail closed if local execution needs cloud authentication or remote resources.

## Design

One named DO owns one bounded probe ledger. Effect-native RPC accepts and returns
schema-validated JSON encodings so Effect Option/Result values are not assumed to
survive a raw RPC serialization round trip.

SQLite stores a canonical ledger snapshot and its committed event records. A
synchronous transaction reads current state, calls `decideMigrationLedger`, and
persists the next snapshot and event together. Refusals and conflicts must not
advance the sequence or append events. Strict decoding, recovery validation and
existing record/payload bounds apply before acceptance. This probe layout is not
a migration of the native adapter's schema or filesystem ownership protocol.

The DO activation initializes schema only. Authoritative state is read from
SQLite, never an Effect Ref or persisted XState snapshot. Fault injection is
available only in the private probe, with typed failures and no partial commits.

## Acceptance

1. Actual workerd RPC registers a run and applies a valid run/worker transition.
2. Repeated registration and stale revisions produce existing policy outcomes
   without unintended state/event changes.
3. A run cancellation updates associated worker authority atomically.
4. Injected failure between snapshot and event writes rolls back both.
5. Malformed/excess-field/oversized inputs fail without mutation; invalid stored
   data fails closed rather than being silently reset.
6. Bounded generated command sequences match the pure policy after every step.
7. Stop and restart the runtime with the same owned local storage directory;
   recovered state, sequence and event history match the pre-stop state.
8. Tests clean up processes on success and failure; independent tests do not
   share ledger state.

## Evidence Limits

Local workerd proves runtime and SQLite compatibility, not Cloudflare network
placement, distributed failover, production durability or sandbox isolation.
Neither a hot reload nor a new object name proves persistent restart recovery.
If restart or provider isolation cannot be established on the pinned version,
record the blocker rather than upgrade or weaken the claim.
