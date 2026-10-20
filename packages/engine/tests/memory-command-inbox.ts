import {
  AdmissionDraft,
  AdmissionRecord,
  AuthorityObservation,
  VerifiedCommand,
  commandKey,
  transportKey,
  decideAssessment,
  type AdmissionReason,
  type AdmissionReply,
} from '@leviathan/domain';
import { Match, Option, Result, Schema } from 'effect';

import type { CommandInboxDriver } from '../src/command-inbox-contracts.ts';
import { sameCommandFacts } from '../src/command-inbox-factory.ts';
import { authorityFixture } from './command-fixtures.ts';

const sameDecision = Schema.toEquivalence(AdmissionDraft.fields.decision);

export function makeMemoryCommandInbox() {
  let authority: AuthorityObservation = authorityFixture();
  let clockFloor = 0;
  let loads = 0;
  let commits = 0;
  const records = new Map<string, AdmissionRecord>();
  const receipts = new Map<string, VerifiedCommand>();
  function unrecorded(reason: AdmissionReason): AdmissionReply {
    return { _tag: 'Unrecorded', decision: { _tag: 'Rejected', reason } };
  }
  function commit(draft: AdmissionDraft) {
    commits += 1;
    const verified = structuredClone(draft.verified);
    const key = commandKey(verified.candidate);
    const delivery = transportKey(verified.receipt.ingressScopeId, verified.receipt.deliveryId);
    const priorReceipt = Option.fromNullishOr(receipts.get(delivery));
    const deliveryConflict = Option.exists(
      priorReceipt,
      (prior) =>
        prior.receipt.rawBodyDigest !== verified.receipt.rawBodyDigest ||
        prior.receipt.eventName !== verified.receipt.eventName ||
        !sameCommandFacts(prior.candidate, verified.candidate),
    );
    function receiptSpace() {
      return Option.isSome(priorReceipt) || receipts.size < 1024;
    }
    function duplicate(record: AdmissionRecord) {
      function referenceOriginal() {
        Option.match(priorReceipt, {
          onNone: () => receipts.set(delivery, structuredClone(verified)),
          onSome: () => receipts,
        });
        return { _tag: 'Duplicate' as const, record: structuredClone(record) };
      }
      function withReceiptSpace() {
        return Match.value(receiptSpace()).pipe(
          Match.when(false, () => unrecorded('CapacityExceeded')),
          Match.orElse(referenceOriginal),
        );
      }
      return Match.value(sameCommandFacts(record.candidate, verified.candidate)).pipe(
        Match.when(false, () => unrecorded('CommandConflict')),
        Match.orElse(withReceiptSpace),
      );
    }
    function fresh() {
      const now = authority.atMs;
      const current = decideAssessment({
        candidate: verified.candidate,
        authority: authority.state,
        nowMs: now,
      });
      const evaluated = decideAssessment({
        candidate: verified.candidate,
        authority: authority.state,
        nowMs: draft.evaluatedAtMs,
      });
      const validClock = [
        Number.isSafeInteger(now),
        now >= 0,
        now >= draft.evaluatedAtMs,
        now >= clockFloor,
      ].every(Boolean);
      const unchanged = Match.value(current).pipe(
        Match.tag('Ignored', () => false),
        Match.orElse((decision) => sameDecision(decision, draft.decision)),
      );
      const evaluationMatches = Match.value(evaluated).pipe(
        Match.tag('Ignored', () => false),
        Match.orElse((decision) => sameDecision(decision, draft.decision)),
      );
      function changedDecision() {
        return Match.value(current).pipe(
          Match.tag('Rejected', 'Ignored', (decision) => ({
            _tag: 'Unrecorded' as const,
            decision,
          })),
          Match.orElse(() => unrecorded('AuthorityChanged')),
        );
      }
      function recordFresh(): AdmissionReply {
        const record = AdmissionRecord.make({
          decisionId: String(records.size + 1),
          commandKey: key,
          candidate: verified.candidate,
          decision: draft.decision,
          evaluatedAtMs: draft.evaluatedAtMs,
          committedAtMs: now,
          authorityRevision: authority.state.revision,
        });
        records.set(key, structuredClone(record));
        receipts.set(delivery, structuredClone(verified));
        clockFloor = now;
        return { _tag: 'Recorded', record: structuredClone(record) };
      }
      return Match.value(true).pipe(
        Match.when(
          () => draft.expectedAuthorityRevision !== authority.state.revision,
          () => unrecorded('AuthorityChanged'),
        ),
        Match.when(
          () => !validClock,
          () => unrecorded('InvalidClock'),
        ),
        Match.when(() => !unchanged || !evaluationMatches, changedDecision),
        Match.when(
          () => records.size >= 256 || !receiptSpace(),
          () => unrecorded('CapacityExceeded'),
        ),
        Match.orElse(recordFresh),
      );
    }
    const priorRecord = Option.fromNullishOr(records.get(key));
    function resolveCommand() {
      return Option.match(priorRecord, { onNone: fresh, onSome: duplicate });
    }
    const reply = Match.value(deliveryConflict).pipe(
      Match.when(true, () => unrecorded('DeliveryConflict')),
      Match.orElse(resolveCommand),
    );
    return Result.succeed(structuredClone(reply));
  }
  const driver: CommandInboxDriver = {
    loadAuthority: () => {
      loads += 1;
      return Result.succeed(structuredClone(authority));
    },
    commit,
  };
  return {
    driver,
    records: () => structuredClone([...records.values()]),
    receipts: () => structuredClone([...receipts.values()]),
    calls: () => ({ load: loads, commit: commits }),
    setAuthority: (next: AuthorityObservation) => {
      authority = structuredClone(next);
    },
    observation: () => structuredClone(authority),
  };
}
