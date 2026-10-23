# Colima Readiness Preflight

Private, read-only diagnostic foundation. No activation, VM start, Docker daemon
access, download, cleanup command, ledger initialization or config rewrite exists.
The only public invocation is:

```sh
bun run --cwd probes/colima-readiness cli preflight --config /absolute/owned/root/ceirean/colima.yaml
```

The script uses `bun --no-env-file --no-install`; no install/start hooks exist.
There are no command overrides, fixture flags/environment switches, PATH search,
or inherited Docker/Colima context fallbacks. Importing modules performs no work.
Fixture composition is programmatic, never a public capability.

## Input Trust

Config must be exactly `<root>/ceirean/colima.yaml`, absolute. One derived root
binds the reader, inspection request and proposed
`unix://<root>/ceirean/docker.sock` endpoint. Paths use ASCII letters, digits,
underscore, dot and hyphen. Traversal, duplicate separators, and roots longer
than 450 characters are refused.

Selecting a path asserts that its root and parent directories are owner-controlled
and remain stable during inspection. The CLI does not attest that trust.
Final-component no-follow and file snapshot checks are not hostile-tree protection.

YAML is deliberately conservative: only the Task 3 schema (Docker runtime,
mounts, forwarding, positive integer CPU/memory/disk, finite architecture,
autoActivate) is accepted. Absent sharing/forwarding is Unknown. Input must match
Bun YAML serialization after whitespace removal. Comments, alternate syntax or
quoting, directives, duplicate keys, anchors, aliases, tags, merge forms and
unknown fields are unsupported. Do not rewrite real config to satisfy this
dialect. Unsupported input blocks; it never proves safety.

## Host Observations

Only explicit preflight invocation collects host facts, via Effect platform.
The finite read-only allowlist is:

| Fact                              | Exact command                       |
| --------------------------------- | ----------------------------------- |
| OS                                | `/usr/bin/uname -s`                 |
| Architecture                      | `/usr/bin/uname -m`                 |
| Darwin total physical host memory | `/usr/sbin/sysctl -n hw.memsize`    |
| Darwin logical CPUs               | `/usr/sbin/sysctl -n hw.logicalcpu` |
| Darwin free pages                 | `/usr/bin/vm_stat`                  |

Each has a 1-second timeout, 4096-byte combined-output cap and scoped child
cleanup. There is no shell, arbitrary argv, stdin or inherited environment.
Resource utilities run only after an exact Darwin observation; other OS resource
facts remain Unknown. Architecture can still be known from uname. Free memory is
free pages times reported page size, not reclaimable memory or allocation
approval. Process-limited memory is never represented as total host memory.
Unavailable, nonzero, malformed, invalid UTF-8, timed-out or excessive output
leaves affected facts Unknown. All native behavior remains unqualified.

Subprocesses receive only an isolated temporary HOME, also used as cwd. The scope
removes it after success, failure or interruption. Task 2 bounds remain: config
at most 256 KiB; reviewed client version output at most 64 KiB and 5 seconds.

Production Colima/Docker candidates are **Unsupported**: no installed executable
identity has a reviewed version-aware client-only contract. They block before
execution. Semver-shaped output cannot grant safety. Production therefore cannot
currently report installed client versions; there is no fallback.

## Output

One strict `PreflightReport` JSON document plus newline on stdout, at most 262144
bytes including newline. Oversize or invalid reports fail without partial JSON.
No raw YAML, subprocess output, environment, platform diagnostics or stacks emit.

| Exit | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 2    | Valid report; always nativeReadiness Unqualified and canExecuteReplay false         |
| 1    | Finite PreflightFailed stderr JSON: CollectionFailed, InvalidReport, OutputTooLarge |
| 64   | UsageError stderr JSON; no dependency/host observation calls                        |

Missing observations/unreadable config normally produce a blocked report (exit
2), never a readiness pass. Stage 2 is separately approval-gated and not exposed.

## Offline Tests

```sh
bun test probes/colima-readiness/tests
bun run --cwd probes/colima-readiness typecheck
bun run check
```

Tests inject platform APIs or use owned temporary executable/config fixtures.
No actual host preflight or installed client runs. Process tests disable Bun's
own transpiler cache to distinguish runtime cache writes from module effects;
this runtime test setting is not an application fixture capability.
