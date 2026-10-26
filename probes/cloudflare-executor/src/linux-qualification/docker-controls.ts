import { Effect, Schema } from 'effect';

import { requireSupervisor } from './docker-process.ts';
import { toolPins } from './tool-pins.ts';

const nullableArray = Schema.Union([Schema.Null, Schema.Array(Schema.Unknown)]);
const nullableMap = Schema.Union([Schema.Null, Schema.Record(Schema.String, Schema.Unknown)]);
const Readback = Schema.Array(
  Schema.Struct({
    Config: Schema.Struct({ User: Schema.String, Image: Schema.String }),
    HostConfig: Schema.Struct({
      NetworkMode: Schema.String,
      ReadonlyRootfs: Schema.Boolean,
      CapDrop: Schema.Array(Schema.String),
      SecurityOpt: Schema.Array(Schema.String),
      Privileged: Schema.Boolean,
      Devices: nullableArray,
      DeviceRequests: nullableArray,
      PortBindings: nullableMap,
      PidMode: Schema.String,
      IpcMode: Schema.String,
      NanoCpus: Schema.Number,
      Memory: Schema.Number,
      MemorySwap: Schema.Number,
      PidsLimit: Schema.Number,
    }),
    Mounts: Schema.Array(
      Schema.Struct({
        Type: Schema.String,
        Source: Schema.String,
        Destination: Schema.String,
        RW: Schema.Boolean,
      }),
    ),
  }),
);
const decodeReadback = Schema.decodeUnknownEffect(Schema.fromJsonString(Readback));
const isNone = Schema.is(Schema.Literal('none'));
const isEmpty = Schema.is(Schema.Literal(''));
const isPrivate = Schema.is(Schema.Literal('private'));
const isInputs = Schema.is(Schema.Literal('/inputs'));
const isTools = Schema.is(Schema.Literal('/tools'));
export function assertDockerReadback(
  json: string,
  expected: { uid: number; gid: number; root: string },
) {
  function* inspect() {
    const items = yield* decodeReadback(json);
    yield* requireSupervisor(items.length === 1, 'BlockedControls');
    const item = items[0]!;
    const host = item.HostConfig;
    const noDevices = [host.Devices, host.DeviceRequests].every(
      (values) => (values ?? []).length === 0,
    );
    const ports = Object.keys(host.PortBindings ?? {});
    const controls = [
      item.Config.User === `${expected.uid}:${expected.gid}`,
      expected.uid > 0,
      expected.gid > 0,
      item.Config.Image === toolPins.installerImage,
      isNone(host.NetworkMode),
      host.ReadonlyRootfs,
      !host.Privileged,
      host.CapDrop.length === 1,
      host.CapDrop.includes('ALL'),
      host.SecurityOpt.includes('no-new-privileges:true'),
      noDevices,
      ports.length === 0,
      isEmpty(host.PidMode),
      isPrivate(host.IpcMode),
      host.NanoCpus === 2000000000,
      host.Memory === 4294967296,
      host.MemorySwap === 4294967296,
      host.PidsLimit === 128,
      item.Mounts.length === 2,
      item.Mounts.every((mount) => !mount.RW),
      item.Mounts.some((mount) => mount.Source === expected.root && isInputs(mount.Destination)),
      item.Mounts.some(
        (mount) => mount.Source === `${expected.root}/tools` && isTools(mount.Destination),
      ),
    ].every(Boolean);
    yield* requireSupervisor(controls, 'BlockedControls');
    return item;
  }
  const workflow = Effect.gen(inspect);
  return workflow;
}
