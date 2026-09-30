#!/usr/bin/env python3
"""Draw the Stacks and Flicks home-screen icons as PNGs (standard library only).

The shapes mirror the SVG marks in js/brand.js (a 32x32 grid). Each shape is anti-aliased by
supersampling and composited onto the brand's background colour; iOS wants opaque square icons,
and "maskable" variants keep the mark inside the safe zone Android crops to.

    python tools/make_icons.py        # writes icons/*.png
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'icons'
SS = 4  # supersamples per axis


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rect(x, y, w, h, fill, rx=0.0, rotate=None):
    """rotate = (degrees, cx, cy), as in SVG's rotate(deg cx cy)."""
    return {'kind': 'rect', 'box': (x, y, x + w, y + h), 'rx': rx, 'fill': hex_rgb(fill), 'rotate': rotate}


def tri(points, fill):
    return {'kind': 'tri', 'pts': points, 'fill': hex_rgb(fill)}


STACKS = {
    'bg': '#17110c',
    'shapes': [
        rect(4, 6, 6, 20, '#8c3a2e', 1), rect(4, 9, 6, 1.4, '#d6b06a'), rect(4, 21.6, 6, 1.4, '#d6b06a'),
        rect(12, 4, 6, 22, '#4b6b3f', 1), rect(12, 7, 6, 1.4, '#d6b06a'), rect(12, 21.6, 6, 1.4, '#d6b06a'),
        rect(20.5, 7, 6, 19, '#b98a3e', 1, (-12, 23.5, 16.5)),
        rect(20.5, 10, 6, 1.4, '#f1e2bf', 0, (-12, 23.5, 16.5)), rect(20.5, 21.6, 6, 1.4, '#f1e2bf', 0, (-12, 23.5, 16.5)),
    ],
}

FLICKS = {
    'bg': '#0b0d0c',
    'shapes': [
        rect(3, 5, 26, 22, '#174f32', 2.5),
        rect(9, 8, 14, 16, '#2e9e62', 1.2),
        *[rect(x, y, 2.6, 2.4, '#efe9dc', 0.6) for x in (4.6, 24.8) for y in (7.5, 12.5, 17.5, 22.5)],
        tri([(14, 12.2), (14, 19.8), (20.4, 16.0)], '#efe9dc'),
    ],
}


def inside(shape, u, v):
    if shape['kind'] == 'rect':
        if shape['rotate']:
            deg, cx, cy = shape['rotate']
            # Undo the rotation: turn the sample point the other way around the centre.
            a = math.radians(-deg)
            du, dv = u - cx, v - cy
            u, v = cx + du * math.cos(a) - dv * math.sin(a), cy + du * math.sin(a) + dv * math.cos(a)
        x0, y0, x1, y1 = shape['box']
        if not (x0 <= u <= x1 and y0 <= v <= y1):
            return False
        r = shape['rx']
        if r <= 0:
            return True
        dx = max(x0 + r - u, 0, u - (x1 - r))
        dy = max(y0 + r - v, 0, v - (y1 - r))
        return dx * dx + dy * dy <= r * r
    (ax, ay), (bx, by), (cx, cy) = shape['pts']
    s1 = (bx - ax) * (v - ay) - (by - ay) * (u - ax)
    s2 = (cx - bx) * (v - by) - (cy - by) * (u - bx)
    s3 = (ax - cx) * (v - cy) - (ay - cy) * (u - cx)
    return (s1 >= 0 and s2 >= 0 and s3 >= 0) or (s1 <= 0 and s2 <= 0 and s3 <= 0)


def bounds(shape):
    """Bounding box in mark units (generous for rotated shapes)."""
    if shape['kind'] == 'tri':
        xs, ys = zip(*shape['pts'])
        return min(xs), min(ys), max(xs), max(ys)
    x0, y0, x1, y1 = shape['box']
    if shape['rotate']:
        pad = max(x1 - x0, y1 - y0) * 0.3
        return x0 - pad, y0 - pad, x1 + pad, y1 + pad
    return x0, y0, x1, y1


def render(brand, size, frac):
    """frac: share of the icon the 32-unit mark spans (smaller for maskable icons)."""
    bg = hex_rgb(brand['bg'])
    px = [[list(bg) for _ in range(size)] for _ in range(size)]
    scale = size * frac / 32
    off = (size - 32 * scale) / 2
    for shape in brand['shapes']:
        bx0, by0, bx1, by1 = bounds(shape)
        xa, xb = max(0, int(off + bx0 * scale) - 1), min(size, int(off + bx1 * scale) + 2)
        ya, yb = max(0, int(off + by0 * scale) - 1), min(size, int(off + by1 * scale) + 2)
        fill = shape['fill']
        for y in range(ya, yb):
            for x in range(xa, xb):
                hits = 0
                for sy in range(SS):
                    v = (y + (sy + 0.5) / SS - off) / scale
                    for sx in range(SS):
                        u = (x + (sx + 0.5) / SS - off) / scale
                        hits += inside(shape, u, v)
                if hits:
                    c = hits / (SS * SS)
                    p = px[y][x]
                    for i in range(3):
                        p[i] = round(fill[i] * c + p[i] * (1 - c))
    return px


def write_png(path, px):
    size = len(px)
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in px)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    path.write_bytes(png)


def main():
    OUT.mkdir(exist_ok=True)
    for name, brand in (('stacks', STACKS), ('flicks', FLICKS)):
        for size in (180, 192, 512):
            write_png(OUT / f'{name}-{size}.png', render(brand, size, 0.78))
        write_png(OUT / f'{name}-maskable-512.png', render(brand, 512, 0.6))
        print(f'{name}: done')


if __name__ == '__main__':
    main()
