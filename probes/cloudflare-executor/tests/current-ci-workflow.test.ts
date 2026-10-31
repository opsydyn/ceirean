import { expect, test } from 'bun:test';

import { Schema } from 'effect';

const decode = Schema.decodeUnknownSync(
  Schema.Struct({
    on: Schema.Struct({ workflow_dispatch: Schema.Null }),
    permissions: Schema.Struct({ contents: Schema.Literal('read') }),
    env: Schema.Record(Schema.String, Schema.String),
    jobs: Schema.Struct({
      cache: Schema.Struct({
        'runs-on': Schema.Literal('ubuntu-24.04'),
        'timeout-minutes': Schema.Literal(30),
        steps: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    }),
  }),
);
async function dormantWorkflow() {
  const url = new URL('../../../qualification/current-linux-cache.workflow.yml', import.meta.url);
  const text = await Bun.file(url).text();
  const raw = Bun.YAML.parse(text);
  const workflow = decode(raw);
  const Sections = Schema.Struct({
    on: Schema.Record(Schema.String, Schema.Unknown),
    permissions: Schema.Record(Schema.String, Schema.Unknown),
    jobs: Schema.Record(Schema.String, Schema.Unknown),
  });
  const sections = Schema.decodeUnknownSync(Sections)(raw);
  expect(Object.keys(sections.on)).toEqual(['workflow_dispatch']);
  expect(Object.keys(sections.permissions)).toEqual(['contents']);
  expect(Object.keys(sections.jobs)).toEqual(['cache']);
  expect(workflow.env.CEIREAN_IMPLEMENTATION_SHA).toBe('');
  expect(workflow.env.CONTROLLER_BUN_SHA256).toBe('');
  expect(workflow.env.FOLDKIT_SOURCE_SHA).toBe('be0427e2aba2cf951ef4dbbbe9296e307ed41ad3');
  expect(String(workflow.jobs.cache.steps[0]!.run)).toContain('exit 1');
  for (const pins of [
    { CEIREAN_IMPLEMENTATION_SHA: '', CONTROLLER_BUN_SHA256: '', GITHUB_SHA: '' },
    {
      CEIREAN_IMPLEMENTATION_SHA: 'a'.repeat(40),
      CONTROLLER_BUN_SHA256: 'b'.repeat(64),
      GITHUB_SHA: 'a'.repeat(40),
    },
  ]) {
    const child = Bun.spawnSync(['/bin/bash', '-c', String(workflow.jobs.cache.steps[0]!.run)], {
      env: pins,
      timeout: 1000,
    });
    expect(child.exitCode).toBe(1);
  }
  expect(text).not.toMatch(
    /secrets\.|id-token|actions\/cache|workflow_call|self-hosted|continue-on-error|inputs\./,
  );
  const actions = workflow.jobs.cache.steps.filter((step) => step.uses !== undefined);
  expect(actions.length).toBe(3);
  for (const action of actions)
    expect(action.uses).toMatch(/^actions\/(checkout|upload-artifact)@[a-f0-9]{40}$/);
  const uploads = actions.filter((step) =>
    String(step.uses).startsWith('actions/upload-artifact@'),
  );
  expect(uploads.length).toBe(2);
  const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  expect(encode(uploads)).toContain('qualification-output/seed.tar.gz');
  expect(encode(uploads)).not.toContain('**');
  expect(
    await Bun.file(
      new URL('../../../.github/workflows/current-linux-cache.yml', import.meta.url),
    ).exists(),
  ).toBe(false);
}
test(
  'current CI workflow is inactive, manual, fixed-path, hash-pinned and blocked on publication fields',
  dormantWorkflow,
);
