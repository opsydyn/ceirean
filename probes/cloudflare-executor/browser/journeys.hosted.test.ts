import {
  expect,
  test as base,
  type ConsoleMessage,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightWorkerArgs,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { Effect, Match, Result, Schema } from 'effect';

import {
  allowBrowserRequest,
  fetchBrowserResponse,
  inspectBrowserRuntime,
} from '../src/browser-policy.ts';

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isErrorMessage = Schema.is(Schema.Literal('error'));
async function observeBrowser(
  {
    browser,
    context,
    page,
  }: Pick<PlaywrightTestArgs, 'context' | 'page'> & Pick<PlaywrightWorkerArgs, 'browser'>,
  use: (value: void) => Promise<void>,
  info: TestInfo,
) {
  const acquiring = Effect.tryPromise(() => browser.newBrowserCDPSession());
  const observation = Effect.acquireUseRelease(
    acquiring,
    (session) => Effect.tryPromise(() => session.send('Browser.getBrowserCommandLine')),
    (session) => Effect.promise(() => session.detach()),
  );
  const { arguments: args } = await Effect.runPromise(observation);
  await Effect.runPromise(inspectBrowserRuntime(browser.version(), args));
  const counts = {
    denied: 0,
    consoleErrors: 0,
    pageErrors: 0,
    consoleMessages: 0,
    popups: 0,
    webSockets: 0,
  };
  const approvedOrigin = new Map([
    ['carousel', 'http://127.0.0.1:4321'],
    ['line', 'http://127.0.0.1:4322'],
  ]).get(info.title);
  expect(approvedOrigin).toBeDefined();
  async function guardRoute(route: Route) {
    const allowed = await Effect.runPromise(
      allowBrowserRequest(route.request().url(), approvedOrigin ?? ''),
    );
    async function blockRequest() {
      counts.denied += 1;
      await route.abort('blockedbyclient');
    }
    async function fulfillLocalResponse() {
      const fetching = fetchBrowserResponse((options) => route.fetch(options));
      const result = await Effect.runPromise(fetching.pipe(Effect.result));
      await Result.match(result, {
        onSuccess: (response) => route.fulfill({ response }),
        onFailure: blockRequest,
      });
    }
    await Match.value(allowed).pipe(
      Match.when(true, fulfillLocalResponse),
      Match.orElse(blockRequest),
    );
  }
  await context.route('**/*', guardRoute);
  await context.routeWebSocket('**/*', (socket) => {
    counts.webSockets += 1;
    socket.close();
  });
  context.on('page', () => {
    counts.popups += 1;
  });
  function recordConsole(message: ConsoleMessage) {
    counts.consoleMessages += 1;
    const errorMessage = isErrorMessage(message.type());
    counts.consoleErrors += Number(errorMessage);
  }
  page.on('console', recordConsole);
  page.on('pageerror', () => {
    counts.pageErrors += 1;
  });
  await page.clock.install({ time: new Date('2026-10-24T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-24T00:00:10Z'));
  await use();
  await info.attach('runtime-observation', {
    body: encode({
      version: browser.version(),
      args,
      counts,
      activation: 'Blocked',
      sandboxAcceptance: 'Unverified',
    }),
    contentType: 'application/json',
  });
  expect(counts.denied).toBe(0);
  expect(counts.consoleErrors).toBe(0);
  expect(counts.pageErrors).toBe(0);
  expect(counts.popups).toBe(0);
  expect(counts.webSockets).toBe(0);
  expect(counts.consoleMessages).toBeLessThanOrEqual(64);
}
const test = base.extend<{ evidence: void }>({
  evidence: [observeBrowser, { auto: true }],
});

async function capture(page: Page, info: TestInfo, name: string) {
  const bytes = await page.screenshot({
    path: info.outputPath(name),
    fullPage: false,
    animations: 'disabled',
  });
  expect(bytes.byteLength).toBeLessThanOrEqual(10485760);
}

async function carouselJourney(
  { page, context, isMobile }: Pick<PlaywrightTestArgs, 'page' | 'context'> & { isMobile: boolean },
  info: TestInfo,
) {
  await page.goto('http://127.0.0.1:4321/carousel');
  await page.clock.runFor(1500);
  const root = page.getByRole('region', { name: 'Feature carousel' });
  await expect(root.locator('[data-carousel-slide="0"]')).not.toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await root.getByRole('button', { name: 'Next slide', exact: true }).click();
  await page.clock.runFor(1000);
  await expect(root.locator('[data-carousel-slide="1"]')).not.toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await root.getByRole('button', { name: 'Previous slide', exact: true }).click();
  await page.clock.runFor(1000);
  await expect(root.locator('[data-carousel-slide="0"]')).not.toHaveAttribute(
    'aria-hidden',
    'true',
  );
  const track = root.locator('[data-carousel-track-id]');
  await expect(track).toBeVisible();
  await track.scrollIntoViewIfNeeded();
  const bounds = await track.boundingBox();
  expect(bounds).not.toBeNull();
  const box = bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(box.width).toBeGreaterThan(0);
  const x = box.x + box.width * 0.75;
  const y = box.y + box.height / 2;
  async function touchDrag() {
    const acquiring = Effect.tryPromise(() => context.newCDPSession(page));
    async function sendTouch(session: Awaited<ReturnType<typeof context.newCDPSession>>) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 10; step += 1) {
        await page.clock.runFor(32);
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x - box.width * 0.05 * step, y }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    const gesture = Effect.acquireUseRelease(
      acquiring,
      (session) => Effect.tryPromise(() => sendTouch(session)),
      (session) => Effect.promise(() => session.detach()),
    );
    await Effect.runPromise(gesture);
  }
  async function mouseDrag() {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.clock.runFor(32);
      await page.mouse.move(x - box.width * 0.05 * step, y);
    }
    await page.mouse.up();
  }
  await Match.value(isMobile).pipe(Match.when(true, touchDrag), Match.orElse(mouseDrag));
  await page.clock.runFor(1000);
  await expect(root.locator('[data-carousel-slide="1"]')).not.toHaveAttribute(
    'aria-hidden',
    'true',
  );
  async function remainingDistance() {
    const offset = await track
      .locator(':scope > div')
      .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);
    return Math.abs(offset + box.width);
  }
  await expect.poll(remainingDistance).toBeLessThan(1);
  await capture(page, info, 'carousel.png');
}
test('carousel', carouselJourney);

