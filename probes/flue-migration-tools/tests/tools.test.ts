import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { withCheckout } from './checkout.ts';
import { prepare } from './run.ts';

test('read_file returns a bounded file and refuses one over the limit', async () => {
  await withCheckout(async ({ root, policy }) => {
    const tools = prepare(policy);
    expect(await tools.read('src/index.ts')).toEqual({
      value: { path: 'src/index.ts', bytes: 24, content: 'export const value = 1;\n' },
    });
    await writeFile(join(root, 'src', 'large.ts'), 'x'.repeat(policy.readMaximum + 1));
    expect(await tools.read('src/large.ts')).toEqual({ code: 'TooLarge' });
  });
});

test('read_file refuses bytes that are not UTF-8', async () => {
  await withCheckout(async ({ root, policy }) => {
    await writeFile(join(root, 'src', 'binary.ts'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    expect(await prepare(policy).read('src/binary.ts')).toEqual({
      code: 'InvalidEncoding',
    });
  });
});

test('write_file creates a new file under a writable prefix', async () => {
  await withCheckout(async ({ root, policy }) => {
    const tools = prepare(policy);
    expect(await tools.write('src/added.ts', 'export const added = 1;\n')).toEqual({
      value: { path: 'src/added.ts', bytes: 24 },
    });
    expect(await readFile(join(root, 'src', 'added.ts'), 'utf8')).toBe('export const added = 1;\n');
  });
});

test('write_file refuses a path outside every writable prefix and leaves it untouched', async () => {
  await withCheckout(async ({ root, policy }) => {
    const tools = prepare(policy);
    expect(await tools.write('docs/notes.md', 'overwritten')).toEqual({
      code: 'NotWritable',
    });
    expect(await readFile(join(root, 'docs', 'notes.md'), 'utf8')).toBe('# notes\n');
  });
});

test('write_file refuses content over the write limit before touching the file', async () => {
  await withCheckout(async ({ root, policy }) => {
    const tools = prepare(policy);
    const oversized = 'x'.repeat(policy.writeMaximum + 1);
    expect(await tools.write('README.md', oversized)).toEqual({ code: 'TooLarge' });
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# fixture\n');
  });
});

test('search_files matches a literal substring and reports its line', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await prepare(policy).search('export const value')).toEqual({
      value: {
        query: 'export const value',
        truncated: false,
        matches: [{ path: 'src/index.ts', line: 1, text: 'export const value = 1;' }],
      },
    });
  });
});

test('search_files never descends into .git', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await prepare(policy).search('[core]')).toEqual({
      value: { query: '[core]', truncated: false, matches: [] },
    });
  });
});

test('search_files treats the query as a literal, not a pattern', async () => {
  await withCheckout(async ({ root, policy }) => {
    await writeFile(join(root, 'src', 'regex.ts'), 'const a = 1;\nconst literal = ".*";\n');
    expect(await prepare(policy).search('.*')).toEqual({
      value: {
        query: '.*',
        truncated: false,
        matches: [{ path: 'src/regex.ts', line: 2, text: 'const literal = ".*";' }],
      },
    });
  });
});

test('search_files caps the number of matches and says so', async () => {
  await withCheckout(async ({ root, policy }) => {
    await writeFile(join(root, 'src', 'many.ts'), 'needle\n'.repeat(10));
    const capped = { ...policy, searchMatches: 3 };
    expect(await prepare(capped).search('needle')).toEqual({
      value: {
        query: 'needle',
        truncated: true,
        matches: [
          { path: 'src/many.ts', line: 1, text: 'needle' },
          { path: 'src/many.ts', line: 2, text: 'needle' },
          { path: 'src/many.ts', line: 3, text: 'needle' },
        ],
      },
    });
  });
});

test('search_files truncates a long matching line to the byte bound', async () => {
  await withCheckout(async ({ root, policy }) => {
    await writeFile(join(root, 'src', 'long.ts'), `needle${'y'.repeat(200)}\n`);
    const narrow = { ...policy, searchMatchBytes: 16 };
    expect(await prepare(narrow).search('needle')).toEqual({
      value: {
        query: 'needle',
        truncated: false,
        matches: [{ path: 'src/long.ts', line: 1, text: 'needleyyyyyyyyyy' }],
      },
    });
  });
});

test('search_files refuses an empty query rather than returning the whole checkout', async () => {
  await withCheckout(async ({ policy }) => {
    expect(await prepare(policy).search('')).toEqual({ code: 'UnsafePath' });
  });
});

