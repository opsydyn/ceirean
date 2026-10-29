import * as Service from '@alchemy.run/cloudflare-runtime/core/bindings/Service';
import * as PlatformProxy from '@alchemy.run/cloudflare-runtime/core/platform-proxy/PlatformProxy';
import { Effect } from 'effect';

import type { Policy } from './job.ts';
import { qualifyReadOnlyOperator } from './operator.ts';

type NativeReads = {
  readonly TARGET: {
    readonly readiness: () => PromiseLike<unknown>;
    readonly status: () => PromiseLike<unknown>;
  };
};

export function probeLocalReadOnlyOperator(scriptName: string, policy: Policy) {
  function* probe() {
    const binding = Service.local({ binding: 'TARGET', scriptName });
    const proxy = yield* PlatformProxy.open<ReadonlyArray<typeof binding>, NativeReads>({
      name: 'ceirean-private-operator',
      bindings: [binding],
    });
    const client = {
      readiness: () => Promise.resolve(proxy.env.TARGET.readiness()),
      status: () => Promise.resolve(proxy.env.TARGET.status()),
    };
    return yield* qualifyReadOnlyOperator(client, policy);
  }
  const probing = Effect.gen(probe);
  return probing.pipe(Effect.scoped, Effect.timeout('45 seconds'));
}
