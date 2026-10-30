# Pinned Manifest Declaration Report

This local-only command inspects committed manifests without checking out target
code, loading its modules, installing dependencies or running its scripts.

```sh
bun --no-env-file --no-install apps/replay/src/main.ts manifests --repository /absolute/path/to/fold-kit-experiments
```

Run from the Ceirean checkout with its pinned Bun 1.4.2. Disable implicit dotenv
loading on the parent invocation. No credentials or GitHub App permission changes
are needed. `/usr/bin/git` must exist. The repository argument is a local directory,
not a URL; there is no ref, output-path or arbitrary-command selector.

## Pinned Source And Meaning

The application pins repository label `opsydyn/fold-kit-experiments` and commit
`1183e3c067f873fdd29f14f06030515929c1b956`. It never follows `HEAD`, `main` or a
remote-tracking ref during a report. The supplied local object store must contain
that commit and all selected objects. A different working tree, deleted manifest,
moved branch or Git replacement must not alter the report.

Provenance is `LocalGitObjects`: this is not a fresh GitHub fetch or proof that the
local object store belongs to the labelled remote. The read adapter validates the
commit type and exact regular-file tree entries, and independently checks each
blob's Git SHA-1 against its bytes. Each report also records a SHA-256 of the
original manifest bytes. No timestamp or absolute local path enters the artifact.

Coverage is explicit: root `package.json` plus the 13 immediate workspace
manifests enumerated in `apps/replay/src/manifest-baseline.ts`, including the
Astro/Viz packages, 3D packages, demo apps and tech-radar infrastructure. Discovery
of new workspaces and repinning are deliberate later changes, not automatic here.

Entries cover dependencies, devDependencies, peerDependencies and
optionalDependencies. Each keeps the original declaration. `catalog:` resolves
through the root default catalog; `catalog:<name>` resolves through that named
catalog, including a named `default` distinct from the unnamed one. Missing,
malformed or recursively catalog-valued catalogs refuse the report. Ordinary
package fields, including scripts/exports, are ignored rather than evaluated.

Catalog lookup produces another **declaration**, not an installed version.
Literal ranges, aliases and workspace declarations stay uninterpreted. Root
packageManager and engines are declared context only. The report proves neither
lockfile resolution nor installation, build, browser or runtime compatibility.
The historical `inspect` operation and 0.165-to-0.166 replay profile are unchanged.

## Bounds And Output

- Per manifest: 262144 bytes, enforced while reading even after size metadata.
- All selected manifest bytes: 2097152 bytes.
- Encoded report: 262144 UTF-8 bytes including the final newline.
- Git metadata and diagnostic streams are independently capped.
- Entire operation: one 15000 ms cooperative deadline enclosing layer acquisition,
  inspection, output preparation and runtime disposal. Scoped children use a kill
  policy and their finalizers are joined. Noninterruptible cleanup can exceed the
  deadline; this is not a hard wall-clock process-kill guarantee.

Success exits 0 with exactly one validated JSON report line and empty stderr.
Failure exits 1 with empty stdout and one finite JSON refusal on stderr:

```json
{ "_tag": "ManifestReportFailed", "code": "SourceTooLarge" }
```

Codes: `GitFailed`, `MissingObject`, `InvalidTreeEntry`, `InvalidEncoding`,
`SourceTooLarge`, `InvalidSource`, `InvalidManifest`, `InvalidCatalog`,
`MissingCatalog`, `InvalidReport`, `OutputTooLarge`, `TimedOut`.
They do not include native stderr, repository paths, credentials or partial data.
Usage errors exit 64 before source acquisition. Historical inspection retains
its blocked exit 2.

Git runs without a shell or inherited environment, with global/system config,
replacement objects, lazy fetching, optional locks, prompts and protocols
disabled. Built-in object plumbing avoids hooks, filters and textconv. The
command has no retry, repair, checkout, fetch, install, build or write mode.

## Verification And Next Gate

```sh
moon run domain:test replay:test --concurrency 1
moon run :typecheck --concurrency 1
bun --no-env-file --no-install run check
git diff --check
```

Tests include Effect Arbitrary laws, malformed input/refusal cases, exact UTF-8
limits, fake process ownership and cancellation, real temporary Git replacement
and worktree drift, runtime acquisition/work/disposal deadlines, quiet imports,
dotenv isolation and the actual entrypoint's zero exit code.

See [local baseline evidence](../evidence/manifest-report/baseline-1183e3c.md).
The next proposed gate is a bounded hosted manifest-report design. No report run
authorizes deployment, container/image changes, public routes, webhook delivery,
dependency installation, browser qualification, model execution or PR writes.
