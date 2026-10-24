import { expect, test } from 'bun:test';

import { Effect } from 'effect';

import { inspectBrowserRuntime, allowBrowserRequest } from '../src/browser-policy.ts';

for (const [url, allowed] of [
  ['http://127.0.0.1:4321/carousel', true],
  ['http://127.0.0.1:4321/_astro/app.js', true],
  ['http://127.0.0.1:4322/examples/line', false],
  ['https://example.com/', false],
  ['http://user:pass@127.0.0.1:4321/', false],
  ['http://localhost:4321/', false],
  ['file:///etc/passwd', false],
  ['data:text/plain,secret', false],
  ['not a URL', false],
] as const) {
  test(`browser request ${url} is ${allowed}`, async () => {
    expect(await Effect.runPromise(allowBrowserRequest(url, 'http://127.0.0.1:4321'))).toBe(
      allowed,
    );
  });
}

test('browser runtime requires the reviewed version and sandbox launch arguments', async () => {
  const result = await Effect.runPromise(
    inspectBrowserRuntime('156.0.8078.4', [
      '/ms-playwright/chromium-1248/chrome-linux64/chrome',
      '--enable-automation',
    ]),
  );
  expect(result).toMatchObject({ activation: 'Blocked', sandboxAcceptance: 'Unverified' });
});
for (const [version, args] of [
  ['other', ['--enable-automation']],
  ['156.0.8078.4', ['--no-sandbox']],
  ['156.0.8078.4', ['--disable-setuid-sandbox']],
  ['156.0.8078.4', []],
] as const) {
  test(`runtime refuses unsafe or incomplete launch observation ${version} ${args}`, async () => {
    const result = await Effect.runPromise(
      inspectBrowserRuntime(version, args).pipe(Effect.result),
    );
    expect(result._tag).toBe('Failure');
  });
}
