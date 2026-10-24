declare module '*npm/node_modules/cacache/lib/index.js' {
  export function put(
    cache: string,
    key: string,
    data: Uint8Array,
    options?: {
      integrity?: string;
      metadata?: unknown;
    },
  ): Promise<unknown>;
  export namespace get {
    function stream(cache: string, key: string): AsyncIterable<Uint8Array>;
    namespace stream {
      function byDigest(cache: string, integrity: string): AsyncIterable<Uint8Array>;
    }
  }
}
