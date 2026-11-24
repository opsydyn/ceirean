---
status: accepted
date: 2026-11-24
decision-makers: Project owner
---

# ADR-0003 Return bounded redacted check output to the migration agent

## Context

`MigrationSandboxDriver.exec` in
[`packages/engine/src/migration-sandbox-port.ts`](../../packages/engine/src/migration-sandbox-port.ts)
returns `SandboxExecution`, which is `Schema.Struct({ exitCode })`. There is no
stdout and no stderr. The discard is deliberate and consistent:
[`probes/cloudflare-executor/src/preparation-process.ts`](../../probes/cloudflare-executor/src/preparation-process.ts)
collects stderr under a 4096-byte bound and then drops it, so diagnostics stay
sanitized. Slice 1 of the Flue design followed that: `run_check` returns
`{ name, exitCode, timedOut }` and discards both streams at the child.

That is defensible for a preparation step whose only question is "did it work".
It is fatal for an agent asked to repair a failing check. A lint error, a test
failure and a crash all arrive as the same non-zero integer, and only a timeout
is separable, by `TIMEOUT_EXIT_CODE`.

The pilot settles it as a matter of evidence rather than preference. Its first
two failures were consistency checkers that **named the files they objected to**,
and that output is how the real surface of the migration — 18 files, not 7 — was
discovered at all. An agent given only an exit code could not have found it.

[The design](../superpowers/specs/2026-11-23-flue-patch-generation-design.md) set
out three ways forward and declined to choose. The owner chose on 2026-11-24.

## Decision

Return bounded, redacted output alongside the exit code. `run_check` becomes:

```
{ name, exitCode, timedOut, output: { stdout, stderr, omitted } }
```

Both streams are captured, redacted and bounded; `omitted` is the number of
bytes the bound dropped, so truncation is observed rather than silent.

This reopens a channel that was closed on purpose. The redaction rules are
therefore a security surface, not formatting, and they are tested adversarially
rather than by example:

- **No absolute path reaches the agent.** A path under the checkout root is
  rewritten relative to it; any other absolute path is removed. Slice 1 exists to
  stop the agent learning the filesystem outside the checkout, and output is the
  obvious way around that if it is passed through.
- **The checkout root never appears**, in any form, including on its own.
- **Credential-shaped strings are removed** even though the child's environment
  holds none, because a checker can read a file.
- **Escape sequences and control characters are stripped.** Output is data the
  model reads, and an escape sequence is an instruction-shaped payload in it.
- **Decoding is lossy, not refusing.** Unlike `read_file`, which refuses invalid
  UTF-8 to protect file fidelity, diagnostics decode with replacement so a
  checker that emits odd bytes still tells the agent something.
- **Each line is bounded as well as the total**, so one enormous line cannot
  consume the whole budget.
- **The bound keeps the head and the tail.** Checkers name files throughout their
  output and crashes appear at the end; keeping only one end loses whichever
  matters.

## Alternatives

| Option                           | Benefit                                                       | Tradeoff / disposition                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded redacted capture         | Works for any checker, and says something when one dies early | Reopens a deliberately closed channel; redaction becomes a security surface. **Selected.**                                                            |
| Artifacts from the checkout      | No new channel at all; already works through `read_file`      | The pilot's failures were in output, not report files, and it is silent when a check crashes before writing. Not sufficient alone; remains available. |
| Structured check-result contract | Cleanest boundary of the three                                | Requires cooperation from repositories we do not own, which is the whole point of the product. Deferred.                                              |

Choosing capture does not forfeit artifacts: `read_file` already reads a report
file a check writes, and needs no further work to do so.

## Constraints

- Redaction runs before any bound is applied and before the output leaves the
  tool. A bound applied first could cut a secret in half and pass both halves.
- Output is drained even after the bound is reached, so a child cannot block on a
  full pipe and stall the check instead of failing it.
- A timeout still reports `TIMEOUT_EXIT_CODE` and `timedOut: true`. Whatever the
  child wrote before being killed is bounded and redacted like any other output.
- This changes the probe only. `SandboxExecution` in the engine is not widened
  here; whether the port follows is a later decision with its own evidence.
- No rule relaxation, no test weakened and no bound raised to make output fit.

## Implementation Impact

Slice 2 of the Flue design, in `probes/flue-migration-tools`:

1. A redaction module owning every rule above, with the rules as its tests.
2. Bounded capture in `run_check`, replacing the discard at the child.
3. Evidence that an agent can tell a lint failure, a test failure and a timeout
   apart, asserted through the Flue tool result rather than the surface alone.
4. The package README's recorded limits updated: gap 2 is closed, and what
   redaction does not promise is written down.

## Consequences And Revisit

The agent gains the signal the pilot shows it needs, and the project gains a
redaction boundary it must now keep correct. Every future change to that module
is a security change.

Revisit if a checker's useful output cannot survive redaction — the answer is
then a report file through `read_file`, not a weaker rule. Stop and review with
the owner rather than relaxing a redaction to make a check readable.

Nothing here approves a model key, a provider call, a container, a credential or
a repository write.
