# Local GitHub Ingress Final Fix

Status: fix wave complete, pending controller-scoped rereview. Tasks 1-7 are
accepted; whole-branch acceptance, final controller verification and integration
choice remain pending. No merge, push, deployment or live rehearsal claim.
Personal execution only: no agents or reviewers were dispatched.

## Source And Evidence Identity

- Actual checkout: `/private/tmp/leviathan-compatibility`, `codex/local-github-ingress`.
- Fix base: `36de5ba28e8921952c26a2fb6e7c9728bd305a3d`.
- Verified source commit: `5e531ae60f7f11e91310e24965e2a74805d4d173`.
- Tested source tree: `42f3d7af0bcc7b3716e1adf8081373d45ffc5899`.
- Source inventory SHA256: `83db0a82dc238faaf906a26c33962eb460ba9d82b8dc65042b8304a69dc459c2`.
- Unchanged lock SHA256: `8cb4d58bd88280daee28101e542cd9b7120ec7ee63dd5094daf59c2a45fddf59`.

`source.json` covers the original 166 executable/configuration files plus three
new test/helper files (169 total). It excludes docs, evidence and scratch, so it
does not hash itself. `tooling.json` separately hashes the actual qualification
tool, not itself or this report. The later documentation/evidence-only commit is
separate from the tested source commit; its identity belongs to Git history,
not a self-referential manifest field. Source is rechecked after controls and
again after evidence packaging.

## Fixed Findings

| Item | Result                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1   | Start acquires ownership, reads the validated local snapshot and compares complete LocalIngressPolicy schema equivalence before authority acquisition/listening. Disagreement fails closed, installs nothing, makes no API call and unwinds ownership. Configure/status intentionally bypass equality. Revision and same-revision identity/allowlist/profile mismatches, matching startup and reacquisition are covered. |
| I2   | Typed Refused output remains structured JSON and now yields exit 1 through CLI/main. AuthorityChanged, RevisionReused and CapacityExceeded plus Installed success are covered at that boundary. No refusal exception was invented.                                                                                                                                                                                       |
| I3   | Read-only local status projects bounded current/history policy and decision identity/reason/provenance/revision/minimal permission facts from the same validated transaction. Admitted, local-refused, live-refused, active-owner and corruption cases are covered. No token, secret, raw body, receipt digest, display-name or monotonic lease data is exposed. Public routes/responses are unchanged.                  |
| M1   | Known memory receipts retain original display metadata, with receipt/record immutability and zero-extra-authority assertions.                                                                                                                                                                                                                                                                                            |
| M2   | Two fresh stores process equivalent opposite-order histories containing both identical and alternate delivery IDs. Outcomes are sorted by command key and incidental decision/evidence IDs normalized consistently. No pre-admitted priming. Coverage characterization only, not a claimed production ordering defect.                                                                                                   |
| M3   | Named app/adapter readiness reads use a bounded 4096-byte newline accumulator, EOF/overflow refusal and five-second watchdog. Split JSON/UTF-8 and a short watchdog test pass. Existing 30000ms workspace timeout and parent phase watchdogs remain unchanged; no retry or timeout increase.                                                                                                                             |
| M4   | All canonical outer archives are payload-only USTAR with complete indexed regular-member set and hash checks. No unexpected regular members, AppleDouble or PAX/xattr headers remain in these outer archives. Historical nested Task 6 bytes are preserved as an explicitly inspected exception.                                                                                                                         |

## Fresh Qualification

All commands ran sequentially from this checkout under minimal explicit
PATH/HOME/TMPDIR, with no credentials. Frozen install used ignore-scripts.
Moon gates used force/no-actions, no cache, no retries and no env-file loading.
The old 916-test baseline was not rerun before changes.

| Workspace        | Passing tests | Assertions |
| ---------------- | ------------: | ---------: |
| domain           |           211 |        965 |
| engine           |           301 |       2723 |
| probe            |            36 |        104 |
| github-admission |           135 |       1828 |
| github-adapter   |           199 |       2777 |
| github-ingress   |            53 |        598 |
| Total            |           935 |       8995 |

Frozen install, root lint/format, all six strict typechecks, all six suites,
working/staged whitespace and final integrity exited 0. Lint reported zero
warnings/errors. All 141 Effect rules remain universal errors; dependency pins,
Moon 2.5.4, root override, strict tsconfigs and both approved patch hashes remain
unchanged. All six workspaces resolve one physical Effect 4.0.5 installation.

Primary law accounting remains 24000 new plus 168000 legacy, separately from
controls and diagnostic/shrink tests. Existing seeds 0/1/163, 1000 runs/seed,
size 50, maxShrinks 1000 and maxDiscards 10000 are unchanged. Primary laws passed
without failure shrinking. M2 changes coverage, not registration/case budgets.

EvidenceBinding, PolicyRevision, ReplayUniqueness, TransactionRollback and
AbortOwnership each produced two exit-1 intended assertions on the new source,
then exact source restoration and exit-0 GREEN. Each manifest binding includes
the new source/test hash and before/mutated/restored identities. No old b7
control/source binding was reused and no control mutation was committed.

I1/I3 have meaningful preimplementation assertion REDs. I2's qualifying RED is
`i2-meaningful-red.log`: three expected-1/actual-0 exits and Installed success.
Earlier SQLite test-open errors remain retained and nonqualifying. M1 has a
metadata preservation RED. M2 and the readiness helper's initial development
failures are classified honestly in [ledger.md](ledger.md), not recast as
production TDD evidence. Sandbox-denied binds were not qualifying test results;
authorized synthetic ephemeral-bind runs and the complete gates passed.

## Archive And Historical Boundaries

The 212 historical Tasks 1-6 payloads, 154 original Task 7 payloads and four
docs-verification logs are byte-preserved. Original member indices are unchanged;
only outer identities/packaging metadata are updated. `archive-repackaging.json`
records all old/new outer hashes and removed metadata counts (212, 156 and 4).
All original b7 qualification records remain historical; the copied manifest
is byte-identical to the base checkout, not relabelled as new-source evidence.

The nested `task-6-evidence/raw-gate-logs.tar.gz` remains exactly SHA256
`7d9b86923cfc50b4115830ac81dce45afcd30bdabb0bf212da9142910a50f734`.
Inspection found 56 regular members: 28 raw log payloads and 28 AppleDouble
members, plus PAX headers on 28 payload members. This is a historical artifact
exception, not a metadata-free nested archive claim. It was not rewritten.

New raw logs/bindings are packaged metadata-free in `raw.tar.gz`; `raw-index.json`
enumerates every regular member and hashes every byte. Local uncompressed copies
are kept in ignored workspace scratch, never force-added. Current manifest,
report, runbook, assessment and plan use accepted-Task-7/pending-whole-branch
semantics. Original scratch progress/reviews and original historical reports
remain untouched.

## Handoff

The [disposition ledger](ledger.md) preserves the already accepted Moon notice/no
upgrade decision, Task 5 historical TDD gap, Task 6 summary-versus-raw distinction
and every reviewer Declined To Judge boundary. None is a runtime waiver.
No dependency, rule waiver, extra runtime, manual Effect channel, helper
provisioning, Node controller, environment escape, real credential, GitHub API,
tunnel, push or merge was introduced.

The controller resumes Mill for scoped rereview of these fixes and fresh
evidence, then handles final verification and integration choice. Stop here;
this report does not authorize another feature wave or integration.
