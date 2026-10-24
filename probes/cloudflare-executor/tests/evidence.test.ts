import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import { makeEvidenceCollector } from '../src/evidence.ts';
import { collectorLimits, header } from './contracts-fixtures.ts';

function* verifyCompleteEvidence() {
  const collector = yield* makeEvidenceCollector(collectorLimits());
  expect(Result.isSuccess(yield* collector.openArtifact(header()))).toBe(true);
  expect(
    Result.isSuccess(yield* collector.appendArtifact('commands.json', new Uint8Array(1))),
  ).toBe(true);
  expect(Result.isSuccess(yield* collector.finishArtifact('commands.json'))).toBe(true);
  const result = yield* collector.finalize();
  expect(Result.getOrThrow(result)).toMatchObject({
    activation: 'Blocked',
    outcome: 'Blocked',
    integrity: 'Unverified',
    cleanup: 'CleanupUnconfirmed',
  });
  expect(Result.isFailure(yield* collector.appendOutput('check', new Uint8Array(1)))).toBe(true);
}
async function completeEvidence() {
  const program = Effect.gen(verifyCompleteEvidence);
  await Effect.runPromise(program);
}
test(
  'complete metered evidence seals as blocked and unverified not activation proof',
  completeEvidence,
);

function* verifyBadEntries() {
  for (const bad of [
    header('../escape'),
    header('/tmp/file'),
    header('a/b'),
    { ...header(), entryType: 'Symlink' },
    { ...header(), entryType: 'Fifo' },
    { ...header(), claimedSha256: 'invalid' },
    { ...header(), byteLength: -1 },
  ]) {
    const collector = yield* makeEvidenceCollector(collectorLimits());
    expect(Result.isFailure(yield* collector.openArtifact(bad))).toBe(true);
    expect(Result.isFailure(yield* collector.openArtifact(header()))).toBe(true);
  }
  const collector = yield* makeEvidenceCollector(collectorLimits());
  yield* collector.openArtifact(header());
  expect(Result.isFailure(yield* collector.openArtifact(header()))).toBe(true);
}
async function badEntries() {
  const program = Effect.gen(verifyBadEntries);
  await Effect.runPromise(program);
}
test('unsafe special duplicate and malformed entries reject and poison collection', badEntries);

function* verifyMissingArtifacts() {
  const missing = yield* makeEvidenceCollector(collectorLimits());
  expect(Result.isFailure(yield* missing.finalize())).toBe(true);
  const incomplete = yield* makeEvidenceCollector(collectorLimits());
  yield* incomplete.openArtifact(header('commands.json', 2));
  yield* incomplete.appendArtifact('commands.json', new Uint8Array(1));
  expect(Result.isFailure(yield* incomplete.finishArtifact('commands.json'))).toBe(true);
}
async function missingArtifacts() {
  const program = Effect.gen(verifyMissingArtifacts);
  await Effect.runPromise(program);
}
test('missing required and truncated artifacts cannot finalize', missingArtifacts);

function* verifyExactCaps() {
  const chunk = new Uint8Array(1048576);
  const output = yield* makeEvidenceCollector(collectorLimits());
  for (let count = 0; count < 10; count += 1)
    expect(Result.isSuccess(yield* output.appendOutput('check', chunk))).toBe(true);
  expect(Result.isFailure(yield* output.appendOutput('check', new Uint8Array(1)))).toBe(true);
  const artifacts = yield* makeEvidenceCollector(collectorLimits());
  expect(Result.isSuccess(yield* artifacts.openArtifact(header('commands.json', 536870912)))).toBe(
    true,
  );
  for (let count = 0; count < 512; count += 1) {
    expect(Result.isSuccess(yield* artifacts.appendArtifact('commands.json', chunk))).toBe(true);
  }
  expect(Result.isSuccess(yield* artifacts.finishArtifact('commands.json'))).toBe(true);
  expect(Result.isFailure(yield* artifacts.appendOutput('check', new Uint8Array(1)))).toBe(true);
}
async function exactCaps() {
  const program = Effect.gen(verifyExactCaps);
  await Effect.runPromise(program);
}
test(
  '10 MiB per command and 512 MiB combined reserve accept exact limits but not one byte over',
  exactCaps,
);

