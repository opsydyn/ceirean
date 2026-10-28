# Observer And Transport Implementation Plan

**Goal:** Implement the requested observer canary and advance native custody and
builder transport qualification without building the canary image or activating
hosted execution.

**Constraints:** Keep production staging, image build and hosted activation
blocked. No credentials, Docker, network access or privileged tracing during
local tests. Preserve the existing uncommitted staging draft and universal lint
rules. Treat prior Linux results as evidence only for their tested cases.

1. **Incomplete:** Implement a fixed-scenario observer canary executable with bounded process
   ownership and tests. It does not itself establish trace completeness, channel
   protection or runtime qualification.
2. **Local mechanism only:** Implement a Linux sealed-byte custody primitive with bounded copy and verified
   seals. A sealed snapshot does not prove source provenance, digest, deadline,
   procfs trust or builder consumption.
3. **Blocked:** Implement a bounded real subprocess byte transport and exercise it with a local
   receiver, not Docker. Distinguish receiver evidence from actual builder
   consumption and uncertain cleanup.
4. **Partial:** Independently review each change, register its tests, run local verification
   and document the remaining Linux, provenance and builder-specific gates. Do
   not promote the candidate to build authority or manufacture artifact hashes.

The initial process-exercise draft is not included in the normal test task: its
stall path can orphan a grandchild on a host without a reliable reaper, and its
test cleanup is not independently bounded. It is not an admitted observer. The
current Effect child stdin sink can report success after an unread child exits;
see the [transport assessment](../../assessments/builder-stdin-qualification-20261028.md).
The sealed-memory primitive has no production caller or native Linux pass yet.
