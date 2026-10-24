# Private Executor Invocation And Offline Approval

Owner selected the signed Queue design on 2026-10-24. Preparation only; no
resources, credentials, deployment or hosted activation are authorized here.

## Decision

Use the authenticated Cloudflare Queues REST API as the proposed operator entry
to a private Worker. The control Worker has no routes, custom domain, workers.dev
or preview URL. Queue publication uses a separately reviewed account-scoped
Queues Write token in the trusted operator process, never the image or payload.
The existing DNS/tunnel/GitHub token is not assumed suitable and is not read.

This removes the missing local-operator-to-private-Worker hop: a service binding
alone only connects Workers. An Access-protected public gateway would introduce
a new public hostname contrary to the current isolation scope. Remote preview
invocation would violate the disabled-preview requirement. Neither is substituted.

The pinned Alchemy beta.83 source includes `Queues.Queue`, `Queues.Consumer`,
consumer `batchSize`, `maxConcurrency`, `maxRetries`, a dead-letter queue, and an
HTTP producer with Queues Write authorization. This is installed-source evidence,
not a compiled/deployed stack or account eligibility result. Keep Alchemy pinned.

## Authentication And Authorization

Cloudflare authenticates API publication; do not infer operator identity from a
Queue message ID, body field or publish success. Verify an Ed25519 approval using
a trusted public key outside the message/worksheet. The signature covers the
exact UTF-8 worksheet bytes prefixed by
`ceirean.hosted-executor.approval.v1\n`. Whitespace edits require re-signing.
No private key is generated or loaded by the runner. Tests use ephemeral keys.

The worksheet binds operator, account, stage, session, operation, fixed source,
reviewed recipe, final image, toolchain/harness/payload digests, command inventory,
resource tier, spending allowance, time window and cleanup owner/history. Strict
schemas reject arbitrary argv, extra fields, unresolved images, changed pins,
expanded limits and unconfirmed prior cleanup even if the worksheet is signed.
The USD 5 allowance is an operator stop budget, **not** a provider hard spending cap.
Metadata matches do not verify payload contents, provenance or actual provider caps.

The current Queue envelope has exactly one inert purpose,
`InspectOfflineApproval`. It reuses the runner verifier and never dispatches,
acknowledges, reads evidence or returns an executor capability. Unsupported Start,
cancel or other verbs are rejected rather than borrowed from driver operations.
Future actuating commands need distinct action/audience-bound signed envelopes
and review; do not relabel this inspection message as execution authority.

## Delivery And Lifetime

Queues delivery is at least once and asynchronous. Proposed wiring is one ingress
queue, one dead-letter queue and one private consumer with batch size/concurrency
one. Those settings do not establish global job uniqueness. Before any Start
adapter is connected, durable session/operation deduplication must survive Worker
restarts and delayed/reordered deliveries; Task 3A's process-local Ref is insufficient.
An API 200 is publication only, not allocation, completion or cleanup evidence.

The job's remote lifetime owns absolute deadlines and teardown independently of
the operator connection. Queue delivery latency cannot be an emergency-stop SLA.
Cancellation/close need a separately reviewed signed control path valid through
the cleanup window, including after execution approval expires. Evidence export
and status transport also remain to be implemented and qualified. A dead-letter
queue is not proof of cleanup and must not trigger automatic replacement jobs.
The consumer must durably hand off ownership before acknowledging, not rely on a
Worker fiber surviving acknowledgement or wait for a 45-minute job inside the
Queue callback. Task 3A's scoped simulation is not that durable hosted owner.

## Runner Boundary

`scripts/run-hosted.ts` accepts only
`--dry-run --worksheet PATH --approval PATH`, invoked with `bun --no-env-file`.
It reads bounded regular files without following final-component symlinks, checks complete reads,
decodes UTF-8/JSON without runtime module imports, and emits finite redacted reports.
There is no send, execute, build, deploy, URL, token or caller-supplied trust flag.
It accepts no transport/allocator capability. Errors never include file contents,
paths, signatures, keys, environment values or exception messages.

The committed trust boundary is deliberately `None`: no real operator public key,
account, session or resolved input inventory has been approved. Environment flags
cannot configure or activate it. A future reviewed trust configuration must stay
separate from operator-controlled worksheets; do not add a self-authorizing
`--trust` file. A synthetic matching signature yields `OfflinePlan`, approval
`Matched`, activation `Blocked`, never Ready or exit 0.

Exit 64 rejects syntax; 1 refuses inputs/approval; 2 reports a blocked dry-run.
The timeout is five seconds for local file/verification work, not a hosted deadline.
Partial reads fail closed. No environment is forwarded to a child, cloud API or
executor. The runner is not a scrubber for an already launched shell: always use
the documented no-dotenv invocation.

The Queue inspection API consumes decoded JSON data, not arbitrary in-process
objects with getters/proxies. Such objects may cause defects; they are not the
serialized Queue boundary. The reader does not claim parent-directory containment
or filesystem race qualification. It retains immutable loaded bytes and fails
closed on observed size/short-read/tail disagreement. UTF-8 BOMs are preserved
for JSON refusal rather than silently stripped before signature verification.

## Remaining Gates

A subsequent [local-only proof](../../assessments/local-executor-invocation.md)
now exercises a guarded Worker/Queue stack and durable inspection replay. No
hosted stack, token, signing-key enrollment, remote Queue delivery, container
adapter, durable execution admission, status/export path or final image exists
from this work. Private invocation remains **hosted-unverified**. Final
image/payloads, Chromium sandbox safety, provider limits, current cost/entitlement,
separate build approval and a filled session worksheet remain blockers. Preparing
this design and validator does not check off the live SDK integration task.

## Primary Evidence

- [Authenticated HTTP publication](https://developers.cloudflare.com/queues/examples/publish-to-a-queue-via-http/)
- [Push API and accepted permissions](https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/push/)
- [At-least-once delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Workers Web Crypto Ed25519 support](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- Installed beta.83 source: `alchemy/src/Cloudflare/Queues/{Consumer,WriteQueueHttp}.ts`
  and `alchemy/src/Cloudflare/Workers/Worker.ts`. No unpinned latest-Alchemy API is used.
