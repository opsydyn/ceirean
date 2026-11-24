import { expect, test } from 'bun:test';

import { redactOutput } from '../src/redact.ts';

/**
 * These are the rules of ADR-0003, not examples of them. Each one is a property
 * the agent's view of a failing check depends on. A relaxation that makes a
 * checker's output more readable by weakening one of these is a loss of the
 * boundary; the answer is a report file through `read_file` instead.
 */

/** A fixture root, shaped like the real thing: absolute, resolved, no symlink. */
function fixtureRoot() {
  return '/private/tmp/ceirean-tools-abc123/checkout';
}
const root = fixtureRoot();
const bounds = { total: 4096, line: 512 };

function redact(bytes: string) {
  return redactOutput(new TextEncoder().encode(bytes), root, bounds);
}

test('a path under the checkout root is rewritten relative to it', () => {
  const output = redact(`${root}/src/index.ts:12:3 unexpected token\n`);
  expect(output.text).toBe('src/index.ts:12:3 unexpected token\n');
  expect(output.text).not.toContain(root);
});

test('the checkout root on its own never appears', () => {
  const output = redact(`running in ${root} with 2 workers\n`);
  expect(output.text).not.toContain(root);
  expect(output.text).toBe('running in . with 2 workers\n');
});

test('an absolute path outside the checkout is removed, not rewritten', () => {
  const outside = ['/etc/passwd', '/Users/someone/.ssh/id_ed25519', '/private/tmp/other/secret'];
  for (const path of outside) {
    const output = redact(`could not open ${path}\n`);
    expect(output.text).not.toContain(path);
    expect(output.text).toContain('<path>');
  }
});

test('the checkout root is removed even when it appears inside a longer path', () => {
  const output = redact(`${root}/../outside/secret.ts failed\n`);
  expect(output.text).not.toContain(root);
  expect(output.text).not.toContain('outside/secret.ts');
});

test('a relative path is left alone', () => {
  // The leading `/` of an absolute path has to begin a token. Matching any `/`
  // turned `src/a.ts` into `src<path>` and cost the agent the filename.
  const output = redact('FAIL src/a.ts:1:1 and docs/notes.md\n');
  expect(output.text).toBe('FAIL src/a.ts:1:1 and docs/notes.md\n');
});

test('an absolute path at the start of a line is caught', () => {
  const output = redact(`/etc/passwd: no such file\n${root}/src/a.ts: parsed\n`);
  expect(output.text).toBe('<path>: no such file\nsrc/a.ts: parsed\n');
});

test('a quoted or bracketed absolute path is caught', () => {
  for (const wrapped of [`"${root}/src/a.ts"`, `(${root}/src/a.ts)`, `[/etc/shadow]`]) {
    const output = redact(`at ${wrapped}\n`);
    expect(output.text).not.toContain(root);
    expect(output.text).not.toContain('/etc/shadow');
  }
});

test('credential-shaped strings are removed', () => {
  const secrets = [
    'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    'sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH',
    'ANTHROPIC_API_KEY=sk-not-a-real-key-value',
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
  ];
  for (const secret of secrets) {
    const output = redact(`check printed ${secret} oddly\n`);
    expect(output.text).not.toContain(secret);
    expect(output.text).toContain('<redacted>');
  }
});

test('escape sequences and control characters are stripped', () => {
  const output = redact('\u001b[31mFAIL\u001b[0m src/a.ts\u0007\u0008\u0000 done\n');
  expect(output.text).toBe('FAIL src/a.ts done\n');
  expect(output.text).not.toContain('\u001b');
  expect(output.text).not.toContain('\u0000');
});

test('a carriage return does not survive as a way to overwrite earlier text', () => {
  const output = redact('progress 10%\rprogress 90%\nFAIL src/a.ts\n');
  expect(output.text).not.toContain('\r');
  expect(output.text).toContain('progress 10%');
  expect(output.text).toContain('progress 90%');
});

test('invalid UTF-8 decodes lossily rather than refusing', () => {
  const bytes = new Uint8Array([0x46, 0x41, 0x49, 0x4c, 0xff, 0xfe, 0x0a]);
  const output = redactOutput(bytes, root, bounds);
  expect(output.text).toContain('FAIL');
  expect(output.omitted).toBe(0);
});

test('one enormous line is cut to the line bound and the rest kept', () => {
  const output = redact(`${'y'.repeat(5000)}\nFAIL src/a.ts\n`);
  const [first, second] = output.text.split('\n');
  expect(first?.length).toBe(bounds.line);
  expect(second).toBe('FAIL src/a.ts');
});

test('output over the total bound keeps the head and the tail and counts what went', () => {
  const body = Array.from({ length: 400 }, (_item, index) => `line ${index} of noise`).join('\n');
  const output = redact(`FIRST MARKER\n${body}\nLAST MARKER\n`);
  expect(output.text).toContain('FIRST MARKER');
  expect(output.text).toContain('LAST MARKER');
  expect(output.omitted).toBeGreaterThan(0);
  expect(output.text).toContain('bytes omitted');
  expect(new TextEncoder().encode(output.text).byteLength).toBeLessThanOrEqual(bounds.total);
});

test('output within the bound is returned whole with nothing omitted', () => {
  const output = redact('FAIL src/a.ts:1:1 two problems\n');
  expect(output.text).toBe('FAIL src/a.ts:1:1 two problems\n');
  expect(output.omitted).toBe(0);
});

test('a multi-byte character split by the bound does not arrive corrupted', () => {
  const output = redactOutput(new TextEncoder().encode('é'.repeat(200)), root, {
    total: 101,
    line: 512,
  });
  expect(output.text).not.toContain('�');
  expect(new TextEncoder().encode(output.text).byteLength).toBeLessThanOrEqual(101);
});

function fixtureSecret() {
  return 'ghp_0123456789abcdefghijklmnopqrstuvwxyz';
}

test('redaction happens before the bound, so a secret cannot be cut in half', () => {
  const secret = fixtureSecret();
  const output = redactOutput(
    new TextEncoder().encode(`${'noise '.repeat(20)}${secret} tail\n`),
    root,
    { total: 130, line: 512 },
  );
  expect(output.text).not.toContain('ghp_');
  expect(output.text).not.toContain(secret.slice(0, 12));
});

test('empty output is empty, not a placeholder', () => {
  const output = redactOutput(new Uint8Array(), root, bounds);
  expect(output.text).toBe('');
  expect(output.omitted).toBe(0);
});
