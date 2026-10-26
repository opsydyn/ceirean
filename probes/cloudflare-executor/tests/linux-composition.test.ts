import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Deferred, Effect, Fiber, FileSystem, Match, PlatformError, Result, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { CacheMetadata, makeCacheMetadata } from '../src/linux-qualification/cache.ts';
import {
  CaseObservation,
  evidenceRequirements,
  QualificationAdmission,
} from '../src/linux-qualification/contract.ts';
import {
  QualificationAuthority,
  runQualification,
  makeQualificationAuthority,
} from '../src/linux-qualification/controller.ts';
import { DockerProcess } from '../src/linux-qualification/docker-process.ts';
import { DockerSession } from '../src/linux-qualification/docker-session.ts';
import {
  QualificationOutput,
  makeQualificationOutput,
} from '../src/linux-qualification/durable-output.ts';
import { admitEvidenceFiles, evidenceNames } from '../src/linux-qualification/evidence-files.ts';
import { makeQualificationHost } from '../src/linux-qualification/host.ts';
import { LinuxInputs } from '../src/linux-qualification/inputs.ts';
import { makeReceipt } from '../src/linux-qualification/receipt.ts';
import { superviseFixedWorker } from '../src/linux-qualification/supervisor.ts';
import { toolPins } from '../src/linux-qualification/tool-pins.ts';
import { ownedFixture, producerDocuments } from './linux-owned-fixtures.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Diagnostic = Schema.Struct({
  observations: Schema.Array(CaseObservation),
  seedAdmission: QualificationAdmission.fields.seed,
});
const diagnosticJson = Schema.fromJsonString(Diagnostic);
const decodeDiagnostic = Schema.decodeUnknownSync(diagnosticJson);
const platform = Effect.provide(BunServices.layer);
const metadata = Effect.provideService(CacheMetadata, makeCacheMetadata());
const withTestClock = Effect.provide(TestClock.layer());
type Fault =
  | 'collision'
  | 'mutation'
  | 'symlink'
  | 'hardlink'
  | 'late-hardlink'
  | 'receipt-overhead'
  | 'partial'
  | 'cancel';
const isFault = (fault: Fault) => Schema.is(Schema.Literal(fault));

function fixture(padding = 0) {
  function* make() {
    const { prepared, fs } = yield* ownedFixture();
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const documents = producerDocuments(prepared);
    const diagnostic = decodeDiagnostic(documents['worker-diagnostic.json']!);
    const observation = {
      ...diagnostic.observations[0]!,
      caseId: 'CancellationDeadline' as const,
      stage: 'Cleanup' as const,
      reason: 'CancellationConfirmed' as const,
      evidence: ['cancellation-deadline.json'],
      digests: { _tag: 'Unknown' as const },
    };
    const cleanup = { _tag: 'ConfirmedRemoval' as const, evidence: ['cleanup.json'] };
    documents['cancellation-deadline.json'] = encode({
      caseId: observation.caseId,
      checks: evidenceRequirements.CancellationDeadline.checks,
      observation,
      details: {},
    });
    documents['cleanup.json'] = encode({ observation: cleanup });
    for (const name of evidenceNames)
      yield* fs.writeFileString(`${root}/${name}`, documents[name]!, { mode: 0o600 });
    for (const _ of [padding].filter((size) => size > 0)) {
      const used = Object.values(documents).reduce(
        (sum, value) => sum + new TextEncoder().encode(value).length,
        0,
      );
      yield* fs.writeFileString(
        `${root}/cleanup.json`,
        documents['cleanup.json']! + ' '.repeat(padding - used),
      );
    }
    const files = yield* admitEvidenceFiles(prepared, root, cleanup, diagnostic.seedAdmission);
    const receipt = yield* makeReceipt(
      prepared.admission.request,
      files.observations,
      cleanup,
      files.admission,
    );
    return { fs, root, files, receipt };
  }
  const workflow = Effect.gen(make);
  return workflow;
}

async function durable() {
  function* run() {
    const fs = yield* FileSystem.FileSystem;
    const parent = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const state: { source?: string } = {};
    function* deliver() {
      const item = yield* fixture();
      state.source = item.root;
      yield* fs.writeFileString(`${item.root}/unrelated.env`, 'never deliver');
      yield* fs.symlink('/etc', `${item.root}/unrelated-link`);
      return yield* makeQualificationOutput(parent).deliver(item.root, item.receipt, item.files);
    }
    const delivering = Effect.gen(deliver);
    const result = yield* Effect.scoped(delivering);
    expect(yield* fs.exists(state.source!)).toBe(false);
    expect(result).toBe(`${parent}/qualification-output`);
    expect((yield* fs.readDirectory(result)).sort()).toEqual(
      [...evidenceNames, 'qualification-receipt.json'].sort(),
    );
    expect(yield* fs.readFileString(`${result}/qualification-receipt.json`)).toContain(
      '"outcome":"Passed"',
    );
  }
  await Effect.runPromise(Effect.gen(run).pipe(Effect.scoped, metadata, platform));
}
test('fixed admitted output survives source scope exit and excludes discovery paths', durable);

