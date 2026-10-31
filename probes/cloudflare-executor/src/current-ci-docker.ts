import { Effect, Schema } from 'effect';

import { requireSupervisor } from './linux-qualification/docker-process.ts';

export const currentCiImages = {
  bun: 'docker.io/oven/bun@sha256:c017a211c49a21adc0e49dda7b60ac8112887c3d9465e01427f434ed107c830e',
  node: 'docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09',
} as const;
export function currentCiNames(owner: string) {
  const prefix = `ceirean-current-${owner}`;
  return {
    consumer: `${prefix}-consumer`,
    stager: `${prefix}-stager`,
    inputs: `${prefix}-inputs`,
    tools: `${prefix}-tools`,
    work: `${prefix}-work`,
  };
}
export function currentCiConsumerArguments(owner: string) {
  const names = currentCiNames(owner);
  return [
    'create',
    '--name',
    names.consumer,
    '--label',
    `ceirean.current=${owner}`,
    '--platform=linux/amd64',
    '--network=none',
    '--user=1000:1000',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--read-only',
    '--cpus=2',
    '--memory=3g',
    '--memory-swap=3g',
    '--pids-limit=128',
    '--ipc=private',
    '--mount',
    `type=volume,source=${names.inputs},target=/inputs,readonly`,
    '--mount',
    `type=volume,source=${names.tools},target=/tools,readonly`,
    '--mount',
    `type=volume,source=${names.work},target=/work`,
    '--workdir=/work',
    '--env=HOME=/work/home',
    '--env=XDG_CONFIG_HOME=/work/home',
    '--env=TMPDIR=/work/tmp',
    '--entrypoint=/usr/local/bin/bun',
    currentCiImages.bun,
    '--no-env-file',
    '--no-install',
    '/tools/src/current-linux-worker.mjs',
    '--run-cache-only',
  ];
}
const Container = Schema.Struct({
  Config: Schema.Struct({
    Image: Schema.Literal(currentCiImages.bun),
    User: Schema.Literal('1000:1000'),
    Entrypoint: Schema.Tuple([Schema.Literal('/usr/local/bin/bun')]),
    Cmd: Schema.Tuple([
      Schema.Literal('--no-env-file'),
      Schema.Literal('--no-install'),
      Schema.Literal('/tools/src/current-linux-worker.mjs'),
      Schema.Literal('--run-cache-only'),
    ]),
    Labels: Schema.Record(Schema.String, Schema.String),
  }),
  HostConfig: Schema.Struct({
    NetworkMode: Schema.Literal('none'),
    ReadonlyRootfs: Schema.Boolean,
    CapDrop: Schema.Array(Schema.String),
    CapAdd: Schema.NullOr(Schema.Array(Schema.String)),
    SecurityOpt: Schema.Array(Schema.String),
    Privileged: Schema.Boolean,
    Devices: Schema.NullOr(Schema.Array(Schema.Unknown)),
    DeviceRequests: Schema.NullOr(Schema.Array(Schema.Unknown)),
    PortBindings: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
    PidMode: Schema.String,
    IpcMode: Schema.Literal('private'),
    NanoCpus: Schema.Number,
    Memory: Schema.Number,
    MemorySwap: Schema.Number,
    PidsLimit: Schema.Number,
  }),
  Mounts: Schema.Array(
    Schema.Struct({
      Type: Schema.String,
      Name: Schema.String,
      Destination: Schema.String,
      RW: Schema.Boolean,
    }),
  ),
  State: Schema.Struct({ Running: Schema.Boolean, ExitCode: Schema.Int }),
});
const Containers = Schema.fromJsonString(Schema.Array(Container));
export function verifyCurrentCiConsumer(text: string, owner: string) {
  function* verify() {
    const containers = yield* Schema.decodeUnknownEffect(Containers)(text);
    yield* requireSupervisor(containers.length === 1, 'BlockedControls');
    const item = containers[0]!;
    const h = item.HostConfig;
    const names = currentCiNames(owner);
    const expectedMounts = [
      { Type: 'volume', Name: names.inputs, Destination: '/inputs', RW: false },
      { Type: 'volume', Name: names.tools, Destination: '/tools', RW: false },
      { Type: 'volume', Name: names.work, Destination: '/work', RW: true },
    ];
    const controls = [
      item.Config.Labels['ceirean.current'] === owner,
      h.ReadonlyRootfs,
      !h.Privileged,
      h.CapDrop.length === 1 && h.CapDrop.includes('ALL'),
      (h.CapAdd ?? []).length === 0,
      h.SecurityOpt.includes('no-new-privileges:true'),
      (h.Devices ?? []).length === 0,
      (h.DeviceRequests ?? []).length === 0,
      Object.keys(h.PortBindings ?? {}).length === 0,
      h.PidMode.length === 0,
      h.NanoCpus === 2000000000,
      h.Memory === 3221225472,
      h.MemorySwap === 3221225472,
      h.PidsLimit === 128,
      item.Mounts.length === 3,
      expectedMounts.every((expected) =>
        item.Mounts.some((actual) =>
          [
            expected.Type === actual.Type,
            expected.Name === actual.Name,
            expected.Destination === actual.Destination,
            expected.RW === actual.RW,
          ].every(Boolean),
        ),
      ),
    ].every(Boolean);
    yield* requireSupervisor(controls, 'BlockedControls');
    return item.State;
  }
  const workflow = Effect.gen(verify);
  return workflow;
}
