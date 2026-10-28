#ifdef NDEBUG
#error "These tests require assertions and must not be built with NDEBUG"
#endif

#include "../src/internal/linux-fs-boundary.h"

#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>

struct fake {
  int fail_open, fail_stat, fail_close, calls, closed, flags, resolve;
  struct ceirean_fs_stat stat;
};

static int open_path(void *ctx, int root, const char *path, int flags, int resolve) {
  struct fake *f = ctx;
  ++f->calls;
  assert(root == 7 && strcmp(path, "input/file") == 0);
  f->flags = flags; f->resolve = resolve;
  if (f->fail_open) { errno = ENOSYS; return -1; }
  return 10;
}
static int stat_fd(void *ctx, int fd, struct ceirean_fs_stat *out) {
  struct fake *f = ctx;
  ++f->calls; assert(fd == 10);
  if (f->fail_stat) { errno = EIO; return -1; }
  *out = f->stat;
  return 0;
}
static int close_fd(void *ctx, int fd) {
  struct fake *f = ctx;
  assert(fd == 10); ++f->closed;
  if (f->fail_close) { errno = EINTR; return -1; }
  return 0;
}
static const struct ceirean_fs_ops ops = {open_path, stat_fd, close_fd};
static struct fake fresh(void) {
  struct fake f = {0};
  f.stat = (struct ceirean_fs_stat){42, 99, 1, 1};
  return f;
}
static int run(struct fake *f, const char *path, size_t len, int *out) {
  return ceirean_fs_inspect_with(&ops, f, 7, path, len, out);
}
static void test_success(void) {
  struct fake f = fresh(); int out = -9;
  assert(run(&f, "input/file", 10, &out) == 0 && out == 10);
  assert(f.flags == CEIREAN_PATH_FLAGS && f.resolve == CEIREAN_RESOLVE_FLAGS);
  assert(f.calls == 2 && f.closed == 0);
}
static void test_invalid_paths(void) {
  const char *bad[] = {"", "/a", ".", "..", "a/../b", "a/./b", "a//b", "a/", "a\0b"};
  size_t lens[] = {0, 2, 1, 2, 6, 5, 4, 2, 3};
  for (size_t i = 0; i < sizeof(bad)/sizeof(bad[0]); ++i) {
    struct fake f = fresh(); int out = 5;
    assert(run(&f, bad[i], lens[i], &out) == -1 && errno == EINVAL && out == -1 && f.calls == 0);
  }
  struct fake f = fresh(); int out = 5;
  assert(run(&f, NULL, 1, &out) == -1 && errno == EINVAL && out == -1);
  assert(run(&f, "x", CEIREAN_FS_PATH_MAX + 1, &out) == -1 && errno == ENAMETOOLONG);
  assert(ceirean_fs_inspect_with(&ops, &f, -1, "x", 1, &out) == -1 && errno == EINVAL);
  assert(ceirean_fs_inspect_with(&ops, &f, 7, "x", 1, NULL) == -1 && errno == EINVAL);
  assert(ceirean_fs_inspect_with(NULL, &f, 7, "x", 1, &out) == -1 && errno == EINVAL);
}
static void test_errors(void) {
  struct fake f = fresh(); int out = 5; f.fail_open = 1;
  assert(run(&f, "input/file", 10, &out) == -1 && errno == ENOSYS && out == -1 && f.closed == 0);
  f = fresh(); f.fail_stat = 1; f.fail_close = 1;
  assert(run(&f, "input/file", 10, &out) == -1 && errno == EIO && out == -1 && f.closed == 1);
  for (int n = 0; n < 3; ++n) {
    f = fresh();
    if (n == 0) f.stat.regular = 0;
    if (n == 1) f.stat.links = 0;
    if (n == 2) f.stat.links = 2;
    assert(run(&f, "input/file", 10, &out) == -1 && errno == EPERM && out == -1 && f.closed == 1);
  }
}

