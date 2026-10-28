#include "linux-sealed-bytes.h"

#include <errno.h>
#include <stdint.h>

int ceirean_sealed_bytes_with(const struct ceirean_sealed_bytes_ops *ops,
                              void *ctx, int source_fd, uint64_t cap,
                              int *out_fd) {
  unsigned char buffer[4096];
  uint64_t total = 0;
  int fd, result, saved;

  if (out_fd == NULL) { errno = EINVAL; return -1; }
  *out_fd = -1;
  if (ops == NULL || ops->is_regular == NULL || ops->create == NULL ||
      ops->read == NULL || ops->write == NULL || ops->add_seals == NULL ||
      ops->get_seals == NULL || ops->rewind == NULL || ops->close == NULL ||
      source_fd < 0 || cap > CEIREAN_SEALED_BYTES_MAX) { errno = EINVAL; return -1; }

  do { result = ops->is_regular(ctx, source_fd); } while (result < 0 && errno == EINTR);
  if (result < 0) return -1;
  if (result == 0) { errno = EPERM; return -1; }
  do { fd = ops->create(ctx); } while (fd < 0 && errno == EINTR);
  if (fd < 0) return -1;
  if (fd == source_fd) { errno = EIO; return -1; }

  for (;;) {
    size_t request = total == cap ? 1 :
      (cap - total < sizeof(buffer) ? (size_t)(cap - total) : sizeof(buffer));
    ssize_t count;
    do { count = ops->read(ctx, source_fd, buffer, request); }
    while (count < 0 && errno == EINTR);
    if (count < 0) goto fail;
    if ((size_t)count > request) { errno = EIO; goto fail; }
    if (count == 0) break;
    if (total == cap) { errno = EFBIG; goto fail; }
    size_t offset = 0;
    while (offset < (size_t)count) {
      ssize_t written;
      size_t remaining = (size_t)count - offset;
      do { written = ops->write(ctx, fd, buffer + offset, remaining); }
      while (written < 0 && errno == EINTR);
      if (written < 0) goto fail;
      if (written == 0 || (size_t)written > remaining) { errno = EIO; goto fail; }
      offset += (size_t)written;
    }
    total += (uint64_t)count;
  }
  do { result = ops->add_seals(ctx, fd, CEIREAN_SEALED_BYTES_SEALS); }
  while (result < 0 && errno == EINTR);
  if (result < 0) goto fail;
  do { result = ops->get_seals(ctx, fd); } while (result < 0 && errno == EINTR);
  if (result < 0) goto fail;
  if ((result & CEIREAN_SEALED_BYTES_SEALS) != CEIREAN_SEALED_BYTES_SEALS) {
    errno = EPERM; goto fail;
  }
  do { result = ops->rewind(ctx, fd); } while (result < 0 && errno == EINTR);
  if (result < 0) goto fail;
  *out_fd = fd;
  return 0;

fail:
  saved = errno;
  (void)ops->close(ctx, fd);
  errno = saved;
  return -1;
}
