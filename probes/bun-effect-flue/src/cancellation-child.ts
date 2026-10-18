import { createRecorderBridge } from './composition.ts';
import { decideFixture, type FixtureRun } from './fixture.ts';
import { openFlueProbe, ProbeError, type ProbeHandle, type ProbeReply } from './flue-probe.ts';

async function main() {
  const [mode, stateDir] = process.argv.slice(2);
  if ((mode !== 'read-only' && mode !== 'abort') || !stateDir) throw new Error('Invalid cancellation probe arguments');
  const bridge = createRecorderBridge();
  let probe: ProbeHandle | undefined;
  let result: object;
  try {
    await bridge.count();
    probe = await openFlueProbe({ stateDir, instanceId: 'cancellation-fixture', mode: 'blocked', record: bridge.record });
    const receipt = await probe.dispatch('pause-on-barrier');
    await probe.waitForBlockedResponse();
    const controller = new AbortController();
    const reading = probe.read(receipt, mode === 'read-only' ? controller.signal : undefined)
      .then((reply) => ({ ok: true as const, reply }), (cause: unknown) => ({ ok: false as const, cause }));
    if (mode === 'read-only') controller.abort(new Error('Synthetic reader cancellation'));
    else await probe.abort();
    const outcome = await reading;
    const expected = mode === 'read-only' ? 'read_cancelled' : 'aborted';
    if (outcome.ok || !(outcome.cause instanceof ProbeError) || outcome.cause.code !== expected) {
      throw new Error('Unexpected cancellation outcome');
    }
    if (mode === 'read-only') {
      const frozen: FixtureRun = { phase: 'frozen', generation: 1, digest: 'candidate-a',
        deadlineMs: 2000000000000, spentMicros: 12345, repairs: 1 };
      const cancelled = decideFixture(frozen, { type: 'cancel', generation: 1 });
      if (!cancelled.ok) throw new Error('Fixture cancellation rejected');
      probe.releaseBlockedResponse();
      probe.releaseBlockedResponse();
      const reply: ProbeReply = await probe.read(receipt);
      const lateDecision = decideFixture(cancelled.state, { type: 'verify', generation: 1, digest: 'candidate-a' });
      result = { readerOutcome: expected, submissionOutcome: 'completed', reply, lateDecision,
        retainedStateIdentity: lateDecision.state === cancelled.state };
    } else {
      result = { readerOutcome: expected, submissionOutcome: 'aborted' };
    }
  } finally {
    try { await probe?.stop(); } finally { await bridge.dispose(); }
  }
  console.log(JSON.stringify({ ...result, lifecycle: bridge.lifecycle(), cleanup: 'confirmed' }));
}

try { await main(); }
catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Cancellation probe failed');
  process.exitCode = 1;
}
