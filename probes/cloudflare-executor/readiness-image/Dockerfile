# Candidate assembly only. Fresh context admission, including regular-file,
# symlink and secret checks, remains blocked and is not proved by .dockerignore.
FROM docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09 AS node22
FROM docker.io/oven/bun@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c AS bun
FROM mcr.microsoft.com/playwright@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8

COPY --from=node22 /usr/local/ /usr/local/
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --chown=root:root --chmod=0444 input/readiness-worker.mjs /opt/ceirean/readiness-worker.mjs
COPY --chown=root:root --chmod=0555 input/strace /usr/local/bin/strace
COPY --chown=root:root --chmod=0555 input/observer-canary /usr/local/bin/observer-canary

USER pwuser
CMD ["/usr/local/bin/bun", "--no-env-file", "--no-install", "/opt/ceirean/readiness-worker.mjs", "--worker"]
