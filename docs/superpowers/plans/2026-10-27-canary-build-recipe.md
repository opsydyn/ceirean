# Canary Build Recipe Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Provide a fixed Linux control-canary image assembly recipe and a non-authorizing identity manifest, and correct the historical worksheet's stale cleanup timing.

**Architecture:** Keep the canary image separate from the hosted final image and historical workload. A digest-pinned Dockerfile consumes only three named, independently reviewed future build artifacts. An Effect Schema preparation check verifies the exact recipe and pending-only manifest but cannot build, approve, run or promote any artifact.

**Tech Stack:** Bun, TypeScript, Effect 4, Moon, oxlint, oxfmt and Dockerfile syntax.

**Spec:** `docs/superpowers/specs/2026-10-27-linux-runtime-readiness-design.md` and `docs/assessments/runtime-feasibility-20261027.md`.

## Global Constraints

- Prepare only: no image/source/binary acquisition, build, Docker, network, credentials, `.env`, real canary, workflow publication, hosted activation or push.
- No new dependencies, native boundaries, dynamic imports, Effect lint waivers or manual Effect channels.
- Fixed canary platform `linux/amd64`; approved existing Node, Bun and Playwright image references must be copied literally from the existing hosted recipe. Their configured digests are candidate inputs, not a built or verified canary.
- Only `input/readiness-worker.mjs`, `input/strace`, and `input/observer-canary` may enter the canary image context. Their hashes, provenance, build toolchain, complete transitive closure, runner identity, final image and actual runtime readbacks remain `Pending` or `Unbuilt`.
- The Dockerfile launches only the existing fixed readiness entrypoint. Observer, network negatives and cleanup remain unmeasured. Do not claim a full executable observer canary or hosting readiness.
- A caller-supplied manifest, digest or checksum file cannot grant build, run, qualification or activation authority. The check returns `PreparationOnly`, activation `Blocked`; independently reviewed identities and separate build/run approval remain necessary.
- Preserve the historical three-mount admission and distinguish it from the proposed five-mount readiness allocation. The current 30-second cleanup schedule is cooperative, not a proven hard deadline.

## Review Focus

- A self-consistent mutated Dockerfile/manifest must not authorize new images, inputs or execution.
- Missing, duplicate, extra, linked or secret-bearing build-context inputs must not be mistaken for approved artifacts; context verification remains an explicit future gate if not implemented.
- Mutable image tags, build arguments, extra COPY/RUN instructions and arbitrary commands must be rejected by exact recipe verification.
- Historical installer pins, the canary image, and the final hosted image must not be conflated.
- Stale worksheet timing must not be read as permission to change live limits or run a qualification.

### Task 1: Candidate Recipe And Blocked Identity Check

**Files:**

- Create `probes/cloudflare-executor/readiness-image/Dockerfile` and `probes/cloudflare-executor/readiness-image/.dockerignore`.
- Create `probes/cloudflare-executor/fixtures/readiness-image.json`.
- Create `probes/cloudflare-executor/src/readiness-image.ts` and `probes/cloudflare-executor/tests/readiness-image.test.ts`.
- Create `probes/cloudflare-executor/scripts/prepare-readiness-image.ts` and register its fixed `--check` command in the probe's `package.json`.
- Modify `probes/cloudflare-executor/moon.yml` to include the test.

**Interfaces:** Use existing `sha256` and strict Schema patterns. Export a `validateReadinessImagePreparation(input: unknown, recipe: string)` Effect that only accepts a strict fixed candidate manifest and the independently source-pinned exact Dockerfile hash; return a finite `PreparationOnly` report with `activation: Blocked`, `image: Unbuilt` and named missing artifacts. Keep strace source identity fixed at tag object `129b5e1cc8edb89b80e75edda8e2dacb527ed89c` and peeled commit `1d78a4ce1bfa3754b3b99b1e4bb15790001b77cb`.

- [ ] Write failing tests for the exact candidate manifest and recipe; mutated Dockerfile plus matching caller-supplied hash, mutable image tags, altered source pins, extra keys, supplied future hashes, path escapes, arbitrary CMD/COPY/RUN, and attempts to set built/approved status must refuse. The successful report must remain blocked and enumerate all missing inputs.
- [ ] Add a separate digest-pinned multi-stage recipe using the existing Node/Bun/Playwright image refs, fixed `COPY` of exactly the three named artifacts with safe modes, `pwuser`, and exact `bun --no-env-file --no-install ... --worker` command. Add a restrictive Docker ignore file and state that fresh, independently verified context staging is still missing. Do not build or execute the image.
- [ ] Implement the strict preparation check and pending-only fixture; pin the actual candidate Dockerfile hash in source, never accept the supplied hash as its own authority. Run fake/static tests, typecheck, lint and formatting; independently review and commit.
- [ ] Expose a fixed `--check` CLI that reads only the bounded committed fixture and Dockerfile, reports preparation as blocked and refuses other arguments; test without building or running an image.

### Task 2: Worksheet And Handoff

**Files:** Modify `qualification/linux-cache-run-worksheet.md` and `docs/assessments/runtime-feasibility-20261027.md`.

- [ ] Correct stale cleanup text to the current 30-second cooperative budget with 3-second best-effort stop and 20/10 removal/readback scheduling. Explicitly preserve the historical three-mount admission and mark the five-mount proposal unmeasured/unadmitted.
- [ ] Document the candidate recipe and pending manifest, exact next artifact/build and production-provider blockers, and no proof from static tests. Do not imply the new recipe is already buildable, run or deployed.
- [ ] Verify formatting and independently review; commit. Run all typechecks, relevant offline tests and final branch review; report actual live gates and remaining unknowns.
