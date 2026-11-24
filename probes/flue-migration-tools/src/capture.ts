/**
 * A bounded byte sink for a child process stream.
 *
 * ADR-0003 requires redaction to run before any bound is applied, so that a
 * bound cannot cut a secret in half and pass both halves through. That cannot
 * hold for memory: a check which writes without stopping would exhaust the
 * process before anything could be redacted. So there are two bounds, and they
 * are not the same thing:
 *
 * - This ceiling, which protects memory. It is generous — far larger than what
 *   an agent is shown — and reaching it means a check emitted megabytes.
 * - The output bound in `redact.ts`, which decides what the agent sees, and
 *   which runs after redaction as the ADR requires.
 *
 * A secret that straddles this ceiling's cut can therefore survive in halves.
 * That is the recorded cost of bounding memory at all, and it is why the ceiling
 * is set where a check would have to be pathological to reach it.
 *
 * The head and a rolling tail are both kept, because a check names the files it
 * objects to throughout its output and dies at the end of it.
 *
 * This module deliberately holds no Effect code. It is a buffer, and reads as
 * one.
 */
export type Captured = Readonly<{ bytes: Uint8Array; dropped: number }>;

export interface Capture {
  push(chunk: Uint8Array): void;
  taken(): Captured;
}

export function openCapture(ceiling: number): Capture {
  const half = Math.max(1, Math.floor(ceiling / 2));
  const front: Uint8Array[] = [];
  const back: Uint8Array[] = [];
  let frontBytes = 0;
  let backBytes = 0;
  let dropped = 0;

  function push(chunk: Uint8Array) {
    // Chunks arrive as views over a reused buffer, so every byte kept is copied.
    const room = Math.max(0, Math.min(half - frontBytes, chunk.byteLength));
    if (room > 0) {
      front.push(new Uint8Array(chunk.subarray(0, room)));
      frontBytes += room;
    }
    const rest = chunk.subarray(room);
    if (rest.byteLength > 0) {
      back.push(new Uint8Array(rest));
      backBytes += rest.byteLength;
    }
    // Shed from the front of the tail, never the end: the end is the newest.
    while (back.length > 1 && backBytes - (back[0]?.byteLength ?? 0) >= half) {
      const shed = back.shift()?.byteLength ?? 0;
      backBytes -= shed;
      dropped += shed;
    }
  }

  function taken(): Captured {
    // A newline where the cut was, so a dropped middle cannot glue the end of
    // one line onto the start of another and invent a third.
    const seam = dropped > 0 ? [new Uint8Array([0x0a])] : [];
    const parts = [...front, ...seam, ...back];
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.byteLength;
    }
    return { bytes, dropped };
  }

  return { push, taken };
}
