import { AdmissionReply } from '@leviathan/domain';
import { Match, Schema } from 'effect';

import { openAdmissionProbe } from './composition.ts';
import { authorityFixture, signedCommandFixture } from './fixture.ts';
import { RestartPhase, RestartResult } from './report.ts';

const Arguments = Schema.Tuple([
  Schema.Literals(['committed', 'uncommitted', 'read']),
  Schema.String.check(Schema.isMinLength(1)),
]);
const emitPhase = Schema.encodeSync(Schema.fromJsonString(RestartPhase));
const emitResult = Schema.encodeSync(Schema.fromJsonString(RestartResult));
function writeLine(line: string) {
  const writer = Bun.stdout.writer();
  writer.write(`${line}\n`);
  writer.flush();
}
async function main() {
  const [mode, file] = Schema.decodeUnknownSync(Arguments)(Bun.argv.slice(2));
  const isReader = Match.value(mode).pipe(
    Match.when('read', () => true),
    Match.orElse(() => false),
  );
  const delivery = Match.value(isReader).pipe(
    Match.when(true, () => 'restart-delivery'),
    Match.orElse(() => 'delivery-1'),
  );
  const fixture = await signedCommandFixture(delivery);
  function fault(point: string) {
    const target = Match.value(mode).pipe(
      Match.when('committed', () => 'AfterCommit'),
      Match.when('uncommitted', () => 'AfterDecision'),
      Match.orElse(() => 'never'),
    );
    function pause() {
      const phase = Schema.decodeUnknownSync(RestartPhase)({ phase: point });
      writeLine(emitPhase(phase));
      // A synchronous, child-local barrier holds this precise native phase until SIGKILL.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
      throw new TypeError('Restart phase watchdog expired');
    }
    const paused = Match.value(point).pipe(
      Match.when(target, pause),
      Match.orElse(() => undefined),
    );
    void paused;
  }
  const initial = Match.value(isReader).pipe(
    Match.when(true, () => ({})),
    Match.orElse(() => ({ initialAuthority: authorityFixture().state })),
  );
  const app = await openAdmissionProbe({
    file,
    create: !isReader,
    ingressScopeId: 'fixture-app',
    ...initial,
    secret: fixture.secret,
    limits: { decisions: 256, receipts: 1024, authorityRevisions: 256 },
    nowMs: () => 1000,
    fault,
  });
  async function replay() {
    const response = await app.fetch(fixture.request);
    const reply = Schema.decodeUnknownSync(AdmissionReply)(await response.json());
    function recorded({
      _tag,
      record,
    }: Extract<AdmissionReply, { readonly _tag: 'Recorded' | 'Duplicate' }>) {
      return Match.value(record.decision).pipe(
        Match.tag('AdmittedPreview', () =>
          RestartResult.make({ disposition: _tag, decisionId: record.decisionId }),
        ),
        Match.orElse(() => {
          throw new TypeError('Restart did not recover admission');
        }),
      );
    }
    const result = Match.value(reply).pipe(
      Match.tag('Recorded', 'Duplicate', recorded),
      Match.orElse(() => {
        throw new TypeError('Restart did not record');
      }),
    );
    writeLine(emitResult(result));
  }
  await replay().finally(() => app.dispose());
}

await main().catch(() => {
  process.exitCode = 1;
});
