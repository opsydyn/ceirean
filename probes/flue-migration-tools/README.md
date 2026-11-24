# flue-migration-tools

The tool surface a Flue agent uses to produce a migration patch, and the
confinement around it. Slices 1 and 2 of
[the Flue patch-generation design](../../docs/superpowers/specs/2026-11-23-flue-patch-generation-design.md):
offline, no credential, no spend.

Four tools over one checkout:

| Tool           | What it does                                            |
| -------------- | ------------------------------------------------------- |
| `read_file`    | One UTF-8 file, by a path relative to the checkout root |
| `write_file`   | Replaces one file under a writable prefix               |
| `search_files` | Lines containing a literal substring, bounded           |
| `run_check`    | One check the policy names, reported as an exit code    |

## The boundary

[`src/policy.ts`](src/policy.ts) resolves every path and is the only thing that
decides what a tool may touch. It is deliberately stricter than "the resolved
path starts with the root":

- Only relative candidates are accepted. An absolute path is refused even when
  it names a file inside the root, because accepting one would mean trusting a
  prefix comparison on a string the agent composed.
- `Path.resolveWithin` refuses anything that leaves the root at any point,
  including a traversal that leaves and returns.
- A `.git` component is refused anywhere in a path. It is inside the root and
  would otherwise be readable, and writable under a writable prefix.
- `realPath` equality refuses a symlink at the leaf and at every ancestor, since
  `realPath` resolves the whole chain. This is what stops a link inside `src/`
  from reaching a file outside the checkout.
- Writable prefixes match by whole path component, so `src` admits `src/a.ts`
  and refuses `srcx/a.ts`.

`run_check` takes a name, never a command line: there is no shell, no argument
composition and no path lookup, and a check that is not in the policy is
refused. `search_files` takes a literal substring, never a pattern, because a
regular expression composed by a model is a denial-of-service surface and
nothing in the migration task needs one.

## Check output

Slice 1 discarded a check's output. An agent given only an exit code cannot tell
a lint failure from a test failure from a crash, and the pilot's real surface —
18 files rather than 7 — was discovered from checker output naming the files it
objected to. [ADR-0003](../../docs/decisions/0003-bounded-redacted-check-output.md)
decided to return it, bounded and redacted:

```
run_check -> { name, exitCode, timedOut, output: { stdout, stderr, omitted } }
```

That reopens a channel closed on purpose, so [`src/redact.ts`](src/redact.ts) is
a security module and [`tests/redact.test.ts`](tests/redact.test.ts) holds its
rules rather than examples of them. The order is fixed: decode, strip escapes,
remove secrets, rewrite paths, then bound — bounding first could cut a secret in
half and pass both halves through as ordinary text.

- **No absolute path reaches the agent.** A path under the root is rewritten
  relative to it, and anything else becomes `<path>`. Normalising before the
  comparison is what makes `<root>/../outside/secret.ts` land outside rather
  than being rewritten into a readable relative path.
- **The root never appears**, including on its own, where it becomes `.`.
- **Escape sequences and control characters are stripped.** A carriage return
  becomes a newline, so output that used it to overwrite a progress line arrives
  as two readable lines rather than one misleading one.
- **Decoding is lossy**, unlike `read_file`, which refuses invalid UTF-8 to
  protect file fidelity. A checker that emits odd bytes still says something.
- **Each line is bounded as well as the total**, and the total keeps the head and
  the tail with the dropped byte count between them.

A refusal reaching the agent carries a code and nothing else — no path, no root,
no errno. [`src/agent.ts`](src/agent.ts) narrows every failure to
`Refused: <code>`, which is what Flue serialises into the tool result the model
reads, so a refusal cannot be used to map the filesystem outside the checkout by
reading error text.

## What this does not qualify

- **Redaction is pattern matching, not entropy analysis.** It catches the
  credential shapes a checker is likely to echo — `ghp_`, `sk-`, `Bearer`, a PEM
  header, an environment assignment naming a key — and does not claim to catch
  an arbitrary secret. The real control is that the child's environment holds
  none: `PATH`, `LANG`, `LC_ALL` and `HOME` only, with `extendEnv: false`.
- **A secret straddling the capture ceiling can survive in halves.** Memory has
  to be bounded before anything can be redacted, so there are two bounds and
  only the output bound runs after redaction.
  [`src/capture.ts`](src/capture.ts) records why, and the ceiling is set where a
  check would have to be pathological to reach it.
- **A relative path that escapes is not rewritten.** `../outside/x` passes
  through, because it discloses no absolute structure. Only absolute paths are
  placed.
- **No model has been called.** The provider is `fauxProvider` and `env` is
  empty, so there is no credential to read and no provider that could reach the
  network. Every test scripts the model's turns. Nothing here measures whether
  an agent can actually produce a correct patch — that is slices 3 and 4, and
  each is its own approval gate.
- **Confinement is checked, not isolated.** The window between a resolution and
  the caller's own open is not closed. A process that can replace a component of
  a path between the two can still redirect it; closing that needs `openat` with
  `O_NOFOLLOW` per component, which this runtime does not expose. The checkout
  is assumed not to be concurrently writable by another writer.
- **`search_files` is bounded, not cheap.** At worst it reads 2048 entries at
  `readMaximum` bytes each, one at a time. The bound is on the work, not on the
  cost.
- **No sandbox.** These tools run in the test process against a temporary
  directory. Placing them behind `MigrationSandboxDriver` is a later slice;
  `TIMEOUT_EXIT_CODE` is duplicated here so the two agree when that happens.

## Checks

```sh
moon run flue-migration-tools:policy      # Confinement properties
moon run flue-migration-tools:redact      # The redaction rules, adversarially
moon run flue-migration-tools:tools       # The four tools and their bounds
moon run flue-migration-tools:agent       # The tools as a Flue agent reaches them
moon run flue-migration-tools:test        # All four
```

`tests/checkout.ts` builds the fixture checkout and `tests/run.ts` is the one
place an effect is executed. Both are named in `oxlint.config.ts`:
`tests/checkout.ts` owns this package's Node filesystem access, as
`probes/bun-effect-flue/tests/process.ts` does for its own.
