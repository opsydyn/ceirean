import { Effect, FileSystem, Result, Schema } from 'effect';

import { digestBytes } from './payload.ts';
import { readBounded } from './runner-input.ts';
import { packSourceFiles, readPinnedSource, sourcePins } from './source-payload.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const harnessPaths = [
  'browser/activation-block.ts',
  'browser/playwright.config.ts',
  'browser/journeys.hosted.test.ts',
  'src/browser-policy.ts',
] as const;
function localBlob(path: string, text: string) {
  function* identify() {
    const bytes = new TextEncoder().encode(text);
    const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const gitBytes = new Uint8Array(header.length + bytes.length);
    gitBytes.set(header);
    gitBytes.set(bytes, header.length);
    return {
      path,
      bytes,
      size: bytes.length,
      mode: '100644',
      objectId: yield* digestBytes(gitBytes, 'SHA-1'),
    };
  }
  const workflow = Effect.gen(identify);
  return workflow;
}

export function preparePayloadInputs(repository: string) {
  function* prepare() {
    const source = yield* packSourceFiles(yield* readPinnedSource(repository));
    const harness = [];
    const directory = new URL('../', import.meta.url);
    for (const path of harnessPaths) {
      const file = decodeURIComponent(new URL(path, directory).pathname);
      harness.push(yield* localBlob(path, yield* readBounded(file)));
    }
    const manifest = encode({
      name: 'ceirean-browser-preparation',
      private: true,
      type: 'module',
      dependencies: { '@playwright/test': '1.64.1', effect: '4.0.5' },
    });
    harness.push(yield* localBlob('package.json', manifest));
    const browser = yield* packSourceFiles(harness);
    const fs = yield* FileSystem.FileSystem;
    const output = yield* fs.makeTempDirectory({
      directory: '/private/tmp',
      prefix: 'ceirean-offline-inputs-',
    });
    function* persist() {
      yield* fs.chmod(output, 0o700);
      yield* fs.writeFile(`${output}/source.tar`, source.bytes, { flag: 'wx', mode: 0o600 });
      yield* fs.writeFile(`${output}/browser-harness-source.tar`, browser.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      yield* fs.writeFileString(
        `${output}/source-inventory.json`,
        encode({ source: sourcePins, files: source.inventory }),
        { flag: 'wx', mode: 0o600 },
      );
      yield* fs.writeFileString(
        `${output}/harness-inventory.json`,
        encode({ files: browser.inventory }),
        { flag: 'wx', mode: 0o600 },
      );
      const report = {
        _tag: 'OfflineInputsPrepared',
        activation: 'Blocked',
        directory: output,
        source: {
          revision: sourcePins.revision,
          tree: sourcePins.tree,
          files: source.inventory.length,
          bytes: source.bytes.length,
          sha256: source.sha256,
        },
        browserHarnessSource: {
          files: browser.inventory.length,
          bytes: browser.bytes.length,
          sha256: browser.sha256,
        },
        blockers: [
          'SourceTransferApprovalPending',
          'BunCachePending',
          'NpmCachePending',
          'BrowserDependencyClosurePending',
          'BrowserExecutionBlocked',
          'ArchiveExtractionUnqualified',
          'FinalImageUnbuilt',
          'PrivateInvocationHostedUnverified',
        ],
      } as const;
      yield* fs.writeFileString(`${output}/preparation.json`, encode(report), {
        flag: 'wx',
        mode: 0o600,
      });
      return report;
    }
    const writing = Effect.gen(persist);
    const written = yield* writing.pipe(Effect.result);
    const cleanup = Result.match(written, {
      onSuccess: () => Effect.void,
      onFailure: () => fs.remove(output, { recursive: true }),
    });
    yield* cleanup;
    return yield* Effect.fromResult(written);
  }
  const workflow = Effect.gen(prepare);
  const bounded = workflow.pipe(Effect.timeout('2 minutes'));
  const scoped = Effect.scoped(bounded);
  return scoped;
}
