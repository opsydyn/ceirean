#ifndef CEIREAN_LINUX_SEALED_BYTES_H
#define CEIREAN_LINUX_SEALED_BYTES_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define CEIREAN_SEALED_BYTES_SEALS 0x0f
#define CEIREAN_SEALED_BYTES_MAX (UINT64_C(64) * 1024 * 1024)

/* Operations return -1 and set errno on error; read and write may be short. */
struct ceirean_sealed_bytes_ops {
  int (*is_regular)(void *, int);
  int (*create)(void *);
  ssize_t (*read)(void *, int, void *, size_t);
  ssize_t (*write)(void *, int, const void *, size_t);
  int (*add_seals)(void *, int, int);
  int (*get_seals)(void *, int);
  int (*rewind)(void *, int);
  int (*close)(void *, int);
};

/*
 * source_fd is borrowed, readable, regular, and read from its current offset.
 * The caller must maintain fd-table and source-byte custody for the entire
 * call, and exclusive custody of the source open-file-description offset:
 * no thread or process may read, seek, or otherwise change that offset via
 * source_fd or any other descriptor sharing the same open file description.
 * This API neither establishes custody nor validates digest/provenance.
 * The cap must be <= CEIREAN_SEALED_BYTES_MAX (64 MiB), a mechanism limit,
 * not a resource or time guarantee. At the cap, a one-byte read establishes EOF;
 * an oversized source fails with EFBIG and may advance by that extra byte.
 * On success out_fd is owned and positioned at zero. On failure it is -1;
 * any acquired fd is closed once, without retry, preserving the failure errno.
 * The borrowed source is never closed. The caller owns the returned fd and
 * must maintain its fd-table custody until closing it. Neither this API nor
 * its success establishes a deadline, qualification, or builder consumption.
 */
int ceirean_sealed_bytes_with(const struct ceirean_sealed_bytes_ops *ops,
                              void *ctx, int source_fd, uint64_t cap,
                              int *out_fd);

#ifdef __linux__
int ceirean_sealed_bytes_linux(int source_fd, uint64_t cap, int *out_fd);
#endif

#endif
