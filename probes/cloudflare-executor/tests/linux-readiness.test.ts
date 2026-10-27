import { expect, test } from 'bun:test';

import { Arbitrary, Effect, Schema } from 'effect';

import { inspectMountInventory } from '../src/linux-qualification/readiness.ts';

const fixture = {
  root: '1 0 0:1 / / ro - overlay overlay ro',
  work: '2 1 0:2 / /work rw - tmpfs tmpfs rw,size=2752512k',
  home: '3 1 0:3 / /home rw - tmpfs tmpfs rw,size=131072k',
  tmp: '4 1 0:4 / /tmp rw - tmpfs tmpfs rw,size=131072k',
  dev: '5 1 0:5 / /dev rw - tmpfs tmpfs rw,size=65536k',
  shm: '6 5 0:6 / /dev/shm rw - tmpfs tmpfs rw,size=65536k',
};
const inventory = Object.values(fixture).join('\n');
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function exactBudget() {
  const result = inspectMountInventory(inventory);
  expect(result).toMatchObject({
    _tag: 'ReadinessOnly',
    input: 'Parsed',
    kernelMountPolicy: 'Unreviewed',
    budgetBytes: 3221225472,
    writableTmpfsBytes: 3221225472,
    findings: [],
  });
  expect(result.categories).toEqual([
    { category: 'Root', count: 1, writableTmpfsBytes: 0, proposedBytes: null },
    { category: 'Work', count: 1, writableTmpfsBytes: 2818572288, proposedBytes: 2818572288 },
    { category: 'Home', count: 1, writableTmpfsBytes: 134217728, proposedBytes: 134217728 },
    { category: 'Tmp', count: 1, writableTmpfsBytes: 134217728, proposedBytes: 134217728 },
    { category: 'Dev', count: 1, writableTmpfsBytes: 67108864, proposedBytes: 67108864 },
    { category: 'DevShm', count: 1, writableTmpfsBytes: 67108864, proposedBytes: 67108864 },
    { category: 'Other', count: 0, writableTmpfsBytes: 0, proposedBytes: null },
  ]);
  expect(Object.keys(result)).not.toContain('approval');
  expect(Object.keys(result)).not.toContain('receipt');
}
test('reports the reviewed exact allocation without authorization', exactBudget);

function writableRoot() {
  const result = inspectMountInventory(
    inventory.replace(fixture.root, '1 0 0:1 / / rw - overlay overlay rw'),
  );
  expect(result.input).toBe('Parsed');
  expect(result.findings).toContain('WritableRoot');
  expect(result.kernelMountPolicy).toBe('Unreviewed');
}
test('reports a writable root even when the proposed tmpfs budget is exact', writableRoot);

function missingRoot() {
  const missing = inspectMountInventory(Object.values(fixture).slice(1).join('\n'));
  expect(missing.input).toBe('Parsed');
  expect(missing.findings).toContain('MissingRoot');
  expect(missing.findings).not.toContain('AmbiguousRoot');
}
test('identifies a missing root mount', missingRoot);

function ambiguousRoot() {
  const ambiguous = inspectMountInventory(`${inventory}\n7 0 0:7 / / ro - overlay overlay ro`);
  expect(ambiguous.findings).toContain('AmbiguousRoot');
  expect(ambiguous.findings).toContain('Overmount');
  expect(ambiguous.findings).not.toContain('MissingRoot');
}
test('identifies ambiguous root mounts', ambiguousRoot);

const fixedMounts = [
  { line: fixture.work, finding: 'NonRootMountRoot:Work' },
  { line: fixture.home, finding: 'NonRootMountRoot:Home' },
  { line: fixture.tmp, finding: 'NonRootMountRoot:Tmp' },
  { line: fixture.dev, finding: 'NonRootMountRoot:Dev' },
  { line: fixture.shm, finding: 'NonRootMountRoot:DevShm' },
] as const;

function fixedMountRoots() {
  for (const { line, finding } of fixedMounts) {
    const changedLine = line.replace(' / /', ' /private /');
    const changed = inventory.replace(line, changedLine);
    const result = inspectMountInventory(changed);
    expect(result.input).toBe('Parsed');
    expect(result.findings).toContain(finding);
    expect(encode(result)).not.toContain('/private');
    expect(result.kernelMountPolicy).toBe('Unreviewed');
  }
  const escapedHome = fixture.home.replace(' / /', ' /private\\040home /');
  const changed = inventory.replace(fixture.home, escapedHome);
  const multiple = inspectMountInventory(
    `${changed}\n7 1 0:7 /private-work /work ro - tmpfs tmpfs ro`,
  );
  expect(multiple.findings).toContain('NonRootMountRoot:Home');
  expect(multiple.findings).toContain('NonRootMountRoot:Work');
  expect(multiple.findings).toContain('Overmount');
  expect(encode(multiple)).not.toContain('private');
}
test('identifies each proposed fixed mount with a non-root mount-root', fixedMountRoots);