async function lineJourney({ page }: Pick<PlaywrightTestArgs, 'page'>, info: TestInfo) {
  await page.goto('http://127.0.0.1:4322/examples/line');
  await page.clock.runFor(1000);
  const controls = page.getByRole('tabpanel', { name: 'Controls', exact: true });
  const point = controls.locator('#line-point-0');
  await point.focus();
  await point.press('End');
  await point.press('ArrowLeft');
  await expect(point).toHaveValue('99');
  await controls.locator('#line-source-file').selectOption('settings.ts');
  const source = controls.locator('pre[aria-label="settings.ts source code"]');
  await expect(source).toContainText('99');
  const settingsText = await controls
    .locator('pre[aria-label="settings.ts source code"]')
    .innerText();
  const jsonText = settingsText.slice(settingsText.indexOf('{'), settingsText.lastIndexOf('}') + 1);
  const Settings = Schema.Struct({
    curve: Schema.String,
    values: Schema.Array(Schema.Number),
    yMax: Schema.Number,
  });
  const settingsJson = Schema.fromJsonString(Settings);
  const decodeSettings = Schema.decodeUnknownSync(settingsJson);
  expect(decodeSettings(jsonText)).toEqual({
    curve: 'catmullRom',
    values: [99, 45, 23, 88, 67],
    yMax: 100,
  });
  await expect(controls.locator('svg desc')).toContainText('Values: 99, 45, 23, 88, 67');
  await capture(page, info, 'line.png');
}
test('line', lineJourney);
