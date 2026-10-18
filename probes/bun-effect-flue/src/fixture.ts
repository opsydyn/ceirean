export type FixtureRun = Readonly<{
  phase: 'pending' | 'frozen' | 'verified' | 'cancelled';
  generation: number;
  digest: string | null;
  deadlineMs: number;
  spentMicros: number;
  repairs: number;
}>;

export type FixtureCommand =
  | Readonly<{ type: 'freeze'; generation: number; digest: string }>
  | Readonly<{ type: 'verify'; generation: number; digest: string }>
  | Readonly<{ type: 'cancel'; generation: number }>;
export type FixtureRejection = 'InvalidPhase' | 'DigestMismatch' | 'StaleGeneration';
export type FixtureDecision =
  | Readonly<{ ok: true; state: FixtureRun }>
  | Readonly<{ ok: false; reason: FixtureRejection; state: FixtureRun }>;

export function decideFixture(state: FixtureRun, command: FixtureCommand): FixtureDecision {
  const reject = (reason: FixtureRejection): FixtureDecision => ({ ok: false, reason, state });
  if (command.generation !== state.generation) return reject('StaleGeneration');
  switch (command.type) {
    case 'cancel':
      return state.phase === 'pending' || state.phase === 'frozen'
        ? { ok: true, state: { ...state, phase: 'cancelled' } }
        : reject('InvalidPhase');
    case 'freeze':
      return state.phase === 'pending'
        ? { ok: true, state: { ...state, phase: 'frozen', digest: command.digest } }
        : reject('InvalidPhase');
    case 'verify':
      if (state.phase !== 'frozen') return reject('InvalidPhase');
      if (state.digest !== command.digest) return reject('DigestMismatch');
      return { ok: true, state: { ...state, phase: 'verified' } };
  }
}
