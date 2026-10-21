import {
  AdmissionDecision,
  ClockReading,
  LiveAdmissionRecord,
  LocalPolicyObservation,
  commandKey,
  decideLiveAdmission,
  transportKey,
  type AdmissionReason,
  type LiveAdmissionDraft,
  type LiveAdmissionReply,
  type ReplayResolution,
  type VerifiedCommand,
} from '@leviathan/domain';
import { Match, Option, Result, Schema } from 'effect';

import { sameCommandFacts } from '../src/command-inbox-factory.ts';
import type { LiveInboxDriver } from '../src/live-admission-factories.ts';
import { verifiedCommandFixture } from './command-fixtures.ts';

export function liveFixture() {
  const verified = verifiedCommandFixture();
  const policy = {
    revision: 'local-1',
    ingressScopeId: 'fixture-app',
    appId: 77,
    installationId: 11,
    ownerId: 33,
    repositoryId: 22,
    profile: { _tag: 'Enabled' as const, profileId: 'foldkit', profileRevision: 'profile-1' },
    policyRevision: 'policy-1',
    allowedOperatorIds: [66, 67],
  };
  const at = { wallMs: 1000, monotonicMs: 200 };
  return { verified, policy, at };
}

export function leaseFor(query: {
  readonly verified: VerifiedCommand;
  readonly policy: LocalPolicyObservation['policy'];
}) {
  return {
    startedMonotonicMs: 100,
    evidence: {
      evidenceId: `evidence-${query.verified.candidate.commentId}-${query.verified.candidate.operatorId}`,
      commandKey: commandKey(query.verified.candidate),
      appId: query.policy.appId,
      installationId: query.verified.candidate.installationId,
      ownerId: query.verified.candidate.ownerId,
      repositoryId: query.verified.candidate.repositoryId,
      operatorId: query.verified.candidate.operatorId,
      localPolicyRevision: query.policy.revision,
      policyRevision: query.policy.policyRevision,
      profileId: 'foldkit',
      profileRevision: 'profile-1',
      basePermission: 'write' as const,
      observedAtMs: 900,
      checkedAtMs: 1000,
      validUntilMs: 6900,
    },
  };
}

export function unrecorded(reason: AdmissionReason): LiveAdmissionReply {
  return { _tag: 'Unrecorded', decision: { _tag: 'Rejected', reason } };
}

export function makeMemoryLiveInbox() {
  const initial = liveFixture();
  let observation = LocalPolicyObservation.make({ policy: initial.policy, at: initial.at });
  let floor = 0;
  const records = new Map<string, LiveAdmissionRecord>();
  const receipts = new Map<string, VerifiedCommand>();
  function resolve(verified: VerifiedCommand): ReplayResolution {
    const key = commandKey(verified.candidate);
    const delivery = transportKey(verified.receipt.ingressScopeId, verified.receipt.deliveryId);
    const prior = Option.fromNullishOr(receipts.get(delivery));
    const record = Option.fromNullishOr(records.get(key));
    const conflict = Option.exists(
      prior,
      (receipt) =>
        receipt.receipt.rawBodyDigest !== verified.receipt.rawBodyDigest ||
        !sameCommandFacts(receipt.candidate, verified.candidate),
    );
    function duplicate(existing: LiveAdmissionRecord): ReplayResolution {
      function addReceipt(): ReplayResolution {
        receipts.set(delivery, structuredClone(verified));
        return { _tag: 'Duplicate', record: structuredClone(existing) };
      }
      function preserveReceipt(): ReplayResolution {
        return { _tag: 'Duplicate', record: structuredClone(existing) };
      }
      return Match.value(true).pipe(
        Match.when(
          () => !sameCommandFacts(existing.candidate, verified.candidate),
          () => ({ _tag: 'Conflict' as const, reason: 'CommandConflict' as const }),
        ),
        Match.when(
          () => Option.isNone(prior) && receipts.size >= 1024,
          () => ({ _tag: 'CapacityExceeded' as const }),
        ),
        Match.when(() => Option.isSome(prior), preserveReceipt),
        Match.orElse(addReceipt),
      );
    }
    function absent(): ReplayResolution {
      return Match.value(records.size >= 256 || receipts.size >= 1024).pipe(
        Match.when(true, () => ({ _tag: 'CapacityExceeded' as const })),
        Match.orElse(() => ({ _tag: 'Absent' as const })),
      );
    }
    return Match.value(conflict).pipe(
      Match.when(true, () => ({ _tag: 'Conflict' as const, reason: 'DeliveryConflict' as const })),
      Match.orElse(() => Option.match(record, { onNone: absent, onSome: duplicate })),
    );
  }
  function commit(draft: LiveAdmissionDraft) {
    function fresh(): LiveAdmissionReply {
      const { policy, at } = observation;
      const evidence = Match.value(draft).pipe(
        Match.when({ provenance: { _tag: 'LiveChecked' } }, (live) =>
          Option.some({
            evidence: live.provenance.evidence,
            startedMonotonicMs: live.startedMonotonicMs,
          }),
        ),
        Match.orElse(() => Option.none()),
      );
      const decision = decideLiveAdmission({ verified: draft.verified, policy, evidence, now: at });
      function recordFresh(): LiveAdmissionReply {
        const record = Schema.decodeUnknownSync(LiveAdmissionRecord)({
          decisionId: String(records.size + 1),
          commandKey: commandKey(draft.verified.candidate),
          candidate: draft.verified.candidate,
          decision: draft.decision,
          provenance: draft.provenance,
          localPolicyRevision: policy.revision,
          evaluatedAtMs: draft.evaluatedAtMs,
          committedAtMs: at.wallMs,
        });
        records.set(record.commandKey, structuredClone(record));
        receipts.set(
          transportKey(draft.verified.receipt.ingressScopeId, draft.verified.receipt.deliveryId),
          structuredClone(draft.verified),
        );
        floor = at.wallMs;
        return { _tag: 'Recorded', record: structuredClone(record) };
      }
      return Match.value(true).pipe(
        Match.when(
          () => policy.revision !== draft.expectedLocalRevision,
          () => unrecorded('AuthorityChanged'),
        ),
        Match.when(
          () =>
            ![
              Schema.is(ClockReading)(at),
              at.wallMs >= draft.evaluatedAtMs,
              at.wallMs >= floor,
              at.monotonicMs >= draft.evaluatedMonotonicMs,
            ].every(Boolean),
          () => unrecorded('InvalidClock'),
        ),
        Match.when(
          () => !Schema.toEquivalence(AdmissionDecision)(decision, draft.decision),
          () => unrecorded('AuthorityChanged'),
        ),
        Match.orElse(recordFresh),
      );
    }
    const reply = Match.value(resolve(draft.verified)).pipe(
      Match.tag('Absent', fresh),
      Match.tag('Duplicate', (duplicate) => duplicate),
      Match.tag('Conflict', ({ reason }) => unrecorded(reason)),
      Match.tag('CapacityExceeded', () => unrecorded('CapacityExceeded')),
      Match.exhaustive,
    );
    return Result.succeed(reply);
  }
  const driver: LiveInboxDriver = {
    loadPolicy: () => Result.succeed(structuredClone(observation)),
    resolveReplay: (verified) => Result.succeed(resolve(verified)),
    commit,
  };
  return {
    driver,
    records: () => structuredClone([...records.values()]),
    receipts: () => structuredClone([...receipts.values()]),
    observation: () => structuredClone(observation),
    setObservation: (next: LocalPolicyObservation) => {
      observation = structuredClone(next);
    },
  };
}
