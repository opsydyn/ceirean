# Colima Readiness Foundation

## Authority And Scope

This is C1's private, preflight-only foundation, not a native worker or a Stage 2
executor. Written-spec approval (2026-10-22) and C1 implementation approval
(2026-10-23, subagent execution) are separate. Neither authorizes real host
preflight, native diagnostics, downloads, VM startup, replay, merge or push.
See the [controlling design](../superpowers/specs/2026-10-22-colima-readiness-design.md)
and [measured assessment](../assessments/colima-readiness.md).

No real host preflight was run during C1 qualification. Obtain explicit owner
authorization before using the command below against an actual host/config.

## C1 Invocation

From the isolated Ceirean checkout, with the retained restricted verification
runner and an explicitly approved, owner-controlled config path:

```sh
bash .superpowers/sdd/2026-10-22-colima-readiness/run.sh \
  bun --no-env-file --no-install probes/colima-readiness/src/main.ts \
  preflight --config /absolute/owned/root/ceirean/colima.yaml
```

The runner supplies credential-free temporary HOME and explicit PATH, denies
network and real `.env` reads, and never sources the root environment. Do not add
`--loopback` for host preflight; that exception is only for established synthetic
test sockets. If the retained runner is unavailable, stop and review an equivalent
isolation envelope rather than running with inherited credentials. No installation
or provisioning is part of this command.

The CLI supports only `preflight --config <absolute-path>`. There are no
activation, cleanup, arbitrary command, fixture or executable-override flags.
Importing modules does not collect observations. Configuration hooks/templates
are never executed, and Docker/Colima environment or global context is not a
fallback authority.

### Input Trust And YAML Limitations

The config path must be exactly `<root>/ceirean/colima.yaml`. One derived root
binds the reader, inspection request and proposed
`unix://<root>/ceirean/docker.sock` endpoint. Only ASCII letters, digits,
underscore, dot and hyphen are accepted in path segments. Traversal and duplicate
separators are rejected; the root is at most 450 characters.

Selecting that path asserts owner-controlled, stable parent directories. The CLI
does not establish ownership or defend against a hostile parent tree. The reader
uses final-component no-follow, regular-file checks and before/open/after
identity/size/mtime checks; these do not replace the parent trust prerequisite.
Executable identity, reviewed command semantics and stable executable parents are
also trusted composition obligations, not facts conferred by a path string.

YAML acceptance is intentionally narrower than ordinary Colima configuration:
optional `runtime: docker`, mounts, forwarding, positive integer CPU/memory/disk,
finite architecture and `autoActivate` fields only. Input must round-trip through
Bun's YAML serializer after whitespace removal. Comments, alternate quoting or
syntax, directives, duplicate keys, anchors, aliases, tags, merge forms and
unknown fields are unsupported. Absent mounts/forwarding are Unknown, not disabled.
An explicit nonempty mounts array is Enabled and blocks as UnsafeConfiguration.
An empty mounts array is Unknown and blocks as UnknownConfiguration: `mounts: []`
does not establish that installed Colima defaults disable sharing. Omitted mounts
also remain Unknown; `mounts: null` is outside this narrow accepted dialect and
is Invalid. No input mounts array can produce Disabled without a separately
reviewed, version-specific effective configuration. Client version text alone
does not qualify those semantics. Explicit `forwardAgent: false` continues to
project forwarding as Disabled, without granting native readiness or replay.
Do not rewrite real config merely to satisfy this dialect. Unsupported or
unreadable config blocks evidence; successful parsing is not installed-version
semantic qualification or proof that restrictions are effective.

### Bounded Observations

Only an explicit invocation acquires the following finite read-only observations:

| Observation                       | Exact utility argv                  |
| --------------------------------- | ----------------------------------- |
| OS                                | `/usr/bin/uname -s`                 |
| Architecture                      | `/usr/bin/uname -m`                 |
| Darwin total physical host memory | `/usr/sbin/sysctl -n hw.memsize`    |
| Darwin logical CPUs               | `/usr/sbin/sysctl -n hw.logicalcpu` |
| Darwin free pages and page size   | `/usr/bin/vm_stat`                  |

Each utility has a 1-second timeout, 4096-byte combined-output cap and scoped
child cleanup, no shell/stdin or inherited environment, and only isolated HOME
as environment/cwd. Resource utilities run only after exact Darwin identification;
unsupported/unavailable/malformed/contradictory observations stay Unknown. Free
pages are not reclaimable memory or permission to allocate a VM. Process-limited
memory is not reported as physical host memory.

Config reads are capped at 256 KiB with strict UTF-8. The reader can run only
reviewed client `--version` commands, capped at 5 seconds and 64 KiB combined
output, with scoped interruption/cleanup. **Both production client candidates
remain Unsupported and are rejected before execution.** Installed executable
identities and their version-aware client-only semantics have not been reviewed.
`colima version` is not an approved replacement: it can inspect runtime state.
Semver-shaped text does not establish daemon independence or grant execution
authority. There is no fallback, daemon contact, VM start or download method.

### Report Interpretation

Stdout is one strict `PreflightReport` JSON document plus newline, at most 262144
bytes including newline. No raw config, subprocess output, environment, exception
stack or platform diagnostic is emitted. Unknowns and finite blockers are useful
results, not collection success masquerading as native readiness.

| Exit | Interpretation                                                                             |
| ---- | ------------------------------------------------------------------------------------------ |
| 2    | Valid report, always `nativeReadiness: Unqualified`, `canExecuteReplay: false`             |
| 1    | Sanitized `PreflightFailed` stderr JSON: CollectionFailed, InvalidReport or OutputTooLarge |
| 64   | `UsageError` stderr JSON, zero dependency/host calls                                       |

