#ifndef CEIREAN_LINUX_FS_BOUNDARY_H
#define CEIREAN_LINUX_FS_BOUNDARY_H

#include <stddef.h>
#include <stdint.h>

#define CEIREAN_FS_PATH_MAX 4095u
#define CEIREAN_PATH_FLAGS (010000000 | 02000000)
#define CEIREAN_RESOLVE_FLAGS (0x08 | 0x04 | 0x01)
#define CEIREAN_READ_FLAGS (02000000 | 04000 | 0400)

struct ceirean_fs_stat {
  uint64_t device;
  uint64_t inode;
  uint64_t links;
  int regular;
};

/* Internal injection interface. Operations return -1 and set errno on failure. */
struct ceirean_fs_ops {
  int (*open_path)(void *, int, const char *, int, int);
  int (*stat_fd)(void *, int, struct ceirean_fs_stat *);
  int (*close_fd)(void *, int);
};

struct ceirean_fs_reopen_ops {
  int (*check_path_fd)(void *, int);
  int (*stat_fd)(void *, int, struct ceirean_fs_stat *);
  int (*open_proc_link)(void *, int, int, int);
  int (*close_fd)(void *, int);
};

/*
 * root_fd is borrowed and must remain owned by the caller. path is a readable,
 * stable buffer of exactly path_len bytes during the call. On success, *out_fd
 * is an owned O_PATH fd; on failure it is -1. The caller must close the returned
 * fd once. On failure after open, close is attempted once and never retried;
 * Linux releases the descriptor even when close reports EINTR.
 *
 * The result pins an inode, not its bytes, provenance, write custody, or a
 * builder input. A link count of one proves none of those properties.
 * The caller must maintain fd-table custody throughout inspection and until
 * every returned fd is closed: no other thread may close, replace, or reuse
 * a borrowed or returned fd during its required lifetime.
 * The filesystem and kernel must be trusted to meet the caller's latency
 * requirements; this API does not enforce a wall-clock deadline.
 */
int ceirean_fs_inspect_with(const struct ceirean_fs_ops *ops, void *ctx,
                            int root_fd, const char *path, size_t path_len,
                            int *out_fd);

/*
 * path_fd is a borrowed O_PATH fd, retained and held open throughout this call.
 * proc_fd is a borrowed, pinned, genuine /proc/self/fd directory for this
 * process. Its authenticity and trusted mount-namespace and fd-table custody
 * are prerequisites supplied by the caller, not established by this API.
 * No thread may close or replace either borrowed fd during this call; fd-table
 * custody of the returned fd must continue until the caller closes it. Without
 * those prerequisites calling this operation is unsafe and is not permitted.
 *
 * On success *out_fd is an owned readable fd; on failure it is -1 and any
 * acquired readable fd is closed once without retry. No fallback is attempted.
 * Identity checks do not establish stable bytes, provenance, or write custody.
 * O_NONBLOCK does not bound regular-file, procfs, filesystem, or kernel latency;
 * meeting any time limit requires an independently suitable environment.
 */
int ceirean_fs_reopen_with(const struct ceirean_fs_reopen_ops *ops, void *ctx,
                           int path_fd, int proc_fd, int *out_fd);

#ifdef __linux__
int ceirean_fs_inspect_linux(int root_fd, const char *path, size_t path_len,
                             int *out_fd);
int ceirean_fs_reopen_linux(int path_fd, int proc_fd, int *out_fd);
#endif

#endif
