FROM --platform=linux/amd64 docker.io/library/node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09 AS node22
FROM --platform=linux/amd64 docker.io/oven/bun@sha256:c017a211c49a21adc0e49dda7b60ac8112887c3d9465e01427f434ed107c830e AS bun
FROM --platform=linux/amd64 mcr.microsoft.com/playwright@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8

COPY --from=node22 /usr/local/ /usr/local/
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

ENV PATH="/usr/local/bin:/usr/bin:/bin"
ENV PLAYWRIGHT_BROWSERS_PATH="/ms-playwright"
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="1"
ENV DO_NOT_TRACK="1"
ENV ASTRO_TELEMETRY_DISABLED="1"

RUN ln -sf /usr/local/bin/node /usr/bin/node \
    && test "$(node --version)" = "v22.23.4" \
    && test "$(npm --version)" = "10.9.9" \
    && test "$(bun --version)" = "1.4.3" \
    && test "$(git --version)" = "git version 2.43.0" \
    && test -x /ms-playwright/chromium-1248/chrome-linux64/chrome \
    && test -x /ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
    && install -d -o pwuser -g pwuser /workspace /opt/ceirean/input

# Trusted staging must bind these exact bytes before a separately approved build.
COPY --chown=pwuser:pwuser input/source.tar input/bun-cache.tar input/npm-cache.tar input/browser-harness.tar input/baseline-worker.mjs input/baseline-contract.json input/SHA256SUMS /opt/ceirean/input/
RUN cd /opt/ceirean/input \
    && sha256sum --strict -c SHA256SUMS \
    && printf '%s\n' '928f9451a7522fcae93db4c312358072ae5f929a99e2350929d8050ca5832e25  baseline-contract.json' | sha256sum --strict -c -

WORKDIR /workspace
USER pwuser
CMD ["sleep", "infinity"]
