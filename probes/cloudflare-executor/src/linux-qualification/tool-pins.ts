// Acquisition authority is independent of observed receipt/manifests.
export const toolPins = {
  installerImage:
    'docker.io/oven/bun@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c',
  nodeImage:
    'docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09',
  controller: {
    package: '@oven/bun-linux-x64@1.4.2',
    url: 'https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.4.2.tgz',
    integrity:
      'sha512-9/E/UXOTpSo3YsV5g+FhtTd/qTpiWoKuxS12cqtuYA1ssu9fRAoPQnipFgGyck3tWO63iUdxBiygq+kELFawng==',
  },
  effect: '4.0.5',
  npm: '10.9.9',
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
} as const;

export const inputPins = {
  sourceRevision: 'b7484cb46e66b162c8afddcfba235c9507b4f0ab',
  sourceTree: '8fcd5b7960541679a163dcbfbf60393e1e256241',
  inventorySha256: 'd416b758e7410ad2069120b58df9272bed86c4ef9d24a3088d4904e46d7308cb',
  lockSha256: '47fbd0c33dc391b1ac3d801ab5fb2db638d901d419c67222f708d186065ac19d',
} as const;

export const qualificationInstall = {
  cwd: '.',
  argv: [
    'bun',
    'install',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--backend=copyfile',
    '--registry=http://127.0.0.1:4873',
  ],
} as const;
