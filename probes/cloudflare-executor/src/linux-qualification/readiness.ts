import { Match, Option, Schema } from 'effect';

const isString = Schema.is(Schema.String);
const isRoot = Schema.is(Schema.Literal('/'));
const isReadWrite = Schema.is(Schema.Literal('rw'));
const isAccess = Schema.is(Schema.Literals(['ro', 'rw']));
const isTmpfs = Schema.is(Schema.Literal('tmpfs'));
const isOther = Schema.is(Schema.Literal('Other'));
const isDevShm = Schema.is(Schema.Literal('/dev/shm'));
const budgetBytes = 3221225472;
const definitions = [
  { category: 'Root', path: '/', proposedBytes: null },
  { category: 'Work', path: '/work', proposedBytes: 2818572288 },
  { category: 'Home', path: '/home', proposedBytes: 134217728 },
  { category: 'Tmp', path: '/tmp', proposedBytes: 134217728 },
  { category: 'Dev', path: '/dev', proposedBytes: 67108864 },
  { category: 'DevShm', path: '/dev/shm', proposedBytes: 67108864 },
  { category: 'Other', path: null, proposedBytes: null },
] as const;
type Category = (typeof definitions)[number]['category'];
type Mount = {
  valid: boolean;
  id: string;
  device: string;
  path: string;
  category: Category;
  writable: boolean;
  tmpfs: boolean;
  bytes: Option.Option<number>;
  sizeOverflow: boolean;
};
const escapes: Record<string, string> = {
  '\\040': ' ',
  '\\011': '\t',
  '\\012': '\n',
  '\\134': '\\',
};
function decodePath(path: string) {
  return path.replace(/\\(040|011|012|134)/gu, (escape) => escapes[escape] ?? '');
}
function validPath(encoded: string) {
  const path = decodePath(encoded);
  const parts = path.split('/').slice(1);
  return [
    !/\\(?!040|011|012|134)/u.test(encoded),
    path.startsWith('/'),
    isRoot(path) || !path.endsWith('/'),
    isRoot(path) || parts.every((part) => !['', '.', '..'].includes(part)),
  ].every(Boolean);
}
function validField(field: string) {
  return (
    Boolean(field) &&
    !/\\(?!040|011|012|134)/u.test(field) &&
    field
      .split('')
      .every((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
  );
}
function readMount(line: string): Mount {
  const fields = line.split(' ');
  const separator = fields.indexOf('-');
  const [id = '', parent = '', device = '', root = '', encodedPath = '', options = ''] = fields;
  const path = decodePath(encodedPath);
  const flags = options.split(',');
  const superFlags = (fields[separator + 3] ?? '').split(',');
  const access = flags.filter(isAccess);
  const superAccess = superFlags.filter(isAccess);
  const sizes = superFlags.filter((flag) => flag.startsWith('size='));
  const size = /^size=([1-9][0-9]*)k$/u.exec(sizes[0] ?? '');
  const number = Number(size?.[1]) * 1024;
  const bytes = Option.liftPredicate(number, (value) =>
    [sizes.length === 1, Number.isSafeInteger(value), value > 0].every(Boolean),
  );
  return {
    valid: [
      line.length <= 4096,
      separator >= 6,
      fields.length === separator + 4,
      fields.every(validField),
      /^[1-9][0-9]*$/u.test(id),
      /^(0|[1-9][0-9]*)$/u.test(parent),
      /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/u.test(device),
      validPath(root),
      validPath(encodedPath),
      [...flags, ...superFlags].every((flag) => Boolean(flag) && !/\s/u.test(flag)),
      access.length === 1,
      superAccess.length === 1,
    ].every(Boolean),
    id,
    device,
    path,
    category: definitions.find((definition) => definition.path === path)?.category ?? 'Other',
    writable: isReadWrite(access[0]) && isReadWrite(superAccess[0]),
    tmpfs: isTmpfs(fields[separator + 1]),
    bytes,
    sizeOverflow: sizes.length === 1 && size !== null && !Number.isSafeInteger(number),
  };
}
function emptyReport(input: 'Invalid' | 'TooLarge') {
  return {
    _tag: 'ReadinessOnly' as const,
    input,
    kernelMountPolicy: 'Unreviewed' as const,
    budgetBytes,
    writableTmpfsBytes: null,
    categories: [],
    findings: [],
  };
}
function isWritableTmpfs(mount: Mount) {
  return mount.writable && mount.tmpfs;
}
function sumCapacity(mounts: ReadonlyArray<Mount>) {
  const writableTmpfs = mounts.filter(isWritableTmpfs);
  const capacities = writableTmpfs.map((mount) => mount.bytes);
  const known = capacities.flatMap(Option.toArray).reduce((sum, value) => sum + value, 0);
  return {
    unknown: writableTmpfs.some((mount) => Option.isNone(mount.bytes) && !mount.sizeOverflow),
    overflow: !Number.isSafeInteger(known) || writableTmpfs.some((mount) => mount.sizeOverflow),
    known,
    bytes: Option.getOrNull(
      Option.liftPredicate(known, (value) =>
        [capacities.every(Option.isSome), Number.isSafeInteger(value)].every(Boolean),
      ),
    ),
  };
}
function categoryReport(mounts: ReadonlyArray<Mount>, definition: (typeof definitions)[number]) {
  const selected = mounts.filter((mount) => mount.category === definition.category);
  return {
    category: definition.category,
    count: selected.length,
    writableTmpfsBytes: sumCapacity(selected).bytes,
    proposedBytes: definition.proposedBytes,
  };
}
function hasDuplicate(values: ReadonlyArray<string>) {
  return new Set(values).size !== values.length;
}
function isWritableSubmount(mount: Mount) {
  return [
    mount.writable,
    !isDevShm(mount.path),
    ['/work/', '/home/', '/tmp/', '/dev/'].some((prefix) => mount.path.startsWith(prefix)),
  ].every(Boolean);
}
function proposedCapacityMismatch(category: ReturnType<typeof categoryReport>) {
  return [
    category.proposedBytes !== null,
    category.count !== 1 || category.writableTmpfsBytes !== category.proposedBytes,
  ].every(Boolean);
}
function reportMounts(mounts: ReadonlyArray<Mount>) {
  const writable = mounts.filter((mount) => mount.writable);
  const capacity = sumCapacity(mounts);
  const categories = definitions.map((definition) => categoryReport(mounts, definition));
  const conditions = [
    { finding: 'DuplicateId', observed: hasDuplicate(mounts.map((mount) => mount.id)) },
    {
      finding: 'WritableDeviceAlias',
      observed: hasDuplicate(writable.map((mount) => mount.device)),
    },
    { finding: 'Overmount', observed: hasDuplicate(mounts.map((mount) => mount.path)) },
    { finding: 'WritableRoot', observed: writable.some((mount) => isRoot(mount.path)) },
    { finding: 'WritableSubmount', observed: mounts.some(isWritableSubmount) },
    {
      finding: 'UnexpectedWritableMount',
      observed: writable.some((mount) => isOther(mount.category)),
    },
    { finding: 'UnknownCapacity', observed: capacity.unknown },
    { finding: 'CapacityOverflow', observed: capacity.overflow },
    { finding: 'OverBudget', observed: capacity.known > budgetBytes },
    {
      finding: 'ProposedCapacityMismatch',
      observed: categories.some(proposedCapacityMismatch),
    },
  ] as const;
  return {
    _tag: 'ReadinessOnly' as const,
    input: 'Parsed' as const,
    kernelMountPolicy: 'Unreviewed' as const,
    budgetBytes,
    writableTmpfsBytes: capacity.bytes,
    categories,
    findings: conditions
      .filter((condition) => condition.observed)
      .map((condition) => condition.finding),
  };
}
function inspectString(input: string) {
  const tooLarge = input.length > 65536 || new TextEncoder().encode(input).length > 65536;
  return Match.value(tooLarge).pipe(
    Match.when(true, () => emptyReport('TooLarge')),
    Match.orElse(() => inspectLines(input)),
  );
}
function inspectLines(input: string) {
  const lines = input.split('\n');
  const last = lines.at(-1);
  const content = Match.value(last).pipe(
    Match.when('', () => lines.slice(0, -1)),
    Match.orElse(() => lines),
  );
  const mounts = content.map(readMount);
  return Match.value(content.length > 256).pipe(
    Match.when(true, () => emptyReport('TooLarge')),
    Match.orElse(() => inspectParsed(mounts)),
  );
}
function inspectParsed(mounts: ReadonlyArray<Mount>) {
  return Match.value(mounts.length > 0 && mounts.every((mount) => mount.valid)).pipe(
    Match.when(true, () => reportMounts(mounts)),
    Match.orElse(() => emptyReport('Invalid')),
  );
}
export function inspectMountInventory(input: unknown) {
  return Match.value(input).pipe(
    Match.when(isString, inspectString),
    Match.orElse(() => emptyReport('Invalid')),
  );
}
