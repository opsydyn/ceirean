#define _GNU_SOURCE
#include "linux-fs-boundary.h"

#ifndef __linux__
#error "The filesystem syscall adapter requires Linux"
#endif
#if !defined(__x86_64__) || defined(__ILP32__)
#error "The filesystem syscall adapter supports Linux amd64 only"
#endif

#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

_Static_assert(CEIREAN_PATH_FLAGS == (O_PATH | O_CLOEXEC), "open flags mismatch");
_Static_assert(CEIREAN_READ_FLAGS == (O_RDONLY | O_NONBLOCK | O_NOCTTY | O_CLOEXEC),
               "read flags mismatch");
_Static_assert(CEIREAN_RESOLVE_FLAGS ==
                   (RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV),
               "resolve flags mismatch");

static int open_path(void *ctx, int root, const char *path, int flags, int resolve) {
  (void)ctx;
  struct open_how how = {.flags = (uint64_t)flags, .resolve = (uint64_t)resolve};
  return (int)syscall(SYS_openat2, root, path, &how, sizeof(how));
}
static int stat_fd(void *ctx, int fd, struct ceirean_fs_stat *out) {
  (void)ctx;
  struct stat stat;
  if (fstat(fd, &stat) < 0) return -1;
  *out = (struct ceirean_fs_stat){(uint64_t)stat.st_dev, (uint64_t)stat.st_ino,
                                  (uint64_t)stat.st_nlink, S_ISREG(stat.st_mode)};
  return 0;
}
static int close_fd(void *ctx, int fd) { (void)ctx; return close(fd); }
static int check_path_fd(void *ctx, int fd) {
  (void)ctx;
  int flags = fcntl(fd, F_GETFL);
  if (flags < 0) return -1;
  if (!(flags & O_PATH)) { errno = EINVAL; return -1; }
  return 0;
}
static int open_proc_link(void *ctx, int proc_fd, int path_fd, int flags) {
  (void)ctx;
  char name[32];
  int length = snprintf(name, sizeof(name), "%d", path_fd);
  if (length < 0 || (size_t)length >= sizeof(name)) { errno = EOVERFLOW; return -1; }
  return openat(proc_fd, name, flags);
}

int ceirean_fs_inspect_linux(int root_fd, const char *path, size_t path_len,
                             int *out_fd) {
  static const struct ceirean_fs_ops ops = {open_path, stat_fd, close_fd};
  return ceirean_fs_inspect_with(&ops, NULL, root_fd, path, path_len, out_fd);
}

int ceirean_fs_reopen_linux(int path_fd, int proc_fd, int *out_fd) {
  static const struct ceirean_fs_reopen_ops ops = {
    check_path_fd, stat_fd, open_proc_link, close_fd
  };
  return ceirean_fs_reopen_with(&ops, NULL, path_fd, proc_fd, out_fd);
}
