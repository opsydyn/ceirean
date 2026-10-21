# Final Fix Disposition Ledger

Controller-authorized personal fix wave from `36de5ba28e8921952c26a2fb6e7c9728bd305a3d`.
No agents/reviewers dispatched. Tasks 1-7 are accepted; whole-branch acceptance,
scoped rereview, final controller verification and integration choice remain pending.
Nothing here is a runtime waiver or permission to use live credentials/API/tunnels.

## Findings

| Item | Bounded disposition                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1   | Start-only complete schema equivalence after ledger ownership, before authority/listen. Existing validated read-only snapshot supplies active policy without sampling admission clocks. Failure unwinds, makes no API call and installs nothing. Configure/status do not compare file equality.                                                                                                                                                    |
| I2   | Completed CLI result includes exitCode derived from typed Refused output; main returns it. Structured JSON remains unchanged. AuthorityChanged, RevisionReused, CapacityExceeded and Installed exercise the actual CLI/main boundary.                                                                                                                                                                                                              |
| I3   | Local-only schema-derived current/history policy and decision/provenance/minimal permission projection from the same validated read-only transaction. At most 256 policies/outcomes. Tests include admitted, local denied, live denied, active owner and corrupt evidence. Public responses/routes unchanged.                                                                                                                                      |
| M1   | Known memory receipt remains original; explicit metadata/record immutability assertion.                                                                                                                                                                                                                                                                                                                                                            |
| M2   | Paired empty stores process equivalent reversed histories, each including repeated same deliveries and alternate delivery IDs. Compare command-key-sorted business outcomes after replacing incidental decision/evidence IDs consistently. Admitted cases, seeds 0/1/163, 1000 runs/seed, size 50, maxShrinks 1000 and maxDiscards 10000 retained. This is coverage characterization, not a production ordering defect or retrospective RED claim. |
| M3   | All named app/adapter readiness reads use a 4096-byte newline accumulator with EOF refusal and five-second watchdog. Exact phase assertions remain; split JSON/UTF-8, EOF, overflow and shortened test watchdog covered. Existing gate timeouts unchanged; no retry policy added.                                                                                                                                                                  |
| M4   | Rebuilt the three canonical outer archives using USTAR payload-only packaging and complete regular-member set/hash assertions. All indexed bytes retained. Nested Task 6 raw archive inspected: 56 regular members, including 28 AppleDouble members, and 28 PAX-header members. Original SHA256 `7d9b86923cfc50b4115830ac81dce45afcd30bdabb0bf212da9142910a50f734` retained as HistoricalArtifactException, not called metadata-free.             |

## Process And Historical Evidence

- Meaningful I1/I3 REDs show accepted mismatch and missing status fields before production edits. The initial I2 attempts hit SQLite test-open flag errors and are nonqualifying; `i2-meaningful-red.log` subsequently shows all three expected exit-1/actual-exit-0 assertions and an Installed success before the I2 fix.
- M1 has a meaningful original-metadata RED. Initial M3 missing-helper and error-message assertions are development failures, not behavioral RED proof. M2's first normalization used an invalid nonnumeric decision ID, producing a characterization-test failure; correcting that to a valid normalized ID is not a production fix.
- Initial sandbox app probe had denied ephemeral binds and exposed unintended admission-clock sampling in the first I1 implementation. The final implementation uses the existing read-only status policy snapshot. The authorized focused run passes without retrying a failed unchanged qualification gate.
- During control restoration, an ambiguous replay patch first targeted the wrong matching line. The source-hash guard refused GREEN before executing a test. The exact original lines were restored, the guard passed, and the single restored GREEN ran successfully. Post-control integrity confirms all 169 frozen files match; no control mutation remains.
- The original `b7f5d4e` manifest is retained byte-for-byte in `historical-b7-manifest.json` (SHA256 `52e1613f41e93eedd7db2b807b8b1b58cb7a3daba154ac70c0377bde3e03666d`). All original 154 Task 7 raw payloads, 212 Tasks 1-6 payloads and four docs-verification payloads remain unchanged. Their original outer archive hashes and repackaged hashes are recorded in indices and `archive-repackaging.json`.
- The controller already accepted the Moon-notice disposition: preserve notices, do not upgrade. Moon remains 2.5.4. Advertisements are not lint warnings; no pristine-console claim.
- Initial Task 5 broad-batch TDD history remains incomplete. Later tests/gates cannot recreate the missing earlier RED. Task 6 TDD excerpts remain summaries; archived raw logs alone support their source-specific gate claims.
- Historical review prose retains its original pending status within historical artifacts. Current documents distinguish accepted Task 7 from pending whole-branch scoped review. No scratch progress/review file is edited or force-added.

## Reviewer Declined Scope

These are the final review's explicit evidence/scope boundaries, retained rather
than converted to runtime exceptions or newly granted authority:

| Boundary                                                                            | Disposition                                                                                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Actual endpoint/API-version/token/grant compatibility                               | Synthetic checks only; actual selected-installation grants remain unqualified. No live access.                              |
| Real credential custody, App/key validity, PKCS#1 conversion                        | Synthetic PKCS#8 contract only; operator preparation and real custody unqualified.                                          |
| Tunnel TLS/routing/provider and end-to-end latency                                  | Operator owned, exact-target approval absent; no tunnel run.                                                                |
| Arbitrary network mounts/build roots/sync software                                  | Operator-declared locality remains explicit; path checks cannot prove absence.                                              |
| Malicious same-UID replacement/rollback                                             | Excluded local operator trust boundary; no cryptographic anti-rollback claim.                                               |
| Config-file mode/setup/conversion enforcement                                       | Runbook operational requirement and disclosed reader limitation, not a new implemented credential guarantee.                |
| Host/power/disk loss, portable backups, unattended availability                     | Process-death tests do not establish these; old-snapshot replay-history loss remains explicit.                              |
| Atomic GitHub revocation across SQLite commit                                       | Not guaranteed; historical observation interval and future independent reauthorization remain required.                     |
| Execution/models/workers/assessment output/GitHub writes/discovery/scheduling/cloud | Forbidden/outside this admission-preview slice, not granted by these fixes.                                                 |
| Disk-byte retention, pruning/reset/replay-key migration                             | Deferred; row ceilings and preservation of known keys remain unchanged.                                                     |
| Independent upstream download or repeat historical gates/archives                   | Not performed. New source gets new gates/controls; old records stay historical. Frozen install is not a zero-network claim. |

The controller resumes Mill for scoped rereview, then owns final verification and
integration choice. No push, merge, deployment or live rehearsal is authorized.
