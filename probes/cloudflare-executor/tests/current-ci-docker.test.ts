import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Result, Schema } from 'effect';

import {
  currentCiConsumerArguments,
  currentCiImages,
  currentCiNames,
  verifyCurrentCiConsumer,
} from '../src/current-ci-docker.ts';

const session = { owner: '00000000-0000-4000-8000-000000000001' };
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
function fixture() {
  const names = currentCiNames(session.owner);
  return {
    Config: {
      Image: String(currentCiImages.bun),
      User: '1000:1000',
      Entrypoint: ['/usr/local/bin/bun'],
      Cmd: [
        '--no-env-file',
        '--no-install',
        '/tools/src/current-linux-worker.mjs',
        '--run-cache-only',
      ],
      Labels: { 'ceirean.current': session.owner },
    },
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      CapAdd: [] as string[],
      SecurityOpt: ['no-new-privileges:true'],
      Privileged: false,
      Devices: [] as unknown[],
      DeviceRequests: [] as unknown[],
      PortBindings: {} as Record<string, unknown>,
      PidMode: '',
      IpcMode: 'private',
      NanoCpus: 2000000000,
      Memory: 3221225472,
      MemorySwap: 3221225472,
      PidsLimit: 128,
    },
    Mounts: [
      { Type: 'volume', Name: names.inputs, Destination: '/inputs', RW: false },
      { Type: 'volume', Name: names.tools, Destination: '/tools', RW: false },
      { Type: 'volume', Name: names.work, Destination: '/work', RW: true },
    ],
    State: { Running: false, ExitCode: 0 },
  };
}
async function controls() {
  const args = currentCiConsumerArguments(session.owner);
  expect(args).toContain(currentCiImages.bun);
  expect(args).toContain('--network=none');
  expect(args).toContain('--user=1000:1000');
  expect(args.join(' ')).not.toMatch(/docker\.sock|--publish|--privileged|--device|type=bind/);
  const result = await Effect.runPromise(
    verifyCurrentCiConsumer(encode([fixture()]), session.owner),
  );
  expect(result).toEqual({ Running: false, ExitCode: 0 });
}
test(
  'consumer uses only the pinned image, three named volumes and fixed non-root isolation',
  controls,
);

const mutations = [
  (item: ReturnType<typeof fixture>) => {
    item.Config.User = '0:0';
  },
  (item: ReturnType<typeof fixture>) => {
    item.Config.Image = 'oven/bun:latest';
  },
  (item: ReturnType<typeof fixture>) => {
    item.Config.Cmd.push('--activate');
  },
  (item: ReturnType<typeof fixture>) => {
    item.Config.Labels['ceirean.current'] = 'other';
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.NetworkMode = 'host';
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.Privileged = true;
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.ReadonlyRootfs = false;
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.CapAdd.push('SYS_ADMIN');
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.SecurityOpt = [];
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.PidsLimit = 0;
  },
  (item: ReturnType<typeof fixture>) => {
    item.HostConfig.Memory = 4294967296;
  },
  (item: ReturnType<typeof fixture>) => {
    item.Mounts[0]!.RW = true;
  },
  (item: ReturnType<typeof fixture>) => {
    item.Mounts[1]!.Name = 'unowned';
  },
  (item: ReturnType<typeof fixture>) => {
    item.Mounts.push({ Type: 'bind', Name: '/home', Destination: '/home', RW: false });
  },
];
async function isolationProperties() {
  function* check() {
    const Range = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: mutations.length - 1 }));
    const indices = Arbitrary.schema(Range);
    function mutated(index: number) {
      const item = fixture();
      mutations[index]!(item);
      const result = verifyCurrentCiConsumer(encode([item]), session.owner).pipe(
        Effect.result,
        Effect.map(Result.isFailure),
      );
      return result;
    }
    const result = yield* Arbitrary.checkEffect(indices, mutated, {
      seed: 31,
      runs: 300,
      maxShrinks: 100,
    });
    expect(result).toMatchObject({ _tag: 'Passed', runs: 300 });
  }
  const workflow = Effect.gen(check);
  await Effect.runPromise(workflow);
}
test(
  '300 seeded isolation regressions refuse independently read-back Docker state',
  isolationProperties,
);
