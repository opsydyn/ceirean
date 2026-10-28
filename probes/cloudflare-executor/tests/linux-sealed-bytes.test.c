#include "../src/internal/linux-sealed-bytes.h"

#ifdef NDEBUG
#error "Tests require assertions"
#endif
#include <assert.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

enum operation { STAT = 1, CREATE, READ, WRITE, ADD, GET, REWIND };
struct fake {
  const char *input;
  size_t length, position, written, destination_position;
  char output[9000];
  enum operation fail, interrupt;
  int interrupted, closed, close_errno, regular, seals, alias, zero_write;
  int installed_seals, eof_seen, add_done, get_done, rewind_done;
  int fail_at, fault_calls, stat_calls, create_calls;
  size_t read_limit, write_limit;
};

static int fault(struct fake *f, enum operation op) {
  if (f->interrupt == op && !f->interrupted) {
    f->interrupted = 1; errno = EINTR; return -1;
  }
  if (f->fail == op && ++f->fault_calls >= f->fail_at) { errno = EIO; return -1; }
  return 0;
}
static int is_regular(void *p, int fd) {
  struct fake *f = p; assert(fd == 3);
  f->stat_calls++;
  return fault(f, STAT) < 0 ? -1 : f->regular;
}
static int create(void *p) {
  struct fake *f = p;
  f->create_calls++;
  return fault(f, CREATE) < 0 ? -1 : (f->alias ? 3 : 7);
}
static ssize_t read_source(void *p, int fd, void *buf, size_t n) {
  struct fake *f = p; assert(fd == 3);
  assert(!f->add_done);
  if (fault(f, READ) < 0) return -1;
  if (n > f->read_limit) n = f->read_limit;
  if (n > f->length - f->position) n = f->length - f->position;
  memcpy(buf, f->input + f->position, n); f->position += n;
  if (n == 0) f->eof_seen = 1;
  return (ssize_t)n;
}
static ssize_t write_dest(void *p, int fd, const void *buf, size_t n) {
  struct fake *f = p; assert(fd == 7);
  assert(!f->add_done && !f->eof_seen);
  if (fault(f, WRITE) < 0) return -1;
  if (f->zero_write) return 0;
  if (n > f->write_limit) n = f->write_limit;
  assert(n <= sizeof(f->output) - f->written);
  memcpy(f->output + f->destination_position, buf, n);
  f->written += n; f->destination_position += n;
  return (ssize_t)n;
}
static int add(void *p, int fd, int seals) {
  struct fake *f = p; assert(fd == 7 && seals == CEIREAN_SEALED_BYTES_SEALS);
  assert(f->eof_seen && !f->add_done && !f->get_done && !f->rewind_done);
  if (fault(f, ADD) < 0) return -1;
  f->installed_seals |= seals; f->add_done = 1;
  return 0;
}
static int get(void *p, int fd) {
  struct fake *f = p; assert(fd == 7);
  assert(f->add_done && !f->get_done && !f->rewind_done);
  if (fault(f, GET) < 0) return -1;
  f->get_done = 1;
  return (f->installed_seals & f->seals) | (f->seals & ~CEIREAN_SEALED_BYTES_SEALS);
}
static int rewind_fd(void *p, int fd) {
  struct fake *f = p; assert(fd == 7);
  assert(f->get_done && !f->rewind_done);
  assert((f->installed_seals & f->seals & CEIREAN_SEALED_BYTES_SEALS) ==
         CEIREAN_SEALED_BYTES_SEALS);
  if (fault(f, REWIND) < 0) return -1;
  f->destination_position = 0; f->rewind_done = 1;
  return 0;
}
static int close_fd(void *p, int fd) {
  struct fake *f = p; assert(fd == 7); f->closed++;
  if (f->close_errno) { errno = f->close_errno; return -1; }
  return 0;
}
static const struct ceirean_sealed_bytes_ops ops = {
  is_regular, create, read_source, write_dest, add, get, rewind_fd, close_fd
};
static struct fake fresh(void) {
  return (struct fake){ .input = "abcdef", .length = 6, .regular = 1,
    .seals = CEIREAN_SEALED_BYTES_SEALS, .read_limit = 2, .write_limit = 1 };
}
static void success_and_limits(void) {
  struct fake f = fresh(); int fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == 0);
  assert(fd == 7 && f.closed == 0 && f.position == 6 && f.written == 6);
  assert(memcmp(f.output, "abcdef", 6) == 0);
  assert(f.eof_seen && f.add_done && f.get_done && f.rewind_done);
  assert(f.installed_seals == CEIREAN_SEALED_BYTES_SEALS && f.destination_position == 0);
  f = fresh(); fd = 99; f.position = 1;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 5, &fd) == 0);
  assert(f.position == 6 && f.written == 5 && memcmp(f.output, "bcdef", 5) == 0);
  assert(f.destination_position == 0);
  f = fresh(); fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 5, &fd) == -1);
  assert(errno == EFBIG && fd == -1 && f.closed == 1 && f.position == 6);
  f = fresh(); f.length = 0; fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 0, &fd) == 0 && fd == 7);
  f = fresh(); fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 0, &fd) == -1);
  assert(errno == EFBIG && fd == -1 && f.closed == 1 && f.position == 1);
}
static void failures_and_interrupts(void) {
  for (int op = STAT; op <= REWIND; ++op) {
    struct fake f = fresh(); int fd = 99;
    f.fail = (enum operation)op; f.close_errno = EINTR;
    assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
    assert(errno == EIO && fd == -1 && f.closed == (op > CREATE));
    f = fresh(); fd = 99; f.interrupt = (enum operation)op;
    assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == 0);
    assert(f.interrupted && fd == 7 && f.closed == 0 && f.written == 6);
  }
  for (int bit = 1; bit <= 8; bit *= 2) {
    struct fake f = fresh(); int fd = 99; f.seals &= ~bit;
    assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
    assert(errno == EPERM && fd == -1 && f.closed == 1 && f.add_done && f.get_done && !f.rewind_done);
  }
  struct fake f = fresh(); int fd = 99; f.zero_write = 1;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
  assert(errno == EIO && fd == -1 && f.closed == 1);
  f = fresh(); fd = 99; f.regular = 0;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
  assert(errno == EPERM && fd == -1 && f.closed == 0);
  f = fresh(); fd = 99; f.alias = 1;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
  assert(errno == EIO && fd == -1 && f.closed == 0);
}
static void failures_after_progress(void) {
  struct fake f = fresh(); int fd = 99;
  f.fail = READ; f.fail_at = 4;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
  assert(errno == EIO && fd == -1 && f.closed == 1 && f.written == 6);
  f = fresh(); fd = 99; f.fail = WRITE; f.fail_at = 2;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == -1);
  assert(errno == EIO && fd == -1 && f.closed == 1 && f.written == 1);
  f = fresh(); fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 7, &fd) == 0);
  assert(fd == 7 && f.position == 6 && f.written == 6);
  f = fresh(); fd = 99; f.seals |= 0x10;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 6, &fd) == 0 && fd == 7);
}
static void multiple_buffers(void) {
  char input[8193];
  for (size_t i = 0; i < sizeof(input); ++i) input[i] = (char)(i % 127);
  struct fake f = fresh(); int fd = 99;
  f.input = input; f.length = 8192; f.read_limit = 4096; f.write_limit = 3000;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 8192, &fd) == 0);
  assert(fd == 7 && f.written == 8192 && memcmp(f.output, input, 8192) == 0);
  f = fresh(); fd = 99;
  f.input = input; f.length = sizeof(input); f.read_limit = 4096; f.write_limit = 3000;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 8192, &fd) == -1);
  assert(errno == EFBIG && fd == -1 && f.closed == 1 && f.position == 8193);
}
static void invalid_arguments(void) {
  struct fake f = fresh(); int fd = 99;
  assert(ceirean_sealed_bytes_with(NULL, &f, 3, 1, &fd) == -1 && errno == EINVAL && fd == -1);
  fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, -1, 1, &fd) == -1 && errno == EINVAL && fd == -1);
  fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, UINT64_MAX, &fd) == -1 && errno == EINVAL && fd == -1);
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, 1, NULL) == -1 && errno == EINVAL);
}
static void absolute_cap(void) {
  const uint64_t maximum = UINT64_C(64) * 1024 * 1024;
  struct fake f = fresh(); int fd = 99;
  f.length = 0;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, maximum, &fd) == 0 && fd == 7);
  f = fresh(); fd = 99;
  assert(ceirean_sealed_bytes_with(&ops, &f, 3, maximum + 1, &fd) == -1);
  assert(errno == EINVAL && fd == -1 && f.position == 0 && f.closed == 0);
  assert(f.stat_calls == 0 && f.create_calls == 0);
}
int main(void) {
  absolute_cap();
  success_and_limits(); failures_and_interrupts(); failures_after_progress();
  multiple_buffers(); invalid_arguments();
  puts("linux sealed bytes fake syscall tests passed");
  return 0;
}
