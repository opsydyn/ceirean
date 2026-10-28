# Trusted Canary Staging Implementation Plan

> Execute with test-driven development and independent security review.

**Goal:** Prepare a fail-closed staging path for the three fixed canary inputs without building or activating the image.

**Architecture:** Validate bounded byte snapshots against independently pinned identities, then create a fresh private context with only the pinned recipe and fixed input names. Synthetic tests exercise the staging mechanism; the production path remains blocked until artifact identities and secure custody are independently reviewed. A supplied manifest or hash is never an approval.

**Tech stack:** Bun, Effect, TypeScript, Moon, oxlint.

## Global Constraints

- No network, image build, Docker, credentials, deployment, or hosted activation.
- No new lint exception. The user approved a narrowly scoped Linux-native filesystem boundary on 2026-10-28.
- Exact canary paths are `input/readiness-worker.mjs`, `input/strace`, and `input/observer-canary`; the recipe hash remains source-pinned.
- Real artifact identities and provenance are pending; do not manufacture them or claim build approval.
- Do not consume concurrently mutable untrusted filesystem inputs under an unproven custody guarantee.
- Reject duplicate, extra, missing, empty, oversize or mismatched inputs, and refuse existing output destinations.
- Staging and synthetic verification do not confer build, runtime, or hosted approval.

## Task 1: Pin validation and staging mechanism

Implement bounded snapshot validation and fresh-context creation with fixed paths; exercise real filesystem behavior in temporary directories using synthetic pins and inputs. Test mutation, invalid identities, extra/duplicate/missing entries, byte budgets, existing destinations and incomplete/changed context. Ensure real entry points remain blocked without independently reviewed pins and custody. Register tests in both task lists. Commit verified work.

## Task 2: Build preparation and review

Update the qualification worksheet with the exact remaining provenance, custody, platform, image-build and approval gates. Run affected tests, all typechecks, lint and formatting; independently review the complete diff for authority bypass, filesystem races, unbounded input and misleading readiness claims. Commit verified documentation and any review corrections. Do not build or run an image.

## Task 3: Linux filesystem boundary

Implement a Linux-only descriptor-relative boundary with nonblocking, no-symlink resolution and fail-closed handling for unavailable primitives. The boundary is a mechanism, not artifact approval, custody, or build authority; no execution of the canary image or hosted resources. Test the host-independent control flow using deterministic fakes and cross-compile the Linux source if local tooling permits; record Linux kernel qualification as a separate outstanding gate. Do not wire an unreviewed helper binary or caller-selected hashes into a production builder.
