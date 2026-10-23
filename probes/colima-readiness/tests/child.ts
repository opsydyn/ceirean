#!/Users/alancurrie/.bun/bin/bun
const mode = import.meta.dir.split('/').at(-1);
if (Bun.argv.slice(2).join(',') !== '--version') throw new Error('Unexpected fixture argv');
if (mode === 'stall' || mode === 'flood') {
  if (mode === 'flood') {
    const block = new Uint8Array(8192).fill(120);
    setInterval(() => {
      void Bun.write(Bun.stdout, block);
      void Bun.write(Bun.stderr, block);
    }, 1);
  } else {
    setInterval(() => {}, 1000);
  }
} else if (mode === 'nonzero') {
  await Bun.write(Bun.stderr, 'SYNTHETIC_PRIVATE_DIAGNOSTIC');
  process.exitCode = 7;
} else if (mode === 'invalid') {
  await Bun.write(Bun.stdout, new Uint8Array([0xff]));
} else if (mode === 'environment') {
  await Bun.write(Bun.stdout, Object.keys(Bun.env).sort().join(','));
} else {
  await Bun.write(Bun.stdout, 'colima version 0.9.1\n');
}
