#!/bin/sh
set -eu

directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/ceirean-fs-test.XXXXXXXX")
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

cc -std=c11 -Wall -Wextra -Werror -pedantic \
  "$directory/src/internal/linux-fs-boundary.c" \
  "$directory/tests/linux-fs-boundary.test.c" \
  -o "$temporary/linux-fs-boundary-test"
"$temporary/linux-fs-boundary-test"

if [ "${CEIREAN_RUN_LINUX_FS_INTEGRATION:-0}" = 1 ]; then
  if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
    printf '%s\n' 'Linux filesystem integration requires Linux amd64' >&2
    exit 1
  fi
  cc -std=c11 -Wall -Wextra -Werror -pedantic \
    "$directory/src/internal/linux-fs-boundary.c" \
    "$directory/src/internal/linux-fs-boundary-linux.c" \
    "$directory/tests/linux-fs-boundary.integration.c" \
    -o "$temporary/linux-fs-boundary-integration"
  "$temporary/linux-fs-boundary-integration"
else
  printf '%s\n' 'Linux filesystem integration not requested; not run'
fi
