import { lstat } from 'node:fs/promises';

// This boundary supplies only no-follow metadata; all file IO uses FileSystem.
export async function lstatMetadata(path: string) {
  const info = await lstat(path, { bigint: true });
  function fileType() {
    if (info.isFile()) return 'File' as const;
    if (info.isDirectory()) return 'Directory' as const;
    if (info.isSymbolicLink()) return 'SymbolicLink' as const;
    return 'Special' as const;
  }
  return {
    type: fileType(),
    mode: Number(info.mode & 0o7777n),
    size: info.size,
    dev: info.dev,
    ino: info.ino,
    nlink: info.nlink,
  };
}
