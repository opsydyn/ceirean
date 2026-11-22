"""Composite an RGBA PNG onto an opaque background and re-encode as RGB.

LikeC4 exports with a transparent canvas, so the diagram's contrast depends on
whatever page it lands on. Flattening onto an explicit background makes the
contrast a property of the file instead.
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', f'{path}: not a PNG'
    pos, idat, ihdr = 8, b'', None
    while pos < len(data):
        (ln,) = struct.unpack('>I', data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    return ihdr, zlib.decompress(idat)


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def unfilter(raw, w, h, bpp):
    stride = w * bpp
    out = bytearray(stride * h)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        ft = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                c = prev[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + paeth(a, prev[i], c)) & 0xFF
        elif ft != 0:
            sys.exit(f'unsupported filter {ft}')
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return out


def flatten(pixels, w, h, bg):
    br, bg_, bb = bg
    src_stride, dst_stride = w * 4, w * 3
    out = bytearray(dst_stride * h)
    for y in range(h):
        s, d = y * src_stride, y * dst_stride
        for x in range(w):
            r, g, b, a = pixels[s:s + 4]
            if a == 255:
                out[d], out[d + 1], out[d + 2] = r, g, b
            elif a == 0:
                out[d], out[d + 1], out[d + 2] = br, bg_, bb
            else:
                ia = 255 - a
                out[d] = (r * a + br * ia) // 255
                out[d + 1] = (g * a + bg_ * ia) // 255
                out[d + 2] = (b * a + bb * ia) // 255
            s += 4
            d += 3
    return out


def encode(path, rgb, w, h):
    stride = w * 3
    raw = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        line = rgb[y * stride:(y + 1) * stride]
        sub = bytearray(stride)
        for i in range(stride):
            a = line[i - 3] if i >= 3 else 0
            sub[i] = (line[i] - a) & 0xFF
        raw.append(1)
        raw += sub
        prev = line

    def chunk(typ, payload):
        return (struct.pack('>I', len(payload)) + typ + payload
                + struct.pack('>I', zlib.crc32(typ + payload) & 0xFFFFFFFF))

    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n')
        fh.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)))
        fh.write(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
        fh.write(chunk(b'IEND', b''))


def main():
    path, hexbg = sys.argv[1], sys.argv[2].lstrip('#')
    bg = tuple(int(hexbg[i:i + 2], 16) for i in (0, 2, 4))
    (w, h, bd, ct, comp, filt, inter) = read_png(path)[0]
    if (bd, ct, inter) != (8, 6, 0):
        sys.exit(f'{path}: expected 8-bit RGBA non-interlaced, got bd={bd} ct={ct} interlace={inter}')
    raw = read_png(path)[1]
    pixels = unfilter(raw, w, h, 4)
    encode(path, flatten(pixels, w, h, bg), w, h)


main()