function duplicateMounts() {
  const result = inspectMountInventory(`${inventory}\n2 1 0:2 / /work rw - tmpfs tmpfs rw,size=1k`);
  expect(result.findings).toContain('DuplicateId');
  expect(result.findings).toContain('WritableDeviceAlias');
  expect(result.findings).toContain('Overmount');
}
test('identifies duplicate identities, devices and overmounts', duplicateMounts);

function writableSubmount() {
  const paths = { secret: '/work/private-token' };
  const result = inspectMountInventory(
    `${inventory}\n7 2 0:7 / ${paths.secret} rw - tmpfs tmpfs rw,size=1k`,
  );
  expect(result.findings).toContain('WritableSubmount');
  expect(result.findings).toContain('OverBudget');
  expect(encode(result)).not.toContain(paths.secret);
}
test('identifies unreviewed writable submounts without disclosing paths', writableSubmount);

function unknownAndOverflow() {
  for (const size of ['', ',size=10%', ',size=1k,size=2k']) {
    const result = inspectMountInventory(
      `${inventory}\n7 1 0:7 / /other rw - tmpfs tmpfs rw${size}`,
    );
    expect(result.writableTmpfsBytes).toBeNull();
    expect(result.findings).toContain('UnknownCapacity');
  }
  const overflow = inspectMountInventory(
    `${inventory}\n7 1 0:7 / /other rw - tmpfs tmpfs rw,size=8796093022207k`,
  );
  expect(overflow.writableTmpfsBytes).toBeNull();
  expect(overflow.findings).toContain('CapacityOverflow');
  const unknownFirst = inspectMountInventory(
    `${inventory}\n7 1 0:7 / /other rw - tmpfs tmpfs rw\n8 1 0:8 / /other2 rw - tmpfs tmpfs rw,size=8796093022207k`,
  );
  expect(unknownFirst.findings).toContain('UnknownCapacity');
  expect(unknownFirst.findings).toContain('CapacityOverflow');
}
test('unknown and overflowing capacities do not produce a total', unknownAndOverflow);

function individualOverflow() {
  const result = inspectMountInventory(
    `${fixture.root}\n2 1 0:2 / /work rw - tmpfs tmpfs rw,size=8796093022208k`,
  );
  expect(result.writableTmpfsBytes).toBeNull();
  expect(result.findings).toContain('CapacityOverflow');
  expect(result.findings).not.toContain('UnknownCapacity');
}
test('reports an individual unsafe capacity as overflow', individualOverflow);

function sanitizedPaths() {
  const result = inspectMountInventory(
    `${inventory}\n7 1 0:7 / /secret\\040path ro - private-type private-source ro`,
  );
  expect(result.input).toBe('Parsed');
  expect(encode(result)).not.toContain('secret');
  expect(encode(result)).not.toContain('private-type');
  expect(encode(result)).not.toContain('private-source');
  expect(
    inspectMountInventory(`${inventory}\n7 1 0:7 / /bad\\777path ro - proc proc ro`).input,
  ).toBe('Invalid');
  expect(inspectMountInventory({ inventory }).input).toBe('Invalid');
}
test('escaped paths and unknown filesystem details are never exported', sanitizedPaths);

function malformedFieldEscapes() {
  for (const line of [
    '7 1 0:7 / /other ro - proc bad\\777source ro',
    '7 1 0:7 / /other ro bad\\777optional - proc proc ro',
    '7 1 0:7 / /other ro - bad\\777type proc ro',
    '7 1 0:7 / /other ro,bad\\777 - proc proc ro',
    '7 1 0:7 / /other ro - proc proc ro,bad\\777',
  ]) {
    const result = inspectMountInventory(`${inventory}\n${line}`);
    expect(result.input).toBe('Invalid');
    expect(result.categories).toEqual([]);
    expect(encode(result)).not.toContain('bad');
  }
  expect(
    inspectMountInventory(`${inventory}\n7 1 0:7 / /other ro - proc valid\\040source ro`).input,
  ).toBe('Parsed');
}
test('rejects malformed escapes in every mountinfo field', malformedFieldEscapes);

