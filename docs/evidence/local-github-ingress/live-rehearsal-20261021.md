# First Live Rehearsal: Stopped On Operational Failure

Outcome: **not qualified**. The first real issue-comment delivery returned HTTP
503 / `OperationalFailure`. The approved stop rule was applied immediately;
there was no live retry, redelivery, second comment or restart test.

## Scope And Authority

- Source: main at `e378ee4`, clean before operations. No product source changed.
- Approved window: 21 October 2026, 19:10-19:35 UK (18:10-18:35 UTC).
- Maximum public connectivity: 15 minutes. Dedicated supervisors additionally
  enforced a 19:30 UK hard stop. Actual connector lifetime was approximately
  19:20:54-19:22:40 UK, under two minutes.
- Target: `opsydyn/fold-kit-experiments`, repository ID `1247366304`;
  issue [57](https://github.com/opsydyn/fold-kit-experiments/issues/57), ID `5965919353`.
- App `opsydyn-ceirean`, ID `5407709`; installation `173668921`.
- Operator `opsydyn`, ID `257329185`, verified through authenticated GitHub API.
- App API verified Issues read, Metadata read and `issue_comment` subscribed.
  No additional permissions were requested or granted.
- Endpoint: `https://ceirean-hooks.opsydyn.xyz/webhook`, with TLS verification
  enabled and signing secret supplied directly from its protected local file.
  No secret values or raw webhook bodies are retained in this evidence.

## Observations

1. Stopped status showed zero decisions, receipts and evidence, with one policy
   revision and the Disabled profile. Port 8787 had no listener. A protected
   backup of the database, bound ownership sidecar and local configuration was
   created under the external state root's `backups/rehearsal-20261021` directory.
   The stopped WAL was empty. Backup files were mode 0600, directory mode 0700.
2. GitHub sudo authentication was completed by the operator. Initial hook config
   API reads returned 404 until an inactive URL was saved through App settings.
   GitHub generated a setup ping at 18:19:42.786 UTC before the connector ran;
   that ping returned 530 and is not admission evidence.
3. The root environment was explicitly loaded for the existing Effect Config
   redacted CF_TOKEN validator after an infrastructure-CWD invocation found no
   token. A tunnel-specific connector token was stored only in a protected file.
4. The stopped `configure` command installed the temporary Enabled profile with
   fresh revisions. Dedicated foreground listener and connector started. Other
   public paths returned 404; an unsigned empty webhook POST returned 415.
   These routing checks do not establish successful signed admission.
5. GitHub delivery was enabled only after configuring the signing secret. One
   exact `/ceirean assess` comment was posted:
   [comment A](https://github.com/opsydyn/fold-kit-experiments/issues/57#issuecomment-6323353559).
6. Its `issue_comment/created` delivery at 18:22:04.414 UTC returned HTTP 503 in
   2.45 seconds. The sanitized public code was `OperationalFailure`.
   Delivery ID: `3849594057495937024` (retain as a decimal string, not a JS number).
   GUID: `4ef9ab60-cd7c-11f1-9042-24252738a30b`.
   Delivery detail confirmed issue 57 and comment ID `6323353559`.
7. Local status still showed zero decisions, receipts and evidence. This is an
   uncommitted operational failure, not a permission-negative result. The root
   cause has not been established. Unchanged evidence does not prove that no
   outbound authority requests occurred.

## Teardown Verification

- GitHub Active was unchecked and saved, then verified unchecked after reload.
  The configured URL and secret remain saved but delivery is disabled.
- Dedicated connector PID 76442 and listener PID 76403 received SIGTERM at
  approximately 18:22:40 UTC. Both supervised sessions reported exit code 0.
  The unrelated existing cloudflared process was not stopped or modified.
- Port 8787 was verified to have no listening socket.
- Cloudflare API independently reported zero tunnel connections.
- Stopped `configure` installed fresh revision
  `ceirean-rehearsal-20261021-disabled-1` and policy revision
  `ceirean-admission-20261021-disabled-1`, with profile Disabled.
- Final status: **0 decisions, 0 receipts, 0 evidence, 3 policy revisions**.
  The ledger was not reset or restored from backup.

## Missing Acceptance Evidence And Next Step

No admitted preview, live authority evidence, duplicate delivery, restart replay
or fresh Disabled-profile rejection was demonstrated. Only comment A was posted;
comment B and all redeliveries were deliberately omitted after the stop condition.
No assessment, upgrade, worker, PR or publication was executed.

Next: diagnose `OperationalFailure` offline, add a focused regression test and
verify the fix before proposing a new explicitly approved live window. Keep the
connector, listener and webhook delivery off in the meantime. Fallow remains a
separate queued follow-up; it was not installed or run during this rehearsal.

## Offline Follow-up

The original runtime cause cannot be recovered from the generic saved response.
Independent offline investigation reproduced the same symptom for denied HTTP,
invalid token response, excessive token grants and request timeout. None proves
which occurred in this rehearsal. Existing authority and ingress fixtures passed;
they validate our boundary behavior, not the real GitHub response contract.

The confirmed diagnostic defect was loss of the adapter's finite error phase and
code at the admission/protocol boundary. Offline regression tests first failed
for all five authority phases, then exposed correlation-ID replacement during
response projection. The fix adds only allowlisted local diagnostics with the
public response ID. A property-based test exercises 100 generated phase/code and
extra-text inputs; tests also exclude raw defects and forged error fields.

Review additionally reproduced stderr backpressure delaying the refusal and
breaking correlation at the listener deadline. A stalled-sink regression failed
before adding a request-cancellable 100ms logging bound. Diagnostic logging is
awaited within that bound, not detached; listener timeout IDs remain correlated.
The stuck-native-shutdown test now expects the finite diagnostic before its
separate `FailedShutdown` record.

This is a verified observability/correlation repair, **not a verified repair of
the original live 503**. No real credential, external API or production ledger
was used during offline diagnosis. No live service or webhook was activated.
Do not resume or redeliver the failed comment without a new approved window.

Final offline verification: `bun run check` passed with unchanged universal
rules; `moon run :typecheck --force --no-actions` passed all seven workspaces;
`moon run :test --force --no-actions` passed 955 tests with zero failures.
Independent review cleared the bounded diagnostic sink after reproducing both
backpressure and caller abort without retained stderr listeners. The real local
configuration remained Disabled and port 8787 had no listener.
