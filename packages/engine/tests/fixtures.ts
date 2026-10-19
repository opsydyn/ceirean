import { decideCancellation, decideQualification } from '@leviathan/domain';
import { Match } from 'effect';

import { makeEvidenceCase, makeFrozenRun } from '../../domain/tests/fixtures.ts';
import type { RunSnapshot } from '../src/contracts.ts';

export { makeEvidenceCase, makeFrozenRun };

export function makeSnapshot(): RunSnapshot {
  return {
    revision: 7,
    state: makeFrozenRun(),
    contract: makeEvidenceCase().contract,
    history: [],
  };
}

export function makeQualifiedChange() {
  const snapshot = makeSnapshot();
  const decision = decideQualification(
    snapshot.state,
    snapshot.contract,
    makeEvidenceCase().receipt,
    999,
  );
  return Match.value(decision).pipe(
    Match.tag('Accepted', ({ state, facts }) => ({
      runId: snapshot.state.runId,
      expectedRevision: 7,
      state,
      facts,
    })),
    Match.tag('Refused', () => {
      throw new TypeError('Invalid qualification fixture');
    }),
    Match.exhaustive,
  );
}

export function makeCancelledChange() {
  const snapshot = makeSnapshot();
  const decision = decideCancellation(snapshot.state, 999);
  return Match.value(decision).pipe(
    Match.tag('Accepted', ({ state, facts }) => ({
      runId: snapshot.state.runId,
      expectedRevision: 7,
      state,
      facts,
    })),
    Match.tag('Refused', () => {
      throw new TypeError('Invalid cancellation fixture');
    }),
    Match.exhaustive,
  );
}
