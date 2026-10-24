import { expect, test } from 'bun:test';

import { request } from '@playwright/test';
import { Effect } from 'effect';

import { fetchBrowserResponse } from '../src/browser-policy.ts';

async function refusesRedirect() {
  let destinationHits = 0;
  const destination = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      destinationHits += 1;
      return new Response('unexpected');
    },
  });
  const source = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.redirect(destination.url, 302),
  });
  const client = await request.newContext();
  const fetching = fetchBrowserResponse((options) => client.get(source.url.href, options));
  const result = await Effect.runPromise(fetching.pipe(Effect.result));
  await client.dispose();
  await source.stop(true);
  await destination.stop(true);
  expect(result._tag).toBe('Failure');
  expect(destinationHits).toBe(0);
}
test(
  'an allowed-origin response cannot redirect the browser fetch to a second server',
  refusesRedirect,
);

async function acceptsLocalResponse() {
  const source = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('local') });
  const client = await request.newContext();
  const fetching = fetchBrowserResponse((options) => client.get(source.url.href, options));
  const result = await Effect.runPromise(fetching.pipe(Effect.result));
  await client.dispose();
  await source.stop(true);
  expect(result._tag).toBe('Success');
}
test('a non-redirect local response can be returned to the browser', acceptsLocalResponse);
