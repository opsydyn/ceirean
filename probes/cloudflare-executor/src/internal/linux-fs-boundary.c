#include "linux-fs-boundary.h"

#include <errno.h>
#include <string.h>

int ceirean_fs_inspect_with(const struct ceirean_fs_ops *ops, void *ctx,
                            int root_fd, const char *path, size_t path_len,
                            int *out_fd) {
  char name[CEIREAN_FS_PATH_MAX + 1];
  size_t component = 0;
  int fd, saved;
  struct ceirean_fs_stat stat;

  if (out_fd == NULL) { errno = EINVAL; return -1; }
  *out_fd = -1;
  if (ops == NULL || ops->open_path == NULL || ops->stat_fd == NULL ||
      ops->close_fd == NULL || root_fd < 0 || path == NULL || path_len == 0) {
    errno = EINVAL;
    return -1;
  }
  if (path_len > CEIREAN_FS_PATH_MAX) { errno = ENAMETOOLONG; return -1; }
  memcpy(name, path, path_len);
  name[path_len] = '\0';
  for (size_t i = 0; i <= path_len; ++i) {
    if (i < path_len && name[i] == '\0') { errno = EINVAL; return -1; }
    if (i == path_len || name[i] == '/') {
      size_t size = i - component;
      if (size == 0 || (size == 1 && name[component] == '.') ||
          (size == 2 && name[component] == '.' && name[component + 1] == '.')) {
        errno = EINVAL;
        return -1;
      }
      component = i + 1;
    }
  }
  fd = ops->open_path(ctx, root_fd, name, CEIREAN_PATH_FLAGS, CEIREAN_RESOLVE_FLAGS);
  if (fd < 0) return -1;
  if (ops->stat_fd(ctx, fd, &stat) < 0) {
    saved = errno;
    (void)ops->close_fd(ctx, fd);
    errno = saved;
    return -1;
  }
  if (!stat.regular || stat.links != 1) {
    (void)ops->close_fd(ctx, fd);
    errno = EPERM;
    return -1;
  }
  *out_fd = fd;
  return 0;
}

int ceirean_fs_reopen_with(const struct ceirean_fs_reopen_ops *ops, void *ctx,
                           int path_fd, int proc_fd, int *out_fd) {
  struct ceirean_fs_stat before, after;
  int fd, saved;

  if (out_fd == NULL) { errno = EINVAL; return -1; }
  *out_fd = -1;
  if (ops == NULL || ops->check_path_fd == NULL || ops->stat_fd == NULL ||
      ops->open_proc_link == NULL || ops->close_fd == NULL ||
      path_fd < 0 || proc_fd < 0 || path_fd == proc_fd) {
    errno = EINVAL;
    return -1;
  }
  if (ops->check_path_fd(ctx, path_fd) < 0 ||
      ops->stat_fd(ctx, path_fd, &before) < 0) return -1;
  if (!before.regular || before.links != 1) { errno = EPERM; return -1; }

  fd = ops->open_proc_link(ctx, proc_fd, path_fd, CEIREAN_READ_FLAGS);
  if (fd < 0) return -1;
  if (fd == path_fd || fd == proc_fd) { errno = EIO; return -1; }
  if (ops->stat_fd(ctx, fd, &after) < 0) {
    saved = errno;
    (void)ops->close_fd(ctx, fd);
    errno = saved;
    return -1;
  }
  if (!after.regular || after.links != 1 || before.device != after.device ||
      before.inode != after.inode) {
    (void)ops->close_fd(ctx, fd);
    errno = EPERM;
    return -1;
  }
  *out_fd = fd;
  return 0;
}