Missing tools/config normally yield a blocked report and exit 2. Oversized or
invalid reports fail without partial JSON. A proposed endpoint is not verified
daemon identity. `activationDraft: Unresolved` is not an ActivationManifest or
approval. Pure diagnostic schemas/policy cannot execute diagnostics or issue a
production readiness receipt; reports never clear replay blockers automatically.

### Offline Diagnostic Provenance

The private manifest contract verifies Bun SHA-256 over compact, schema-encoded
UTF-8 JSON without a trailing newline: omit only top-level `manifestDigest`,
recursively sort object keys lexically, and preserve array order and every value.
Changing argv, resource configuration, destinations or cleanup invalidates an old
digest. `deriveManifestDigest` constructs a new content identity, not an approval;
the strict decoder must accept the complete manifest before approval comparison.
Changed content needs newly matching approval and evidence.

The private summarizer takes `(manifest, invocationId, evidence, cleanup,
approval, execution)`. Reports retain the exact approval start/absolute deadline
and actual diagnostic execution interval. Each check/cleanup record has its own
`observed` start/completion and matching approval. All timestamps are finite,
nonnegative safe integers; intervals cannot be reversed. Diagnostics must fit
the approved window and preserve cleanup reserve; the complete activation budget
must fit at actual diagnostic start. Check observations must fit that interval.
Timely cleanup follows diagnostics and completes by the approved deadline.

Missing or malformed provenance rejects; mismatched/out-of-window records cannot
produce Pass. Late cleanup, including cleanup crossing the deadline, must carry
`phase: CleanupOnly`; it is retained as a distinct cleanup-only record and never
qualifies timely success or extends diagnostic authority. `WithinWindow` cannot
label late cleanup, and `CleanupOnly` cannot label timely cleanup. No timestamps
are synthesized, no freshness TTL exists, and these schemas add no C2 scheduler
or native execution path. The focused fixtures are synthetic provenance evidence,
not proof that a host clock or native cleanup observation is authentic.

## C2 Entry Gate

After C1's controller-owned review, separately authorize actual host preflight.
Use its measured facts to write and review a concrete C2 implementation plan.
Resolve exact native image digest/architecture/toolchain and browser identities,
daemon identity, installed-version config/client semantics, security policy,
effective aggregate writable-storage mechanism, network controls/destinations,
measured VM headroom, exact executable paths/argv, time/output/evidence budgets
and ownership-aware cleanup. All are still unresolved here. An unavailable image
requires separate approved retrieval source/digest/bounds; activation does not
authorize a pull or build.

C2 must implement the following seven checks. None has native evidence from C1:

| Check                 | Required C2 prerequisites and native evidence                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EndpointOwnership     | Pin the dedicated `ceirean` endpoint and verify daemon identity before mutations; invocation labels plus immutable resource IDs; refuse foreign/pre-existing or unresolved prior resources, no default-context fallback.                                                                                             |
| HostIsolation         | Verify installed mount/agent/context semantics; inspect actual mounts/environment and synthetic-marker readback proving no host binds/home sharing, controller credentials, SSH agent or Docker socket. Never probe real secrets.                                                                                    |
| ContainerRestrictions | Pin non-root user, read-only root, dropped capabilities, no-new-privileges and approved seccomp identity; inspect effective settings and require prohibited writes to fail. Intended argv alone is insufficient.                                                                                                     |
| ResourceEnforcement   | Measure VM headroom independently; inspect and safely challenge CPU, memory, PID and effective aggregate writable storage including volumes/temp. Resolve actual filesystem/snapshotter/quota support; VM disk capacity or monitoring is not quota proof.                                                            |
| NetworkDenial         | Review authoritative network-denial configuration/readback and approved DNS/direct-IP destinations; pair failed external probes with that evidence; separately prove browser access to its own loopback test server. A failed connection alone is insufficient.                                                      |
| BrowserSandbox        | Pin native image/architecture and Chromium build, non-root/seccomp prerequisites; execute a synthetic local page, retain screenshot plus reviewed evidence of sandbox operation. Launch success or `--no-sandbox` is not proof.                                                                                      |
| CancellationCleanup   | Interrupt an active synthetic diagnostic; stop/remove only invocation-owned containers/volumes by immutable identity, confirm absence by readback, then stop the dedicated VM; reconcile unresolved identities and retain bounded evidence outside disposable resources. A process exit is not native cleanup proof. |

Only after that plan is implemented/reviewed may a separate owner activation
approval bind the exact manifest digest and absolute start/deadline. Enforce one
dedicated VM and one disposable container at a time; 20 minutes total including
cleanup with no automatic extension. Per-container ceilings remain 2 CPUs,
8 GiB RAM, 256 PIDs and 20 GiB aggregate writable storage. Limits are ceilings,
not VM allocation defaults. Command combined output is at most 10 MiB and total
retained evidence at most 128 MiB; every command has a deadline and cleanup reserve.

No privileged/host-network/host-PID mode, host binds, agent forwarding, socket
sharing or browser sandbox bypass is allowed. Stop diagnostic work at deadline;
report any cleanup-only reconciliation separately without extending qualification
or authorizing another run. Unsupported controls are Blocked, not substituted
with weaker monitoring. Missing/duplicate/cross-invocation/truncated/contradictory
evidence cannot pass. All seven checks plus confirmed cleanup and complete bound
artifacts are required, and later replay acceptance/freshness remains a separate
gate. This runbook deliberately contains no executable activation recipe.
