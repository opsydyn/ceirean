// Reviewed expectations are independent of the runtime preparation manifest.
export const reviewedInputs = {
  recipeSha256: '2fe78b9af219d41a9f1ad47c8630956d5258d56e564eaebf57977e47e3851bc4',
  images: {
    base: 'mcr.microsoft.com/playwright@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8',
    node: 'docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09',
    bun: 'docker.io/oven/bun@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c',
    helper:
      'docker.io/cloudflare/sandbox@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec',
  },
  commands: {
    install: { cwd: '.', argv: ['bun', 'install', '--frozen-lockfile'] },
    check: { cwd: '.', argv: ['bun', 'run', 'check'] },
    typecheck: { cwd: '.', argv: ['bun', 'typecheck'] },
    test: { cwd: '.', argv: ['bun', 'run', 'test'] },
    build: { cwd: '.', argv: ['bun', 'run', 'build'] },
    storybook: { cwd: 'apps/web', argv: ['bun', 'run', 'build-storybook'] },
  },
  journeys: {
    carousel: {
      path: '/carousel',
      interactions: [
        'button-navigation',
        'pointer-drag-and-settle',
        'mobile-pointer-drag-and-settle',
      ],
    },
    promoLine: {
      path: '/examples/line',
      interactions: ['point-editing', 'generated-settings-consistency'],
    },
  },
} as const;