struct reopen_fake {
  int calls, fail_at, closed, closed_fd, close_fails, flags, result_fd;
  struct ceirean_fs_stat path_stat, read_stat;
};
static int reopen_step(struct reopen_fake *f) {
  if (++f->calls == f->fail_at) { errno = EIO; return -1; }
  return 0;
}
static int check_path_fd(void *ctx, int fd) {
  assert(fd == 10);
  return reopen_step(ctx);
}
static int reopen_stat(void *ctx, int fd, struct ceirean_fs_stat *out) {
  struct reopen_fake *f = ctx;
  assert(fd == 10 || fd == 20);
  if (reopen_step(f)) return -1;
  *out = fd == 10 ? f->path_stat : f->read_stat;
  return 0;
}
static int open_proc_link(void *ctx, int proc_fd, int path_fd, int flags) {
  struct reopen_fake *f = ctx;
  assert(proc_fd == 11 && path_fd == 10);
  f->flags = flags;
  return reopen_step(f) ? -1 : f->result_fd;
}
static int reopen_close(void *ctx, int fd) {
  struct reopen_fake *f = ctx;
  ++f->closed; f->closed_fd = fd;
  if (f->close_fails) { errno = EINTR; return -1; }
  return 0;
}
static const struct ceirean_fs_reopen_ops reopen_ops = {
  check_path_fd, reopen_stat, open_proc_link, reopen_close
};
static struct reopen_fake reopen_fresh(void) {
  struct reopen_fake f = {0};
  f.result_fd = 20;
  f.path_stat = (struct ceirean_fs_stat){42, 99, 1, 1};
  f.read_stat = f.path_stat;
  return f;
}
static int reopen_run(struct reopen_fake *f, int *out) {
  return ceirean_fs_reopen_with(&reopen_ops, f, 10, 11, out);
}
static void test_reopen_success(void) {
  struct reopen_fake f = reopen_fresh(); int out = -1;
  assert(reopen_run(&f, &out) == 0 && out == 20);
  assert(f.calls == 4 && f.closed == 0 && f.flags == CEIREAN_READ_FLAGS);
}
static void test_reopen_arguments(void) {
  struct reopen_fake f = reopen_fresh(); int out = 5;
  assert(ceirean_fs_reopen_with(&reopen_ops, &f, -1, 11, &out) == -1 && errno == EINVAL && out == -1);
  assert(ceirean_fs_reopen_with(&reopen_ops, &f, 10, -1, &out) == -1 && errno == EINVAL && out == -1);
  assert(ceirean_fs_reopen_with(&reopen_ops, &f, 10, 10, &out) == -1 && errno == EINVAL && out == -1);
  assert(ceirean_fs_reopen_with(&reopen_ops, &f, 10, 11, NULL) == -1 && errno == EINVAL);
  assert(ceirean_fs_reopen_with(NULL, &f, 10, 11, &out) == -1 && errno == EINVAL && out == -1);
  assert(f.calls == 0 && f.closed == 0);
}
static void test_reopen_failures(void) {
  for (int step = 1; step <= 4; ++step) {
    struct reopen_fake f = reopen_fresh(); int out = 5;
    f.fail_at = step; f.close_fails = 1;
    assert(reopen_run(&f, &out) == -1 && errno == EIO && out == -1);
    assert(f.calls == step && f.closed == (step == 4));
    if (f.closed) assert(f.closed_fd == 20);
  }
  for (int n = 0; n < 8; ++n) {
    struct reopen_fake f = reopen_fresh(); int out = 5;
    switch (n) {
      case 0: f.path_stat.regular = 0; break;
      case 1: f.path_stat.links = 0; break;
      case 2: f.path_stat.links = 2; break;
      case 3: f.read_stat.regular = 0; break;
      case 4: f.read_stat.links = 0; break;
      case 5: f.read_stat.links = 2; break;
      case 6: f.read_stat.device++; break;
      case 7: f.read_stat.inode++; break;
    }
    f.close_fails = 1;
    assert(reopen_run(&f, &out) == -1 && errno == EPERM && out == -1);
    assert(f.closed == (n >= 3));
    if (f.closed) assert(f.closed_fd == 20);
    assert(f.calls == (n < 3 ? 2 : 4));
  }
  for (int borrowed = 10; borrowed <= 11; ++borrowed) {
    struct reopen_fake f = reopen_fresh(); int out = 5;
    f.result_fd = borrowed;
    assert(reopen_run(&f, &out) == -1 && errno == EIO && out == -1);
    assert(f.calls == 3 && f.closed == 0);
  }
}
int main(void) {
  test_success(); test_invalid_paths(); test_errors();
  test_reopen_success(); test_reopen_arguments(); test_reopen_failures();
  puts("linux filesystem boundary fake tests passed");
  return 0;
}
