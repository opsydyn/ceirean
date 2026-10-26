import { Context, Effect, Exit, FileSystem, Schema } from 'effect';

import { decodeReceipt, QualificationReceipt } from './contract.ts';
import { requireSupervisor } from './docker-process.ts';
import { admitEvidenceFiles, evidenceNames, hashEvidence } from './evidence-files.ts';
import { readProducerFile } from './producer.ts';
import { qualificationExitCode } from './receipt.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(QualificationReceipt));
const isDirectory = Schema.is(Schema.Literal('Directory'));
// The owning host fixes workspace; no dispatch/CLI destination or mount exists.
// Exclusive directory acquisition preserves collisions. Only completed delivery
// survives this scope, and the receipt is always written last.
export function makeQualificationOutput(workspace: string) {
  function deliver(
    source: string,
    receipt: QualificationReceipt,
    files: Effect.Success<ReturnType<typeof admitEvidenceFiles>>,
  ) {
    const state = { complete: false };
    function* write() {
      const fs = yield* FileSystem.FileSystem;
      yield* requireSupervisor((yield* fs.realPath(workspace)) === workspace);
      yield* requireSupervisor(isDirectory((yield* fs.stat(workspace)).type));
      const decoded = yield* decodeReceipt(receipt);
      yield* requireSupervisor(qualificationExitCode(decoded, files.admission) === 0);
      const receiptBytes = new TextEncoder().encode(encode(decoded));
      const names = files.deliveryFiles.map((file) => file.name);
      const total = files.deliveryFiles.reduce((sum, file) => sum + file.byteLength, 0);
      const bounded = [
        names.length === evidenceNames.length,
        new Set(names).size === names.length,
        evidenceNames.every((name) => names.includes(name)),
        Number.isSafeInteger(total),
        total === files.totalBytes,
        total > 0,
        receiptBytes.length <= 16777216 - total,
      ].every(Boolean);
      yield* requireSupervisor(bounded);
      const destination = `${workspace}/qualification-output`;
      const acquire = fs.makeDirectory(destination, { mode: 0o700 });
      function release() {
        const removing = fs
          .remove(destination, { recursive: true })
          .pipe(Effect.interruptible, Effect.timeout(10000), Effect.result);
        const needsCleanup = Effect.sync(() => !state.complete);
        const workflow = removing.pipe(Effect.when(needsCleanup), Effect.asVoid);
        return workflow;
      }
      yield* Effect.acquireRelease(acquire, release);
      yield* requireSupervisor((yield* fs.realPath(destination)) === destination);
      for (const file of files.deliveryFiles) {
        const actual = yield* readProducerFile(`${source}/${file.name}`, file.byteLength);
        const unchanged = [
          actual.bytes.length === file.byteLength,
          actual.sha256 === file.sha256,
          actual.identity.dev === file.identity.dev,
          actual.identity.ino === file.identity.ino,
          actual.identity.mode === file.identity.mode,
        ].every(Boolean);
        yield* requireSupervisor(unchanged, 'InputChanged');
        yield* fs.writeFile(`${destination}/${file.name}`, actual.bytes, {
          flag: 'wx',
          mode: 0o600,
        });
        const written = yield* readProducerFile(`${destination}/${file.name}`, file.byteLength);
        yield* requireSupervisor(
          written.bytes.length === file.byteLength && written.sha256 === file.sha256,
        );
      }
      const pending = `${destination}/qualification-receipt.pending.json`;
      yield* fs.writeFile(pending, receiptBytes, { flag: 'wx', mode: 0o600 });
      const written = yield* readProducerFile(pending, receiptBytes.length);
      yield* requireSupervisor(written.sha256 === (yield* hashEvidence(receiptBytes)));
      yield* fs.rename(pending, `${destination}/qualification-receipt.json`);
      return destination;
    }
    const stateful = Effect.gen(write);
    function mark(exit: Exit.Exit<unknown, unknown>) {
      const workflow = Effect.sync(() => {
        state.complete = Exit.isSuccess(exit);
      });
      return workflow;
    }
    const handoff = Effect.onExit(stateful, mark);
    const workflow = Effect.scoped(handoff);
    return workflow;
  }
  return { deliver };
}
export class QualificationOutput extends Context.Service<
  QualificationOutput,
  ReturnType<typeof makeQualificationOutput>
>()('ceirean/QualificationOutput') {}