function* verifyAggregateAndOverflow() {
  const collector = yield* makeEvidenceCollector(collectorLimits(10, 12));
  yield* collector.appendOutput('check', new Uint8Array(3));
  expect(Result.isSuccess(yield* collector.openArtifact(header('commands.json', 9)))).toBe(true);
  expect(Result.isFailure(yield* collector.openArtifact(header('trace.zip', 1)))).toBe(true);
  const declared = yield* makeEvidenceCollector(collectorLimits());
  yield* declared.openArtifact(header());
  expect(Result.isFailure(yield* declared.appendArtifact('commands.json', new Uint8Array(2)))).toBe(
    true,
  );
}
async function aggregateAndOverflow() {
  const program = Effect.gen(verifyAggregateAndOverflow);
  await Effect.runPromise(program);
}
test(
  'output and artifact reservations share the export cap and chunks cannot exceed declared size',
  aggregateAndOverflow,
);

function* verifyAtomicReservations() {
  const collector = yield* makeEvidenceCollector(collectorLimits(10, 10));
  const results = yield* Effect.forEach(
    ['commands.json', 'trace.zip'],
    (name) => collector.openArtifact(header(name, 8)),
    { concurrency: 'unbounded' },
  );
  expect(results.filter(Result.isSuccess)).toHaveLength(1);
  expect(results.filter(Result.isFailure)).toHaveLength(1);
  expect(Result.isFailure(yield* collector.finalize())).toBe(true);
}
async function atomicReservations() {
  const program = Effect.gen(verifyAtomicReservations);
  await Effect.runPromise(program);
}
test('concurrent artifact reservations cannot oversubscribe the shared cap', atomicReservations);

function* verifyOwnedInputs() {
  const config = collectorLimits();
  const collector = yield* makeEvidenceCollector(config);
  config.request.operationId = 'other-operation';
  config.requiredArtifacts.push('surprise.zip');
  const input = header();
  yield* collector.openArtifact(input);
  input.byteLength = 999;
  yield* collector.appendArtifact('commands.json', new Uint8Array(1));
  yield* collector.finishArtifact('commands.json');
  const manifest = Result.getOrThrow(yield* collector.finalize());
  expect(manifest).toMatchObject({ operationId: 'operation-1', artifacts: [header()] });
}
async function ownedInputs() {
  const program = Effect.gen(verifyOwnedInputs);
  await Effect.runPromise(program);
}
test('constructor and artifact descriptors are snapshotted against caller mutation', ownedInputs);

function* verifyMetadataBounds() {
  const artifacts = yield* makeEvidenceCollector(collectorLimits(10, 10));
  const commands = yield* makeEvidenceCollector(collectorLimits(10, 10));
  const empty = new Uint8Array(0);
  for (let index = 0; index < 64; index += 1) {
    expect(Result.isSuccess(yield* artifacts.openArtifact(header(`file-${index}.json`, 0)))).toBe(
      true,
    );
    expect(Result.isSuccess(yield* commands.appendOutput(`command-${index}`, empty))).toBe(true);
  }
  expect(Result.isFailure(yield* artifacts.openArtifact(header('file-64.json', 0)))).toBe(true);
  expect(Result.isFailure(yield* commands.appendOutput('command-64', empty))).toBe(true);
  expect(Result.isFailure(yield* commands.appendOutput('command-0', empty))).toBe(true);
}
async function metadataBounds() {
  const program = Effect.gen(verifyMetadataBounds);
  await Effect.runPromise(program);
}
test(
  '64 metadata entries fit but a 65th artifact or command poisons the collector',
  metadataBounds,
);

function chunkLaw(seed: number) {
  function* verifyLaw() {
    const size = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 25 }));
    const sequence = Schema.Array(size).check(Schema.isMaxLength(20));
    const sizes = Arbitrary.schema(sequence);
    function law(chunks: ReadonlyArray<number>) {
      function* generatedCase() {
        const collector = yield* makeEvidenceCollector(collectorLimits(50, 100));
        let acceptedBytes = 0;
        let rejected = false;
        let coherent = true;
        for (const length of chunks) {
          const shouldAccept: boolean = !rejected && acceptedBytes + length <= 50;
          const result = yield* collector.appendOutput('check', new Uint8Array(length));
          coherent = coherent && Result.isSuccess(result) === shouldAccept;
          acceptedBytes += Number(shouldAccept) * length;
          rejected = rejected || !shouldAccept;
        }
        return coherent;
      }
      const workflow = Effect.gen(generatedCase);
      const outcome = workflow.pipe(Effect.result);
      const checking = outcome.pipe(Effect.map(Result.getOrElse(() => false)));
      return checking;
    }
    const result = yield* Arbitrary.checkEffect(sizes, law, { seed, runs: 100, maxShrinks: 100 });
    expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
    expect(result).toMatchObject({ runs: 100 });
  }
  async function verifySeed() {
    const program = Effect.gen(verifyLaw);
    await Effect.runPromise(program);
  }
  return verifySeed;
}
for (const seed of [0, 1, 163]) test(`streaming chunk budget law; seed ${seed}`, chunkLaw(seed));
