#define _GNU_SOURCE
#include "linux-sealed-bytes.h"

#ifndef __linux__
#error "The sealed bytes adapter requires Linux"
#endif

#include <errno.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

_Static_assert(CEIREAN_SEALED_BYTES_SEALS ==
               (F_SEAL_SEAL | F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE),
               "seal flags mismatch");

static int is_regular(void *ctx, int fd) {
  struct stat st; (void)ctx;
  if (fstat(fd, &st) < 0) return -1;
  return S_ISREG(st.st_mode) ? 1 : 0;
}
static int create(void *ctx) {
  (void)ctx; return memfd_create("ceirean-sealed-bytes", MFD_CLOEXEC | MFD_ALLOW_SEALING);
}
static ssize_t read_source(void *ctx, int fd, void *buffer, size_t length) {
  (void)ctx; return read(fd, buffer, length);
}
static ssize_t write_dest(void *ctx, int fd, const void *buffer, size_t length) {
  (void)ctx; return write(fd, buffer, length);
}
static int add_seals(void *ctx, int fd, int seals) {
  (void)ctx; return fcntl(fd, F_ADD_SEALS, seals);
}
static int get_seals(void *ctx, int fd) {
  (void)ctx; return fcntl(fd, F_GET_SEALS);
}
static int rewind_fd(void *ctx, int fd) {
  (void)ctx;
  off_t result = lseek(fd, 0, SEEK_SET);
  if (result < 0) return -1;
  if (result != 0) { errno = EIO; return -1; }
  return 0;
}
static int close_fd(void *ctx, int fd) { (void)ctx; return close(fd); }

int ceirean_sealed_bytes_linux(int source_fd, uint64_t cap, int *out_fd) {
  static const struct ceirean_sealed_bytes_ops ops = {
    is_regular, create, read_source, write_dest, add_seals, get_seals, rewind_fd, close_fd
  };
  return ceirean_sealed_bytes_with(&ops, NULL, source_fd, cap, out_fd);
}