async function refused(fault: Fault) {
  function* run() {
    const padding = Match.value(fault).pipe(
      Match.when('receipt-overhead', () => 16777215),
      Match.orElse(() => 0),
    );
    const { fs, root, files, receipt } = yield* fixture(padding);
    const parent = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    const destination = `${parent}/qualification-output`;
    function* collision() {
      yield* fs.makeDirectory(destination);
      yield* fs.writeFileString(`${destination}/keep`, 'existing');
    }
    function* mutate() {
      const original = yield* fs.readFileString(`${root}/warmup.json`);
      yield* fs.writeFileString(`${root}/warmup.json`, original + ' ');
    }
    function* link() {
      const original = `${root}/warmup.json`;
      yield* fs.rename(original, `${root}/original`);
      yield* Match.value(fault).pipe(
        Match.when('symlink', () => fs.symlink(`${root}/original`, original)),
        Match.orElse(() => fs.link(`${root}/original`, original)),
      );
    }
    yield* Match.value(fault).pipe(
      Match.when('collision', () => Effect.gen(collision)),
      Match.when('mutation', () => Effect.gen(mutate)),
      Match.when(Schema.is(Schema.Literals(['symlink', 'hardlink'])), () => Effect.gen(link)),
      Match.orElse(() => fs.exists(root)),
    );
    const entered = yield* Deferred.make<void>();
    const held = yield* Deferred.make<void>();
    let writes = 0;
    function writeFile(
      path: string,
      bytes: Uint8Array,
      options?: Parameters<typeof fs.writeFile>[2],
    ) {
      const failing = path.startsWith(destination) && ++writes === 3;
      const faultAtWrite = { failing, fault };
      function* hold() {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(held).pipe(Effect.timeout(90000));
      }
      const workflow = Match.value(faultAtWrite).pipe(
        Match.when({ failing: true, fault: 'partial' }, () =>
          Effect.fail(
            PlatformError.badArgument({
              module: 'FileSystem',
              method: 'writeFile',
              description: 'injected write failure',
            }),
          ),
        ),
        Match.when({ failing: true, fault: 'cancel' }, () => Effect.gen(hold)),
        Match.orElse(() => fs.writeFile(path, bytes, options)),
      );
      return workflow;
    }
    function open(path: string, options?: Parameters<typeof fs.open>[1]) {
      function* opening() {
        const race = path === `${root}/warmup.json` && isFault('late-hardlink')(fault);
        for (const _ of [race].filter(Boolean)) yield* fs.link(path, `${root}/late-link`);
        return yield* fs.open(path, options);
      }
      const workflow = Effect.gen(opening);
      return workflow;
    }
    const delivery = makeQualificationOutput(parent)
      .deliver(root, receipt, files)
      .pipe(Effect.provideService(FileSystem.FileSystem, { ...fs, writeFile, open }));
    function* cancel() {
      const fiber = yield* delivery.pipe(Effect.forkScoped);
      yield* Deferred.await(entered).pipe(Effect.timeout(1000));
      yield* Fiber.interrupt(fiber);
    }
    function* fail() {
      expect(Result.isFailure(yield* delivery.pipe(Effect.result))).toBe(true);
    }
    yield* Match.value(fault).pipe(
      Match.when('cancel', () => Effect.gen(cancel)),
      Match.orElse(() => Effect.gen(fail)),
    );
    expect(yield* fs.exists(destination)).toBe(isFault('collision')(fault));
    for (const _ of [fault].filter(isFault('collision')))
      expect(yield* fs.readFileString(`${destination}/keep`)).toBe('existing');
    expect(yield* fs.exists(root)).toBe(true);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, metadata, platform));
}
for (const fault of [
  'collision',
  'mutation',
  'symlink',
  'hardlink',
  'late-hardlink',
  'receipt-overhead',
  'partial',
  'cancel',
] as const)
  test(`durable output refuses ${fault} and removes only its partial delivery`, () =>
    refused(fault));

