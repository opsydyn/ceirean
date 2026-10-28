#define _GNU_SOURCE
#if !defined(__linux__) || !defined(__x86_64__) || defined(__ILP32__)
#error "This integration test requires Linux amd64"
#endif
#ifdef NDEBUG
#error "These tests require assertions and must not be built with NDEBUG"
#endif

#include "../src/internal/linux-fs-boundary.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static void create_file(int root, const char *name, const char *content) {
  int fd = openat(root, name, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  size_t length = strlen(content);
  assert(fd >= 0);
  assert(write(fd, content, length) == (ssize_t)length);
  assert(close(fd) == 0);
}

static void test_identity_and_flags(int root, int proc) {
  int path = -1, read_fd = -1;
  struct stat path_stat, read_stat;
  char bytes[16] = {0};

  create_file(root, "sample", "original");
  assert(ceirean_fs_inspect_linux(root, "sample", 6, &path) == 0);
  int path_flags = fcntl(path, F_GETFL);
  assert(path_flags >= 0 && (path_flags & O_PATH) == O_PATH);
  int path_descriptor_flags = fcntl(path, F_GETFD);
  assert(path_descriptor_flags >= 0 && (path_descriptor_flags & FD_CLOEXEC) == FD_CLOEXEC);
  assert(renameat(root, "sample", root, "moved") == 0);
  create_file(root, "sample", "replacement");

  assert(ceirean_fs_reopen_linux(path, proc, &read_fd) == 0);
  int flags = fcntl(read_fd, F_GETFL);
  assert(flags >= 0 && (flags & O_ACCMODE) == O_RDONLY);
  assert((flags & O_NONBLOCK) == O_NONBLOCK);
  int read_descriptor_flags = fcntl(read_fd, F_GETFD);
  assert(read_descriptor_flags >= 0 && (read_descriptor_flags & FD_CLOEXEC) == FD_CLOEXEC);
  assert(fstat(path, &path_stat) == 0 && fstat(read_fd, &read_stat) == 0);
  assert(S_ISREG(read_stat.st_mode));
  assert(path_stat.st_dev == read_stat.st_dev && path_stat.st_ino == read_stat.st_ino);
  assert(read(read_fd, bytes, sizeof(bytes)) == 8 && memcmp(bytes, "original", 8) == 0);
  assert(close(read_fd) == 0);
  assert(close(path) == 0);
  assert(unlinkat(root, "sample", 0) == 0);
  assert(unlinkat(root, "moved", 0) == 0);
}

static void test_refusals(int root, int proc) {
  int fd = 123;
  create_file(root, "regular", "data");
  assert(symlinkat("regular", root, "symlink") == 0);
  assert(ceirean_fs_inspect_linux(root, "symlink", 7, &fd) == -1 && errno == ELOOP && fd == -1);
  assert(mkdirat(root, "inside", 0700) == 0);
  create_file(root, "inside/file", "data");
  assert(symlinkat("inside", root, "dirlink") == 0);
  assert(ceirean_fs_inspect_linux(root, "dirlink/file", 12, &fd) == -1 && errno == ELOOP && fd == -1);
  assert(mkfifoat(root, "fifo", 0600) == 0);
  assert(ceirean_fs_inspect_linux(root, "fifo", 4, &fd) == -1 && errno == EPERM && fd == -1);
  int path_fd = -1;
  assert(ceirean_fs_inspect_linux(root, "regular", 7, &path_fd) == 0);
  assert(linkat(root, "regular", root, "hardlink", 0) == 0);
  assert(ceirean_fs_inspect_linux(root, "regular", 7, &fd) == -1 && errno == EPERM && fd == -1);
  assert(ceirean_fs_reopen_linux(path_fd, proc, &fd) == -1 && errno == EPERM && fd == -1);
  assert(close(path_fd) == 0);
  assert(unlinkat(root, "hardlink", 0) == 0);

  int normal_fd = openat(root, "regular", O_RDONLY | O_CLOEXEC);
  assert(normal_fd >= 0);
  assert(ceirean_fs_reopen_linux(normal_fd, proc, &fd) == -1 && errno == EINVAL && fd == -1);
  assert(close(normal_fd) == 0);
  assert(unlinkat(root, "symlink", 0) == 0);
  assert(unlinkat(root, "dirlink", 0) == 0);
  assert(unlinkat(root, "inside/file", 0) == 0);
  assert(unlinkat(root, "inside", AT_REMOVEDIR) == 0);
  assert(unlinkat(root, "fifo", 0) == 0);
  assert(unlinkat(root, "regular", 0) == 0);
}

int main(void) {
  char directory[] = "/tmp/ceirean-fs-integration.XXXXXXXX";
  assert(mkdtemp(directory) != NULL);
  int root = open(directory, O_PATH | O_DIRECTORY | O_CLOEXEC);
  int proc = open("/proc/self/fd", O_PATH | O_DIRECTORY | O_CLOEXEC);
  assert(root >= 0 && proc >= 0);
  test_identity_and_flags(root, proc);
  test_refusals(root, proc);
  assert(close(proc) == 0 && close(root) == 0);
  assert(rmdir(directory) == 0);
  puts("linux filesystem boundary native integration passed");
  return 0;
}
