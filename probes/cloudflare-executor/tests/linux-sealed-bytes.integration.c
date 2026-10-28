#define _GNU_SOURCE
#ifndef __linux__
#error "This test requires Linux"
#endif
#ifdef NDEBUG
#error "Tests require assertions"
#endif

#include "../src/internal/linux-sealed-bytes.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  char path[] = "/tmp/ceirean-sealed-bytes.XXXXXXXX";
  char data[8] = {0};
  int source = mkstemp(path), sealed = -1, pipes[2];
  assert(source >= 0);
  assert(unlink(path) == 0);
  assert(write(source, "abcdef", 6) == 6);
  assert(lseek(source, 1, SEEK_SET) == 1);
  assert(ceirean_sealed_bytes_linux(source, 5, &sealed) == 0 && sealed >= 0);
  int descriptor_flags = fcntl(sealed, F_GETFD);
  assert(descriptor_flags >= 0 && (descriptor_flags & FD_CLOEXEC) != 0);
  int seals = fcntl(sealed, F_GET_SEALS);
  assert(seals >= 0 && (seals & CEIREAN_SEALED_BYTES_SEALS) == CEIREAN_SEALED_BYTES_SEALS);
  assert(lseek(sealed, 0, SEEK_CUR) == 0);
  assert(read(sealed, data, sizeof(data)) == 5 && memcmp(data, "bcdef", 5) == 0);
  errno = 0; assert(write(sealed, "x", 1) == -1 && errno == EPERM);
  errno = 0; assert(ftruncate(sealed, 6) == -1 && errno == EPERM);
  errno = 0; assert(ftruncate(sealed, 4) == -1 && errno == EPERM);
  errno = 0; assert(fcntl(sealed, F_ADD_SEALS, F_SEAL_WRITE) == -1 && errno == EPERM);
  assert(close(sealed) == 0);

  assert(lseek(source, 0, SEEK_SET) == 0);
  sealed = 99;
  assert(ceirean_sealed_bytes_linux(source, 5, &sealed) == -1 && errno == EFBIG && sealed == -1);
  assert(fcntl(source, F_GETFD) >= 0);
  assert(pipe(pipes) == 0);
  sealed = 99;
  assert(ceirean_sealed_bytes_linux(pipes[0], 5, &sealed) == -1 && errno == EPERM && sealed == -1);
  assert(fcntl(pipes[0], F_GETFD) >= 0);
  assert(close(pipes[0]) == 0 && close(pipes[1]) == 0 && close(source) == 0);
  puts("linux sealed bytes native integration passed");
  return 0;
}