async function sharedJobBudget() {
  function* run() {
    const { prepared, boundary } = yield* ownedFixture();
    const acquiring = yield* Deferred.make<void>();
    const creating = yield* Deferred.make<void>();
    const authority: typeof QualificationAuthority.Service = {
      ...makeQualificationAuthority(),
      reviewedRun: () => Effect.sync(() => prepared.admission.request),
      preflight: () => Effect.void,
    };
    let collected = false;
    function runDocker(args: readonly string[]) {
      function* create() {
        yield* Deferred.succeed(creating, undefined);
        yield* Effect.sleep(10001);
        return { bytes: new Uint8Array(), stdout: 'a'.repeat(64), stderr: '', exitCode: 0 };
      }
      const workflow = Match.value(args[0]).pipe(
        Match.when('create', () => Effect.gen(create)),
        Match.orElse(() =>
          Effect.succeed({ bytes: new Uint8Array(), stdout: '', stderr: '', exitCode: 0 }),
        ),
      );
      return workflow;
    }
    function prepareLinuxInputs() {
      function* acquire() {
        yield* Deferred.succeed(acquiring, undefined);
        yield* Effect.sleep(710000);
        return prepared;
      }
      const workflow = Effect.gen(acquire);
      return workflow;
    }
    function markCollected() {
      collected = true;
      return '/never';
    }
    const work = runQualification(prepared.admission.request).pipe(
      Effect.provideService(QualificationAuthority, authority),
      Effect.provideService(LinuxInputs, { ...boundary, prepareLinuxInputs }),
      Effect.provideService(DockerProcess, { run: runDocker }),
      Effect.provideService(DockerSession, {
        attach: () => Effect.die(new Error('must not attach')),
      }),
      Effect.provideService(QualificationOutput, { deliver: () => Effect.sync(markCollected) }),
    );
    const fiber = yield* work.pipe(Effect.forkScoped);
    yield* Deferred.await(acquiring).pipe(Effect.timeout(1000));
    yield* TestClock.adjust(710000);
    yield* Deferred.await(creating).pipe(Effect.timeout(1000));
    yield* TestClock.adjust(10000);
    const result = yield* Fiber.join(fiber);
    expect(result).toMatchObject({
      exitCode: 1,
      diagnostic: { qualificationReceipt: 'NotProduced' },
    });
    expect(collected).toBe(false);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, metadata, withTestClock, platform));
}
test(
  'acquisition and supervision share one job deadline with cleanup and output reserve',
  sharedJobBudget,
);

async function cleanupBudget() {
  function* run() {
    const { prepared } = yield* ownedFixture();
    const cleaning = yield* Deferred.make<void>();
    let lists = 0;
    let lateReadback = false;
    function runDocker(args: readonly string[]) {
      function* list() {
        const first = ++lists === 1;
        for (const _ of [first].filter(Boolean)) {
          yield* Deferred.succeed(cleaning, undefined);
          yield* Effect.sleep(120001);
          lateReadback = true;
        }
        return { stdout: '', stderr: '', bytes: new Uint8Array(), exitCode: 0 };
      }
      const workflow = Match.value(args[0]).pipe(
        Match.when('create', () =>
          Effect.succeed({
            stdout: 'a'.repeat(64),
            stderr: '',
            bytes: new Uint8Array(),
            exitCode: 0,
          }),
        ),
        Match.when('container', () => Effect.gen(list)),
        Match.orElse(() =>
          Effect.succeed({ stdout: '', stderr: '', bytes: new Uint8Array(), exitCode: 1 }),
        ),
      );
      return workflow;
    }
    const work = superviseFixedWorker(prepared).pipe(
      Effect.provideService(DockerProcess, { run: runDocker }),
      Effect.provideService(DockerSession, {
        attach: () => Effect.die(new Error('must not attach')),
      }),
    );
    const fiber = yield* work.pipe(Effect.forkScoped);
    yield* Deferred.await(cleaning).pipe(Effect.timeout(1000));
    yield* TestClock.adjust(120001);
    const result = yield* Fiber.join(fiber);
    expect(result.cleanup._tag).toBe('Unknown');
    expect(lateReadback).toBe(false);
    expect(result.complete).toBe(false);
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, withTestClock, platform));
}
test('cleanup reserve is bounded and stalled absence readback stays unknown', cleanupBudget);

async function closedHost() {
  function* run() {
    const { prepared } = yield* ownedFixture();
    const reviewed = {
      request: prepared.admission.request,
      build: {
        provenance: 'ReviewedToolBuild' as const,
        ceireanRevision: prepared.admission.request.ceireanRevision,
        lockBlob: prepared.tools.lockBlob,
        lockSha256: prepared.tools.lockSha256,
        effect: toolPins.effect,
        nodeImage: toolPins.nodeImage,
        nodeConfigSha256: prepared.tools.nodeConfigSha256,
        files: prepared.tools.files,
      },
    };
    const host = yield* makeQualificationHost(
      reviewed,
      {
        checkout: '/unavailable-reviewed-checkout',
        capsule: '/unavailable-reviewed-capsule',
        dockerExecutable: '/usr/bin/docker',
      },
      makeQualificationAuthority(),
    );
    const result = yield* host.run(prepared.admission.request);
    expect(result).toMatchObject({
      exitCode: 1,
      diagnostic: { reason: 'BlockedRuntime', qualificationReceipt: 'NotProduced' },
    });
  }
  const workflow = Effect.gen(run);
  await Effect.runPromise(workflow.pipe(Effect.scoped, platform));
}
test(
  'host composition retains explicit authority and refuses before acquiring unavailable locations',
  closedHost,
);
