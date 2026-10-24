FROM docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09 AS node22
FROM docker.io/oven/bun@sha256:38919894db4e117a37f74e3dca503e84f24d97f19cabc5f499a289c2a5d0db7c AS bun
FROM docker.io/cloudflare/sandbox@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec AS helper
FROM mcr.microsoft.com/playwright@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8

COPY --from=node22 /usr/local/ /usr/local/
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=helper /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

ENV PATH="/usr/local/bin:/usr/bin:/bin"
ENV PLAYWRIGHT_BROWSERS_PATH="/ms-playwright"
ENV DO_NOT_TRACK="1"
ENV ASTRO_TELEMETRY_DISABLED="1"

RUN ln -sf /usr/local/bin/node /usr/bin/node \
    && test "$(node --version)" = "v22.23.4" \
    && test "$(bun --version)" = "1.3.11" \
    && test "$(git --version)" = "git version 2.43.0" \
    && test -x /ms-playwright/chromium-1248/chrome-linux64/chrome \
    && install -d -o pwuser -g pwuser /workspace /opt/ceirean/payload

# Trusted preparation must supply these inventoried archives before an approved build.
COPY --chown=pwuser:pwuser payload/source.tar payload/bun-cache.tar payload/npm-cache.tar payload/browser-harness.tar payload/SHA256SUMS /opt/ceirean/payload/
RUN cd /opt/ceirean/payload && sha256sum --strict -c SHA256SUMS

WORKDIR /workspace
USER pwuser
CMD ["sleep", "infinity"]
