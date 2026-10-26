import { Effect, Schema } from 'effect';

import { Header } from '../../node_modules/npm/node_modules/tar/dist/esm/header.js';
import { requireSupervisor } from './docker-process.ts';

const isFile = Schema.is(Schema.Literal('File'));
// A tar transport is not permission to extract. The existing pinned Header codec
// admits exactly one fixed regular JSON member before any host file is written.
export function readDockerEvidence(bytes: Uint8Array, name: string) {
  function* admit() {
    yield* requireSupervisor(bytes.length >= 1536 && bytes.length <= 262144);
    const block = Buffer.from(bytes.subarray(0, 512));
    const header = yield* Effect.try(() => new Header(block));
    const canonical = Buffer.alloc(512);
    const extended = yield* Effect.try(() => header.encode(canonical));
    const padded = Math.ceil(header.size / 512) * 512;
    const valid = [
      !extended,
      canonical.equals(block),
      isFile(header.type),
      header.path === name,
      !header.linkpath,
      Number.isSafeInteger(header.size),
      header.size > 0,
      header.size <= 260608,
      header.mode >= 0,
      header.mode <= 0o777,
      bytes.length >= 512 + padded + 1024,
      bytes.length % 512 === 0,
      bytes.subarray(512 + header.size).every((byte) => byte === 0),
    ].every(Boolean);
    yield* requireSupervisor(valid);
    return new Uint8Array(bytes.subarray(512, 512 + header.size));
  }
  const workflow = Effect.gen(admit);
  return workflow;
}
