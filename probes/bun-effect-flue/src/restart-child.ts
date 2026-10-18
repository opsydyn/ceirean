import { join } from 'node:path';
import { createRecorderBridge } from './composition.ts';
import type { FixtureRun } from './fixture.ts';
import { openFlueProbe, type ProbeHandle } from './flue-probe.ts';
import { openLedger } from './ledger.ts';

async function main() {
  const [mode, stateDir] = process.argv.slice(2);
  if ((mode !== 'write' && mode !== 'read') || !stateDir) throw new Error('Invalid restart probe arguments');
  const ledger = openLedger(join(stateDir, 'app.db'));
  const bridge = createRecorderBridge();
  let probe: ProbeHandle | undefined;
  try {
    const saved = mode === 'read' ? ledger.load() : null;
    if (mode === 'read' && !saved) throw new Error('Missing ledger row');
    probe = await openFlueProbe({ stateDir, instanceId: 'restart-fixture', mode: 'tool', record: bridge.record });
    if (saved) {
      const reply = await probe.read(saved.receipt);
      console.log(JSON.stringify({ ...saved, reply, providerCalls: probe.providerCalls() }));
    } else {
      const receipt = await probe.dispatch('persisted-token');
      const reply = await probe.read(receipt);
      const state: FixtureRun = { phase: 'frozen', generation: 1, digest: 'candidate-a',
        deadlineMs: 2000000000000, spentMicros: 12345, repairs: 1 };
      ledger.save(state, receipt);
      console.log(JSON.stringify({ state, receipt, reply, providerCalls: probe.providerCalls() }));
      console.log('COMMITTED');
      // Keep the writer alive for the parent's deliberate SIGKILL; no graceful stop.
      await new Promise<void>(() => { setInterval(() => {}, 1000); });
    }
  } finally {
    try { await probe?.stop(); } finally {
      try { await bridge.dispose(); } finally { ledger.close(); }
    }
  }
}

try { await main(); }
catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Restart probe failed');
  process.exitCode = 1;
}
