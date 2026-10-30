import { Console, Effect, Exit, FileSystem, Schema } from 'effect';

import image from '../fixtures/current-image.json' with { type: 'json' };
import { currentBaseline } from './current-baseline.ts';
import { prepareHarnessSource } from './payload-preparer.ts';
import { digestBytes, inspectSourceFiles, requirePayload } from './payload.ts';
import { readBounded } from './runner-input.ts';
import { packSourceFiles, readSourceAt } from './source-payload.ts';

export const currentSourcePins = {
  revision: 'be0427e2aba2cf951ef4dbbbe9296e307ed41ad3',
  tree: '0e3ea1ab2999dbd83cb3a38920cab47b2a02352e',
} as const;
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isLockPath = Schema.is(Schema.Literal('bun.lock'));

export function inspectCurrentSourceFiles(input: unknown) {
  function* inspect() {
    const checked = yield* inspectSourceFiles(input);
    const lock = checked.files.find(({ path }) => isLockPath(path));
    yield* requirePayload(lock?.sha256 === currentBaseline().source.lockSha256);
    return checked.files.map(({ path, mode, objectId, size, bytes }) => ({
      path,
      mode,
      objectId,
      size,
      bytes,
    }));
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}

export function prepareCurrentPayloadInputs(repository: string) {
  function* prepare() {
    const contract = currentBaseline();
    yield* requirePayload(contract.source.sha === currentSourcePins.revision);
    const read = yield* readSourceAt(repository, currentSourcePins);
    const files = yield* inspectCurrentSourceFiles(read);
    const source = yield* packSourceFiles(files);
    const harness = yield* prepareHarnessSource();
    const contractText = yield* readBounded(
      new URL('../fixtures/current-baseline.json', import.meta.url).pathname,
    );
    const contractBytes = new TextEncoder().encode(contractText);
    const contractSha256 = yield* digestBytes(contractBytes);
    yield* requirePayload(contractSha256 === image.contractSha256);
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* Effect.acquireRelease(
      fs.makeTempDirectory({ directory: '/private/tmp', prefix: 'ceirean-current-inputs-' }),
      (directory, exit) =>
        Exit.match(exit, {
          onSuccess: () => Effect.void,
          onFailure: () =>
            fs
              .remove(directory, { recursive: true })
              .pipe(
                Effect.catch(() =>
                  Console.error('{"_tag":"PartialCurrentInputCleanupUnconfirmed"}'),
                ),
              ),
        }),
    );
    function* persist() {
      yield* fs.chmod(directory, 0o700);
      for (const [path, bytes] of [
        ['source.tar', source.bytes],
        ['browser-harness-source.tar', harness.bytes],
        ['baseline-contract.json', contractBytes],
      ] as const) {
        yield* fs.writeFile(`${directory}/${path}`, bytes, { flag: 'wx', mode: 0o600 });
      }
      const report = {
        _tag: 'CurrentInputsPrepared' as const,
        activation: 'Blocked' as const,
        image: 'Unbuilt' as const,
        directory,
        source: {
          ...currentSourcePins,
          files: source.inventory.length,
          bytes: source.bytes.length,
          sha256: source.sha256,
        },
        browserHarnessSource: {
          files: harness.inventory.length,
          bytes: harness.bytes.length,
          sha256: harness.sha256,
        },
        contractSha256,
        blockers: [
          'CurrentBunCachePending',
          'CurrentNpmCachePending',
          'BrowserDependencyClosurePending',
          'BaselineWorkerPending',
          'TrustedInputCustodyPending',
          'NativeSandboxUnqualified',
          'BuildApprovalPending',
          'FinalImageUnbuilt',
          'HostedActivationBlocked',
        ],
      };
      for (const [path, value] of [
        ['source-inventory.json', { source: currentSourcePins, files: source.inventory }],
        ['harness-inventory.json', { files: harness.inventory }],
        ['preparation.json', report],
      ] as const) {
        yield* fs.writeFileString(`${directory}/${path}`, encode(value), {
          flag: 'wx',
          mode: 0o600,
        });
      }
      return report;
    }
    return yield* Effect.gen(persist);
  }
  const workflow = Effect.gen(prepare);
  return workflow.pipe(Effect.timeout('2 minutes'), Effect.scoped);
}

export function readCurrentSource(repository: string) {
  function* read() {
    yield* requirePayload(currentBaseline().source.sha === currentSourcePins.revision);
    const source = yield* readSourceAt(repository, currentSourcePins);
    return yield* inspectCurrentSourceFiles(source);
  }
  const workflow = Effect.gen(read);
  return workflow;
}
