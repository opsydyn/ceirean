# Pinned FoldKit Manifest Report

Status: proposed; implementation awaits design approval.

## Intent And Approach

Produce Ceirean's next useful read-only artifact: a deterministic dependency
declaration report for the current FoldKit experiments baseline. The owner chose
the current pinned repository rather than the historical 0.165-to-0.166 replay.
The historical profile remains unchanged and is not evidence for this baseline.

Reading committed local Git objects avoids working-tree drift, network retrieval
and new GitHub App permissions. Hosted retrieval/execution is a later gate. This
is a small local reporting slice, not an upgrade planner or qualification runner.

## Source And Coverage

Pin `opsydyn/fold-kit-experiments` at local `main` commit
`1183e3c067f873fdd29f14f06030515929c1b956`. Never resolve a moving ref during a
report. Provenance must say `LocalGitObjects`, not remote-current or GitHub-verified.

Read only these 14 committed regular-file manifests:

- `package.json`
- `apps/promo/package.json`
- `apps/tech-radar/package.json`
- `apps/three-promo/package.json`
- `apps/web/package.json`
- `infra/tech-radar/package.json`
- `packages/astro-foldkit/package.json`
- `packages/dataset-explorer/package.json`
- `packages/effect-three-foldkit/package.json`
- `packages/effect-three-rapier/package.json`
- `packages/effect-three-samples/package.json`
- `packages/effect-three-troika/package.json`
- `packages/effect-three/package.json`
- `packages/foldkit-viz/package.json`

Validate the selected commit and manifest tree entries. Refuse symlinks, missing
objects or files, and mismatched identities. Do not read manifests through the
working tree. Record each manifest's Git blob identity and SHA-256 of the exact
bytes read. A local object identity is not an attestation of repository ownership.

## Report Contract

For every manifest, retain its path, package name and dependency entries from
`dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`.
Each entry records its section, name and original declaration. Resolve `catalog:`
and `catalog:<name>` through the pinned root manifest, recording the catalog name,
source path and resulting declaration. Missing or malformed catalog references
refuse the complete report rather than silently dropping entries.

Literal ranges, aliases and `workspace:` declarations remain declarations; do not
claim they are installed versions or resolve their semantics. Preserve separate
entries when a dependency occurs in multiple sections. Include root
`packageManager` and `engines` as declared toolchain context.

Emit versioned, strictly validated JSON with repository, commit, provenance,
explicit coverage and sorted manifest/dependency entries. A concise human summary
may be rendered from that same report. No timestamps or absolute local paths in
the artifact. Report completion proves inspection only, never install, build,
runtime compatibility or qualification success.

## Architecture And Failure Behavior

Keep parsing/catalog interpretation pure and reusable. An Effect-owned local
adapter supplies bounded committed bytes through fixed Git operations with argv,
never a shell command assembled from repository data. Compose dependencies at one
exported application boundary or owning service. Extend the replay app with a
separate manifest-report operation; retain existing `inspect` behavior unchanged.
Do not add dependencies or weaken universal Effect lint rules.

Proposed builder defaults: 256 KiB per manifest, 2 MiB aggregate source bytes,
256 KiB encoded report, and a 15-second cooperative operation deadline with
owned child-process cleanup. Enforce input bounds during reading and output
bounds before emission. Validate UTF-8 and JSON structure, refuse unsupported
catalog shapes, and emit only finite sanitized failure codes. No partial success
artifact or raw Git stderr on failure. Exact internal APIs and error-code names
are left to the implementation plan.

## Verification And Boundaries

Use fixtures and regression tests for literal/default/named catalog declarations,
peer ranges, duplicate sections, malformed JSON/encoding, missing catalogs,
identity mismatch, symlink entries, size/deadline failures and sanitized output.
Use property tests for deterministic ordering and invariance under unrelated
manifest fields. Verify that working-tree edits cannot change the pinned report.
Run the real local report against the exact commit and retain sanitized evidence.

Run affected tests, workspace typechecks and root lint/format before committing
verified implementation. Preserve the existing dirty observer research.

No dependency installation, repository scripts, registry queries, code imports,
patch generation, baseline/browser runs, image builds, deployment, webhook/route
activation or PR writes. The hosted runtime remains unchanged. The next gate is
a separately designed bounded hosted manifest-report rehearsal, not automatic
activation after local verification.
