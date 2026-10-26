declare module '*npm/node_modules/tar/dist/esm/header.js' {
  export class Header {
    constructor(block: Uint8Array);
    constructor(fields: {
      path: string;
      type: string;
      mode?: number;
      uid?: number;
      gid?: number;
      uname?: string;
      gname?: string;
      size?: number;
      mtime?: Date;
      linkpath?: string;
      devmaj?: number;
      devmin?: number;
    });
    path: string;
    type: string;
    size: number;
    mode: number;
    uid: number;
    gid: number;
    uname?: string;
    gname?: string;
    linkpath?: string;
    devmaj: number;
    devmin: number;
    encode(block: Uint8Array): boolean;
  }
}
declare module '*npm/node_modules/tar/dist/esm/parse.js' {
  import { Header } from '*npm/node_modules/tar/dist/esm/header.js';
  export interface ReadEntry {
    header: Header;
    path: string;
    type: string;
    size: number;
    remain: number;
    resume(): void;
    on(event: 'end', callback: () => void): this;
  }
  export class Parser {
    constructor(options: {
      strict: boolean;
      maxMetaEntrySize: number;
      brotli: false;
      zstd: false;
      filter(path: string, entry: ReadEntry): boolean;
    });
    on(
      event: 'error' | 'warn' | 'ignoredEntry' | 'meta' | 'nullBlock' | 'eof' | 'end',
      callback: () => void,
    ): this;
    write(bytes: Uint8Array): boolean;
    end(): this;
  }
}
declare module '*npm/node_modules/minizlib/dist/esm/index.js' {
  export class InflateRaw {
    constructor(options: { chunkSize: number });
    readonly handle?: { readonly bytesWritten: number };
    on(event: 'data', callback: (bytes: Uint8Array) => void): this;
    on(event: 'error', callback: () => void): this;
    write(bytes: Uint8Array): boolean;
    end(): this;
    close(): void;
  }
}
