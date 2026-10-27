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
  rootIsFilesystemRoot: boolean;
  writable: boolean;
  tmpfs: boolean;
  bytes: Option.Option<number>;
  sizeOverflow: boolean;
  filesystem: string;
  flags: ReadonlyArray<string>;
  access: string;
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
  const mountAccess = Match.value(access[0] === superAccess[0]).pipe(
    Match.when(true, () => access[0] ?? ''),
    Match.orElse(() => ''),
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
    rootIsFilesystemRoot: isRoot(decodePath(root)),
    writable: isReadWrite(access[0]) && isReadWrite(superAccess[0]),
    tmpfs: isTmpfs(fields[separator + 1]),
    bytes,
    sizeOverflow: sizes.length === 1 && size !== null && !Number.isSafeInteger(number),
    filesystem: fields[separator + 1] ?? '',
    flags: [...flags, ...superFlags],
    access: mountAccess,
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
  const rootCount = mounts.filter((mount) => isRoot(mount.path)).length;
  const conditions = [
    { finding: 'DuplicateId', observed: hasDuplicate(mounts.map((mount) => mount.id)) },
    {
      finding: 'WritableDeviceAlias',
      observed: hasDuplicate(writable.map((mount) => mount.device)),
    },
    { finding: 'Overmount', observed: hasDuplicate(mounts.map((mount) => mount.path)) },
    { finding: 'MissingRoot', observed: rootCount === 0 },
    { finding: 'AmbiguousRoot', observed: rootCount > 1 },
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
    findings: [
      ...conditions.filter((condition) => condition.observed).map((condition) => condition.finding),
      ...definitions
        .filter(
          (definition) =>
            definition.proposedBytes !== null &&
            mounts.some(
              (mount) => mount.category === definition.category && !mount.rootIsFilesystemRoot,
            ),
        )
        .map((definition) => `NonRootMountRoot:${definition.category}`),
    ],
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

const detailPaths = [
  ['Root', '/'],
  ['Work', '/work'],
  ['Home', '/home'],
  ['Tmp', '/tmp'],
  ['Dev', '/dev'],
  ['DevShm', '/dev/shm'],
  ['Proc', '/proc'],
  ['Sys', '/sys'],
  ['Cgroup', '/sys/fs/cgroup'],
  ['DevPts', '/dev/pts'],
] as const;
const knownTypes = [
  'overlay',
  'tmpfs',
  'proc',
  'sysfs',
  'cgroup2',
  'devpts',
  'ext4',
  'xfs',
] as const;
const isParsed = Schema.is(Schema.Literal('Parsed'));
function unambiguousFlags(flags: ReadonlyArray<string>) {
  const nonAccess = flags
    .filter((entry) => !isAccess(entry))
    .map((entry) => entry.split('=')[0] ?? '');
  const conflicting = [
    ['nosuid', 'suid'],
    ['nodev', 'dev'],
    ['noexec', 'exec'],
  ].some((pair) => pair.every((entry) => flags.includes(entry)));
  return !hasDuplicate(nonAccess) && !conflicting;
}
function mountDetail(mounts: ReadonlyArray<Mount>, [category, path]: (typeof detailPaths)[number]) {
  const selected = mounts.filter((mount) => mount.path === path);
  const first = selected[0];
  const single = selected.length === 1;
  const filesystem = knownTypes.find((type) => type === first?.filesystem) ?? 'Unknown';
  const access = Match.value(first?.access).pipe(
    Match.when(isAccess, (value) => value),
    Match.orElse(() => 'Unknown' as const),
  );
  function reviewed<T>(value: T) {
    return Match.value(single).pipe(
      Match.when(true, () => value),
      Match.orElse(() => 'Unknown' as const),
    );
  }
  function reviewedFlag(name: string) {
    const flags = first?.flags ?? [];
    return Match.value(single && unambiguousFlags(flags)).pipe(
      Match.when(true, () => flags.includes(name)),
      Match.orElse(() => 'Unknown' as const),
    );
  }
  const detail = {
    category,
    count: selected.length,
    type: reviewed(filesystem),
    access: reviewed(access),
    nosuid: reviewedFlag('nosuid'),
    nodev: reviewedFlag('nodev'),
    noexec: reviewedFlag('noexec'),
  };
  return Option.toArray(Option.liftPredicate(detail, () => selected.length > 0));
}
export function inspectMountDetails(input: string) {
  const mounts = input.split('\n').filter(Boolean).map(readMount);
  return Match.value(inspectMountInventory(input).input).pipe(
    Match.when(isParsed, () => detailPaths.flatMap((path) => mountDetail(mounts, path))),
    Match.orElse(() => []),
  );
}
