import { Match, Option } from 'effect';

/**
 * Redaction for check output, per
 * [ADR-0003](../../docs/decisions/0003-bounded-redacted-check-output.md).
 *
 * Slice 1 discarded a check's output entirely. Returning it reopens a channel
 * that was closed on purpose, so everything here is a security rule rather than
 * formatting, and `tests/redact.test.ts` holds the rules themselves.
 *
 * The order is deliberate and must not be rearranged: decode, strip escapes,
 * remove secrets, rewrite paths, then bound. Bounding first could cut a secret
 * in half and pass both halves through as ordinary text.
 */

const encoder = new TextEncoder();
/** Lossy by design: a checker that emits odd bytes should still say something. */
const decoder = new TextDecoder('utf-8');

function byteLength(value: string) {
  return encoder.encode(value).byteLength;
}

// These patterns are built rather than written as literals. Their subject is
// control characters, and a literal containing one is itself a lint error, so
// the escape character is composed in and the remaining control characters are
// removed by code point below instead of by a character class.
const esc = String.fromCharCode(27);
// Operating-system command sequences first: they swallow text up to a
// terminator, so removing shorter sequences inside them would leave the tail.
const osc = new RegExp(
  `${esc}\\][^${esc}${String.fromCharCode(7)}]*(?:${String.fromCharCode(7)}|${esc}\\\\)`,
  'g',
);
const csi = new RegExp(`${esc}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const other = new RegExp(`${esc}[@-Z\\\\-_]?`, 'g');

/**
 * Everything in C0 and C1 survives only as tab or newline. A carriage return
 * becomes a newline rather than being dropped, so output that used it to
 * overwrite a progress line arrives as two readable lines instead of one
 * misleading one.
 */
function within(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), high) === value;
}

function printable(character: string) {
  const code = character.codePointAt(0) ?? 0;
  const control = [within(code, 0, 0x1f), code === 0x7f, within(code, 0x80, 0x9f)].some(Boolean);
  const kept = ['\n', '\t'].includes(character);
  return [kept, !control].some(Boolean);
}

function strip(text: string) {
  const unescaped = text.replaceAll(osc, '').replaceAll(csi, '').replaceAll(other, '');
  const lined = unescaped.replaceAll('\r', '\n');
  return [...lined].filter(printable).join('');
}

/**
 * Credential shapes. This is pattern matching, not entropy analysis: it catches
 * the forms a checker is likely to echo and does not claim to catch an arbitrary
 * secret. The real control is that the child's environment holds none.
 */
const secrets: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\s*=\s*\S+/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bsk-[A-Za-z0-9-]{16,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
];

function deidentify(text: string) {
  return secrets.reduce((carried, pattern) => carried.replaceAll(pattern, '<redacted>'), text);
}

/**
 * An absolute path. The leading `/` must begin a token, or the pattern would
 * also match the separator inside a relative path and turn `src/a.ts` into
 * `src<path>`. It stops before a `:` so a `file.ts:12:3` suffix survives the
 * rewrite and the agent keeps the line number it needs.
 */
const absolute = /(?<=^|[\s'"([{=,])\/[^\s:]*/gm;

/** Path syntax, named so neither segment reads as a magic string. */
function pathSegments() {
  return { current: '.', parent: '..' };
}
const segments = pathSegments();

function resolve(stack: ReadonlyArray<string>, part: string) {
  const popped = stack.slice(0, -1);
  const pushed = stack.concat(part);
  return Match.value(part).pipe(
    Match.when(segments.parent, () => popped),
    Match.orElse(() => pushed),
  );
}

function normalise(value: string) {
  const meaningful = (part: string) => part.length > 0 && part !== segments.current;
  const parts = value.split('/').filter(meaningful);
  const stack = parts.reduce<ReadonlyArray<string>>(resolve, []);
  return `/${stack.join('/')}`;
}

/**
 * A path under the checkout root becomes relative to it; anything else becomes
 * `<path>`. Normalising first is what makes `root/../outside/secret.ts` land
 * outside rather than being rewritten into a readable relative path.
 */
function place(value: string, root: string) {
  const normalised = normalise(value);
  const position = [normalised === root, normalised.startsWith(`${root}/`)].findIndex(Boolean);
  return Match.value(position).pipe(
    Match.when(0, () => '.'),
    Match.when(1, () => normalised.slice(root.length + 1)),
    Match.orElse(() => '<path>'),
  );
}

function relocate(text: string, root: string) {
  return text.replaceAll(absolute, (match) => place(match, root));
}

/** Cut one line to a byte bound, dropping a character the cut would split. */
function clampLine(line: string, maximum: number) {
  const bytes = encoder.encode(line);
  const cut = decoder.decode(bytes.subarray(0, maximum)).replace(/�+$/u, '');
  const whole = Option.liftPredicate(line, () => bytes.byteLength <= maximum);
  return Option.getOrElse(whole, () => cut);
}

function marker(omitted: number) {
  return `\n[... ${omitted} bytes omitted ...]\n`;
}

export type RedactedOutput = Readonly<{
  text: string;
  /** Bytes the bounds dropped, after redaction. Truncation is never silent. */
  omitted: number;
}>;

/**
 * Keep the head and the tail. Checkers name the files they object to throughout
 * their output and a crash appears at the end, so keeping one end loses whichever
 * mattered. The marker is sized against the largest count it could carry, so the
 * result never exceeds the bound.
 */
function clampTotal(text: string, maximum: number): RedactedOutput {
  const bytes = encoder.encode(text);
  const reserved = byteLength(marker(bytes.byteLength));
  const budget = Math.max(0, maximum - reserved);
  const front = Math.floor(budget / 2);
  const head = decoder.decode(bytes.subarray(0, front)).replace(/�+$/u, '');
  const back = bytes.subarray(bytes.byteLength - (budget - front));
  const tail = decoder.decode(back).replace(/^�+/u, '');
  const omitted = bytes.byteLength - byteLength(head) - byteLength(tail);
  const cut = { text: `${head}${marker(omitted)}${tail}`, omitted };
  const whole = Option.liftPredicate(text, () => bytes.byteLength <= maximum);
  return Option.match(whole, {
    onNone: () => cut,
    onSome: (value) => ({ text: value, omitted: 0 }),
  });
}

export type OutputBounds = Readonly<{ total: number; line: number }>;

/**
 * Turn one captured stream into what an agent may see.
 *
 * `root` is the checkout root, already resolved. It is removed in every form:
 * as a prefix, on its own, and as the base of a path that normalises outside it.
 */
export function redactOutput(
  captured: Uint8Array,
  root: string,
  bounds: OutputBounds,
): RedactedOutput {
  const decoded = decoder.decode(captured);
  const cleaned = strip(decoded);
  const deidentified = deidentify(cleaned);
  const relocated = relocate(deidentified, root);
  const lines = relocated.split('\n').map((line) => clampLine(line, bounds.line));
  const bounded = lines.join('\n');
  const dropped = byteLength(relocated) - byteLength(bounded);
  const limited = clampTotal(bounded, bounds.total);
  return { text: limited.text, omitted: limited.omitted + dropped };
}