function malformedInputs() {
  for (const input of [
    '',
    'broken secret',
    `${inventory}\n7 1 0:7 / /x rw - tmpfs`,
    `${inventory}\n7 1 0:7 / /secret\tname rw - tmpfs tmpfs rw,size=1k`,
    'x'.repeat(65537),
    `${fixture.root}\n`.repeat(257),
  ]) {
    const result = inspectMountInventory(input);
    expect(result.input).not.toBe('Parsed');
    expect(result.categories).toEqual([]);
    expect(result.writableTmpfsBytes).toBeNull();
    expect(encode(result)).not.toContain('secret');
  }
}
test('malformed and oversized input yields no inventory facts', malformedInputs);

const samples = Schema.Struct({
  amount: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  suffix: Schema.String.check(Schema.isMaxLength(32)),
});
async function capacityLaw(sample: typeof samples.Type) {
  const lines = Object.values(fixture);
  const offset = sample.amount % lines.length;
  const exact = inspectMountInventory(
    [...lines.slice(offset), ...lines.slice(0, offset)].join('\n'),
  );
  expect(exact.writableTmpfsBytes).toBe(3221225472);
  expect(exact.findings).toEqual([]);
  expect(exact._tag).toBe('ReadinessOnly');
  const changed = inventory.replace('size=2752512k', `size=${2752512 + sample.amount}k`);
  expect(inspectMountInventory(changed).findings).toContain('OverBudget');
  const encoded = sample.suffix
    .split('')
    .map((character) => character.charCodeAt(0).toString(16))
    .join('_');
  const paths = { secret: `/unreviewed-${encoded}-private` };
  const result = inspectMountInventory(`${inventory}\n7 1 0:7 / ${paths.secret} ro - proc proc ro`);
  expect(encode(result)).not.toContain(paths.secret);
  expect(result.kernelMountPolicy).toBe('Unreviewed');
  const duplicate = inspectMountInventory(
    `${inventory}\n2 1 0:2 / /work rw - tmpfs tmpfs rw,size=${sample.amount}k`,
  );
  expect(duplicate.findings).toContain('DuplicateId');
  expect(duplicate.findings).toContain('WritableDeviceAlias');
  expect(duplicate.findings).toContain('Overmount');
  const missing = inspectMountInventory(
    inventory.replace('size=2752512k', `size=${sample.amount}%`),
  );
  expect(missing.findings).toContain('UnknownCapacity');
  expect(missing.writableTmpfsBytes).toBeNull();
  const individual = inspectMountInventory(
    `${fixture.root}\n2 1 0:2 / /work rw - tmpfs tmpfs rw,size=${8796093022208 + sample.amount}k`,
  );
  expect(individual.findings).toContain('CapacityOverflow');
  expect(individual.findings).not.toContain('UnknownCapacity');
  expect(individual.writableTmpfsBytes).toBeNull();
  const aggregate = inspectMountInventory(
    `${inventory}\n7 1 0:7 / /other rw - tmpfs tmpfs rw,size=${8796093022207 - sample.amount}k`,
  );
  expect(aggregate.findings).toContain('CapacityOverflow');
  expect(aggregate.writableTmpfsBytes).toBeNull();
  const invalid = inspectMountInventory(
    `${inventory}\n7 1 0:7 / /other ro - proc source\\777${sample.amount} ro`,
  );
  expect(invalid.input).toBe('Invalid');
  expect(invalid.categories).toEqual([]);
  expect(encode(invalid)).not.toContain('source');
  expect(inspectMountInventory('x'.repeat(65536 + sample.amount)).input).toBe('TooLarge');
  expect(inspectMountInventory('\u00e9'.repeat(32768 + sample.amount)).input).toBe('TooLarge');
  expect(inspectMountInventory(`${fixture.root}\n`.repeat(257 + (sample.amount % 10))).input).toBe(
    'TooLarge',
  );
  const fixed = fixedMounts[sample.amount % fixedMounts.length]!;
  const mountRoot = `/private-${sample.amount}`;
  const changedRoot = inventory.replace(fixed.line, fixed.line.replace(' / /', ` ${mountRoot} /`));
  const reordered = changedRoot.split('\n').reverse().join('\n');
  const rootResult = inspectMountInventory(reordered);
  expect(rootResult.findings).toContain(fixed.finding);
  expect(encode(rootResult)).not.toContain(mountRoot);
  expect(
    inspectMountInventory(
      reordered
        .split('\n')
        .filter((line) => line !== fixture.root)
        .join('\n'),
    ).findings,
  ).toContain('MissingRoot');
  return true;
}
async function capacityProperties() {
  const checking = Arbitrary.checkEffect(
    Arbitrary.schema(samples),
    (sample) => Effect.promise(() => capacityLaw(sample)),
    { seed: 2921, runs: 100, maxShrinks: 100 },
  );
  const result = await Effect.runPromise(checking);
  expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe('Passed');
}
test('fixed-seed capacity and sanitization properties', capacityProperties);
