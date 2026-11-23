# Documentation Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make this repository's documentation navigable and keep it that way, without editing a dated record in place or weakening any existing claim.

**Architecture:** One entry point per level — repository README, documentation index, per-project README — each stating what it owns and linking down rather than restating. Dated records stay immutable and are superseded, never amended. Structure that a reader depends on is enforced by a task in the gate, not by habit.

**Tech Stack:** Markdown, Moon 2.5.4 tasks, Bun 1.4.2 for the link checker, the existing `check.yml` gate.

**Spec:** None. The scope came from a maintainer review of the README on 2026-11-23: a wall of text, no description of the project, and a folder structure that existed only at the bottom of the file.

## Global Constraints

- No dated assessment or evidence record is edited in place. Superseded findings get a new dated record; the old one stands.
- No measured number, claim or stated limitation is changed to make a document read better. Exclusions are load-bearing.
- Documentation work changes no source behaviour, no test, no threshold and no workflow logic beyond adding a documentation task.
- No publication, deployment, credential use or external acquisition. The LikeC4 CLI is not acquired to regenerate views; the existing renders stand.
- Link paths may be corrected freely. That is not superseding.

## Review Focus

1. A record moved or replaced must lose no wording. Compare preserved text against its predecessor, not against a summary of it.
2. An index that lists counts or claims must be checked against the repository, not written from memory. Stale structural documentation is worse than none, because it is trusted.
3. A new project README must not restate what its own source already says precisely; it should say why the project exists and what it does not cover.
4. The link checker must fail on a broken link, not merely report one, and must not pass by finding nothing to check.

## Task 1: Repository README, Documentation Index And History

**Files:** rewrite `README.md`; create `docs/README.md`, `docs/readme-history-20261123.md`.

- [x] Preserve the README's status and planning prose verbatim as a dated history record, with link paths rewritten for its new location and no wording edited.
- [x] Rewrite `README.md` reader-first: what Ceirean is, the pipeline, a nested repository tree including `.github/`, architecture with the rendered views, the real check commands, a documentation table, and a short status that links to the roadmap.
- [x] Write `docs/README.md` naming the nine kinds of document, their counts, the naming conventions, and the rule that dated records are superseded rather than edited.
- [x] Verify every relative link in all tracked markdown resolves, and that the tree and task counts match `.moon/workspace.yml` and the `moon.yml` files.

## Task 2: Per-Project READMEs

**Files:** create `README.md` in `packages/domain`, `packages/engine`, `probes/bun-effect-flue`, `probes/github-admission`, `probes/factory-binding`, `vendor/factory`.

Nine of fifteen projects document themselves; six do not, including both private packages that hold the domain and the engine. Each new README states what the project owns, what it deliberately does not, its evidence record, and how to run its tests. `vendor/factory` additionally states its provenance and that it is upstream source under MIT.

- [ ] Write the six READMEs, each linking to its assessment or evidence record where one exists.
- [ ] Link them from the repository README's layout section where a one-line description is insufficient.
- [ ] Confirm no README restates a measured number without citing the record it came from.

## Task 3: Assessment And Evidence Indexes

**Files:** create `docs/assessments/README.md`, `docs/evidence/README.md`.

Thirty-six assessments and thirty-six evidence records across eight subjects, with no way to tell which record is current for a subject or which superseded which. The indexes group by subject in reverse date order and mark the current record for each.

- [ ] Build both indexes from the files themselves, reading each record's own stated subject and date.
- [ ] Mark superseded records as superseded, naming the record that replaced them, without editing the records.
- [ ] Name the subjects that have a design or plan but no assessment, so the gap is visible rather than implied.

## Task 4: Record What The CI Gate Superseded

**Files:** create one dated assessment under `docs/assessments/`.

Several records describe behaviour the 2026-11-23 CI work changed. `docs/assessments/offline-executor-inputs.md` states that the preparation CLI uses macOS tar options and `/private/tmp` and is not a portable Linux builder entrypoint; both were fixed. Per the constraint above this is a new record, not an edit.

- [ ] Identify every record whose stated limits the gate work invalidated, by reading them rather than by searching for keywords.
- [ ] Write one dated assessment recording what now runs on Linux, what the thirteen test targets cover, what the gate does not qualify, and which records it supersedes.
- [ ] Note that `packages/migration-storage` is host-gated to macOS by policy and that this is a deliberate exclusion, not a pending port.

## Task 5: Enforce The Structure In The Gate

**Files:** create a link-checking script and its Moon task; modify `moon.yml` and `.github/workflows/check.yml`.

Structure decays silently. A moved file breaks a link that nobody notices until a reader needs it. The checker resolves every relative markdown link, every image source including those inside `<picture>` elements, and fails on the first unresolvable target. It must also refuse when it finds no links at all, for the same reason the test matrix refuses an empty target list: a check that passes by doing nothing is worse than no check.

- [ ] Write the checker over tracked markdown only, with no network access, so an external URL is never fetched.
- [ ] Prove it RED against a deliberately broken link, then GREEN against the repository as it stands, which currently has none.
- [ ] Add it to the root `moon.yml` and to the gate as a job, so it reports independently of lint and of the thirteen test targets.
- [ ] Confirm the aggregate `Gate` check depends on it, since `main` requires only that context.

## Publication And Execution Gates

Each task is its own pull request through the gate. No task in this plan authorises a deployment, a credential, an image build, an external fetch, the LikeC4 CLI, auto-merge or a release. Task 5 adds a job to the gate; it changes no existing job and relaxes nothing.

## Execution Ledger

- 2026-11-23: Task 1 complete. README reduced from 392 lines to 169, history preserved verbatim at `docs/readme-history-20261123.md`, documentation index written, every relative link in tracked markdown verified to resolve. Tasks 2 to 5 not started.
