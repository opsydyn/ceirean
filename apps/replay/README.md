# Offline Replay Inspector

From the Ceirean repository root, with its locked dependencies installed:

```sh
bun --no-env-file --no-install apps/replay/src/main.ts inspect
```

This private Bun application inspects the central Draft FoldKit 0.166 replay
profile. It does not perform the migration. The source path is resolved relative
to the application module, not the working directory. No flags, alternate profile,
target overrides, execution mode or API keys are accepted.

| Exit | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| 2    | Valid inspection, execution blocked; one JSON line on stdout       |
| 1    | Read, decoding or internal report failure; finite code on stderr   |
| 64   | Unsupported/missing arguments; rejected before reading the profile |

Exit 2 is expected, not a failed migration. There is deliberately no successful
execution or qualification exit. Importing `src/main.ts` is quiet.

## Report And Limits

The report always has `canExecute: false`, publication Disabled and these ordered
blockers: ProfileRevisionUnverified, HostUnqualified, ImageUnqualified,
ToolchainUnqualified, AcceptanceUnqualified, ExecutionUnapproved,
ModelPolicyUnapproved. Check IDs describe proposed checks, not passing results.
CPU, memory, time, repair and output settings are declarations, not enforced
native limits or approved spend.

`sourceDigest` is SHA-256 of the exact file bytes. The origin is explicitly
`UnverifiedWorkingTree`; the digest is not Git revision attestation or approval.
Unknown keys, malformed paths/identities and unsupported qualification fields
are rejected. Domain inspection compares repository, base and targets exactly.

Reading uses one scoped regular-file descriptor with final-component
`noFollow`, strict UTF-8 and at most 262145 bytes read, accepting at most 262144.
Short reads are accumulated. The controller-owned parent directory is trusted;
`noFollow` does not protect against symlinked parent directories or a hostile
local filesystem. Reports are schema-validated and capped at 16384 bytes;
failure never emits a partial report or raw path/exception/file contents.

## Capabilities Absent

No Docker/Colima commands or startup, worker lifecycle, native ledger, SQLite,
model calls, secret/config discovery, consumer installs/builds/tests, networking,
GitHub access, tunnel or webhook activation, publication or writes. The app owns
no migration tools. Declared command argv and source-rule names are inert data,
not executable hooks or proof of a scope-valid patch.

Later journal/recovery, native mechanism/readiness and prepared-artifact/manual
replay work need separate plans and approval. See the
[measured assessment](../../docs/assessments/foldkit-replay-profile.md).
