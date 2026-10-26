import { expect, test } from 'bun:test';

import { BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Schema } from 'effect';

import { invokeQualification } from '../src/linux-qualification/controller.ts';

async function cli() {
  const check = await Effect.runPromise(invokeQualification(['--check']));
  expect(check.exitCode).toBe(1);
  expect(check.diagnostic.qualificationReceipt).toBe('NotProduced');
  expect(check.diagnostic.activation).toBe('Blocked');
  expect((await Effect.runPromise(invokeQualification(['--run']))).exitCode).toBe(1);
  for (const args of [
    [],
    ['--run', '--allow-observer'],
    ['--check', '--run'],
    ['--run', 'worksheet.json'],
  ])
    expect((await Effect.runPromise(invokeQualification(args))).exitCode).toBe(64);
}
test('offline check is incomplete and no CLI argument grants capabilities', cli);
async function nativeCli() {
  const path = `${import.meta.dir}/../scripts/qualify-linux.ts`;
  for (const mode of ['--check', '--run']) {
    const child = Bun.spawn([process.execPath, '--no-env-file', path, mode], {
      env: { CEIREAN_CHILD_OBSERVER: 'true', CEIREAN_CONTROLS_VERIFIED: 'true' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(1);
    expect(output).toContain('"qualificationReceipt":"NotProduced"');
    expect(output).toContain('"activation":"Blocked"');
    expect(await new Response(child.stderr).text()).toBe('');
  }
}
test('executable remains blocked with capability-like environment values', nativeCli);
const Step = Schema.Struct({
  name: Schema.String,
  if: Schema.optionalKey(Schema.String),
  run: Schema.optionalKey(Schema.String),
  uses: Schema.optionalKey(Schema.String),
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const Workflow = Schema.Struct({
  name: Schema.String,
  on: Schema.Struct({ workflow_dispatch: Schema.Null }),
  permissions: Schema.Struct({ contents: Schema.Literal('read') }),
  jobs: Schema.Struct({
    qualify: Schema.Struct({
      'runs-on': Schema.Literal('ubuntu-24.04'),
      'timeout-minutes': Schema.Literal(15),
      steps: Schema.Array(Step),
    }),
  }),
});
const decodeWorkflow = Schema.decodeUnknownSync(Workflow, { onExcessProperty: 'error' });
const withPlatform = Effect.provide(BunServices.layer);
async function workflow() {
  const raw = Bun.YAML.parse(
    await Bun.file(`${import.meta.dir}/../../../qualification/linux-cache.workflow.yml`).text(),
  );
  const workflow = decodeWorkflow(raw);
  expect(workflow.on).toEqual({ workflow_dispatch: null });
  const job = workflow.jobs.qualify;
  expect(job.steps[0]?.run).toContain('exit 1');
  expect(job.steps).toHaveLength(2);
  expect(job.steps.at(-1)?.if).toBe('success()');
  const actions = job.steps.flatMap((step) => [step.uses].filter((value) => value !== undefined));
  expect(actions).toEqual(['actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02']);
  expect(job.steps.at(-1)?.with?.['retention-days']).toBe(7);
  expect(String(job.steps.at(-1)?.with?.path).trim().split('\n')).toEqual([
    'qualification-output/runtime-isolation.json',
    'qualification-output/archive-negatives.json',
    'qualification-output/script-canaries.json',
    'qualification-output/warmup.json',
    'qualification-output/fresh-positive.json',
    'qualification-output/empty-cache.json',
    'qualification-output/missing-artifact.json',
    'qualification-output/corrupt-cache.json',
    'qualification-output/case-isolation.json',
    'qualification-output/cancellation-deadline.json',
    'qualification-output/worker-diagnostic.json',
    'qualification-output/cleanup.json',
    'qualification-output/qualification-receipt.json',
  ]);
  function* inspectActive() {
    const fs = yield* FileSystem.FileSystem;
    const path = `${import.meta.dir}/../../../.github/workflows`;
    const exists = yield* fs.exists(path);
    for (const _ of [exists].filter(Boolean)) {
      for (const name of yield* fs.readDirectory(path)) {
        const content = yield* fs.readFileString(`${path}/${name}`);
        expect(content).not.toContain('qualify-linux');
      }
    }
  }
  await Effect.runPromise(Effect.gen(inspectActive).pipe(withPlatform));
}
test('draft workflow is structured, manual-only, pinned and inert', workflow);
