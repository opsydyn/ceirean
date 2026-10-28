# Scoped Stdin Adapter Plan

**Goal:** Observe a child stdin stream's finish, early close and error without
enabling a builder, image build or hosted execution.

**Constraints:** Add only one exact Node platform boundary. Preserve all Effect
rules and existing drafts. Validate bounded input, attach lifecycle listeners
before writing, propagate close/error and cancellation, and never interpret a
successful local write as receiver or builder consumption. Tests use harmless
local streams and processes only; no Docker, network, secrets or image build.

1. Implement a narrow Node Writable adapter and adversarial, real-process tests
   with red-green verification. Avoid a production process launcher or arbitrary
   executable configuration.
2. Register the exact platform boundary and tests, run independent security
   review, lint, typechecks and the affected suite, and commit verified changes.
3. Document observed guarantees and remaining receiver, cleanup, provenance,
   builder and activation gates without claiming end-to-end qualification.