test('run_check reports its exit code and the output of the check', async () => {
  await withCheckout(async ({ policy }) => {
    const checks = [
      { name: 'passes', executable: '/usr/bin/true', args: [], timeoutSeconds: 5 },
      { name: 'fails', executable: '/usr/bin/false', args: [], timeoutSeconds: 5 },
    ];
    const tools = prepare({ ...policy, checks });
    expect(await tools.check('passes')).toEqual({
      value: {
        name: 'passes',
        exitCode: 0,
        timedOut: false,
        output: { stdout: '', stderr: '', omitted: 0 },
      },
    });
    expect(await tools.check('fails')).toEqual({
      value: {
        name: 'fails',
        exitCode: 1,
        timedOut: false,
        output: { stdout: '', stderr: '', omitted: 0 },
      },
    });
  });
});

test('run_check refuses a name the policy does not list', async () => {
  await withCheckout(async ({ policy }) => {
    const checks = [{ name: 'passes', executable: '/usr/bin/true', args: [], timeoutSeconds: 5 }];
    const tools = prepare({ ...policy, checks });
    for (const name of ['absent', '/usr/bin/true', 'passes; rm -rf /'])
      expect(await tools.check(name)).toEqual({ code: 'UnknownCheck' });
  });
});

test('a lint failure, a test failure and a timeout are distinguishable', async () => {
  await withCheckout(async ({ policy }) => {
    const checks = [
      {
        name: 'lint',
        executable: '/bin/sh',
        args: ['-c', 'echo "src/a.ts:12:3 unexpected token" >&2; exit 1'],
        timeoutSeconds: 5,
      },
      {
        name: 'unit',
        executable: '/bin/sh',
        args: ['-c', 'echo "1 fail: expected 2, got 1 (tests/a.test.ts)"; exit 1'],
        timeoutSeconds: 5,
      },
      { name: 'slow', executable: '/bin/sleep', args: ['30'], timeoutSeconds: 1 },
    ];
    const tools = prepare({ ...policy, checks });

    // This is the point of the slice. Before it, all three were a bare `1` or
    // `124` and an agent could not tell which problem it was looking at.
    expect(await tools.check('lint')).toEqual({
      value: {
        name: 'lint',
        exitCode: 1,
        timedOut: false,
        output: { stdout: '', stderr: 'src/a.ts:12:3 unexpected token\n', omitted: 0 },
      },
    });
    expect(await tools.check('unit')).toEqual({
      value: {
        name: 'unit',
        exitCode: 1,
        timedOut: false,
        output: {
          stdout: '1 fail: expected 2, got 1 (tests/a.test.ts)\n',
          stderr: '',
          omitted: 0,
        },
      },
    });
    expect(await tools.check('slow')).toEqual({
      value: {
        name: 'slow',
        exitCode: 124,
        timedOut: true,
        output: { stdout: '', stderr: '', omitted: 0 },
      },
    });
  });
});

test('a check that names an absolute path inside the checkout is rewritten', async () => {
  await withCheckout(async ({ root, policy }) => {
    const checks = [
      {
        name: 'absolute',
        executable: '/bin/sh',
        args: ['-c', `echo "${root}/src/a.ts:1:1 broken"; echo "/etc/shadow unreadable" >&2`],
        timeoutSeconds: 5,
      },
    ];
    const outcome = await prepare({ ...policy, checks }).check('absolute');
    expect(outcome).toEqual({
      value: {
        name: 'absolute',
        exitCode: 0,
        timedOut: false,
        output: { stdout: 'src/a.ts:1:1 broken\n', stderr: '<path> unreadable\n', omitted: 0 },
      },
    });
  });
});

test('a check that floods its output is bounded and says how much went', async () => {
  await withCheckout(async ({ policy }) => {
    const checks = [
      {
        name: 'flood',
        executable: '/bin/sh',
        args: [
          '-c',
          'echo FIRST; for i in $(seq 1 4000); do echo "noise line $i"; done; echo LAST',
        ],
        timeoutSeconds: 15,
      },
    ];
    const tools = prepare({ ...policy, outputMaximum: 2048, checks });
    const outcome = await tools.check('flood');
    const value = 'value' in outcome ? outcome.value : undefined;
    expect(value?.exitCode).toBe(0);
    expect(value?.output.stdout).toContain('FIRST');
    expect(value?.output.stdout).toContain('LAST');
    expect(value?.output.omitted).toBeGreaterThan(0);
    expect(new TextEncoder().encode(value?.output.stdout).byteLength).toBeLessThanOrEqual(2048);
  });
});

test('a check killed by its timeout still reports what it had written', async () => {
  await withCheckout(async ({ policy }) => {
    const checks = [
      {
        name: 'partial',
        executable: '/bin/sh',
        args: ['-c', 'echo "started src/a.ts"; sleep 30'],
        timeoutSeconds: 2,
      },
    ];
    const outcome = await prepare({ ...policy, checks }).check('partial');
    expect(outcome).toEqual({
      value: {
        name: 'partial',
        exitCode: 124,
        timedOut: true,
        output: { stdout: 'started src/a.ts\n', stderr: '', omitted: 0 },
      },
    });
  });
});
