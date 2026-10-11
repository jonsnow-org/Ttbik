import sys, json, math, subprocess
import numpy as np, cv2, imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
FPS, SECS = 24, 6
N = FPS * SECS
TAU = 2 * math.pi


def feather_ellipse(shape, cx, cy, rx, ry):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    return np.clip(1.0 - d, 0, 1) ** 1.0


def gold_mask(bgr):
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = ((h > 10) & (h < 34) & (s > 70) & (v > 100)).astype(np.float32)
    m = cv2.GaussianBlur(m, (0, 0), 1.5)
    return m


def find_sparkles(bgr, gmask, n, minsep=34, vthr=225, seed=1):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(gray, (0, 0), 1.2)
    near = cv2.dilate((gmask > 0.3).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    loc = g == cv2.dilate(g, np.ones((15, 15), np.uint8))
    cand = np.argwhere(loc & near & (g > vthr))
    cand = sorted(cand.tolist(), key=lambda p: -g[p[0], p[1]])
    out = []
    for y, x in cand:
        if all((x - a) ** 2 + (y - b) ** 2 > minsep ** 2 for a, b in out):
            out.append((x, y))
        if len(out) >= n:
            break
    return out


def star_sprite(r):
    k = int(r * 2 + 1)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float32)
    core = np.exp(-(xx ** 2 + yy ** 2) / (2 * (r * 0.11) ** 2))
    a = np.exp(-(np.abs(yy) / (r * 0.05 + .6)) ** 1.0) * np.clip(1 - np.abs(xx) / r, 0, 1) ** 1.6
    b = np.exp(-(np.abs(xx) / (r * 0.05 + .6)) ** 1.0) * np.clip(1 - np.abs(yy) / r, 0, 1) ** 1.6
    s = np.clip(core * 1.2 + a + b, 0, 1)
    return s


def add_sprite(frame, spr, x, y, amt, color):
    r = spr.shape[0] // 2
    x0, y0 = int(x) - r, int(y) - r
    x1, y1 = x0 + spr.shape[1], y0 + spr.shape[0]
    fx0, fy0 = max(x0, 0), max(y0, 0)
    fx1, fy1 = min(x1, frame.shape[1]), min(y1, frame.shape[0])
    if fx1 <= fx0 or fy1 <= fy0:
        return
    sp = spr[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0, None]
    frame[fy0:fy1, fx0:fx1] += sp * amt * color


def run(cfg):
    src = cv2.imread(cfg['src'])
    H, W = src.shape[:2]
    base = src.astype(np.float32)
    rng = np.random.default_rng(cfg.get('seed', 7))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    gm = gold_mask(src)
    gray = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    sparks = find_sparkles(src, gm, cfg.get('nspark', 28), vthr=cfg.get('vthr', 225))
    sprites = {r: star_sprite(r) for r in (10, 16, 24)}
    sp_cfg = [(x, y, rng.integers(0, 2) + 1, rng.random() * TAU, rng.choice([10, 16, 24]))
              for x, y in sparks]

    # warp zones: (cx, cy, rx, ry, ampx, ampy, kx, ky, n, phase)
    zones = [(feather_ellipse((H, W), z['cx'], z['cy'], z['rx'], z['ry']), z) for z in cfg['zones']]

    # dust particles
    P = cfg.get('dust', 60)
    px = rng.random(P) * W
    py = rng.random(P) * H
    ps = rng.uniform(0.6, 2.4, P)          # size
    pv = rng.integers(1, 4, P)             # loops across screen (integer -> seamless)
    pa = rng.uniform(0.25, 0.8, P)
    pph = rng.random(P) * TAU
    pdir = cfg.get('dust_dir', (1, -0.15))
    pcol = np.array(cfg.get('dust_col', (150, 215, 255)), np.float32)[None, None, :] / 255  # BGR-ish

    ang = math.radians(cfg.get('band_angle', 25))
    ux, uy = math.cos(ang), math.sin(ang)
    proj = (xx * ux + yy * uy)
    pmin, pmax = proj.min(), proj.max()
    u = (proj - pmin) / (pmax - pmin)

    glow = None
    if 'sun' in cfg:
        s = cfg['sun']
        d = np.sqrt((xx - s['x']) ** 2 + (yy - s['y']) ** 2)
        glow = np.exp(-(d / s['r']) ** 2)[..., None]

    writer = subprocess.Popen(
        [FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS),
         '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(cfg.get('crf', 20)), '-pix_fmt', 'yuv420p',
         '-movflags', '+faststart', cfg['out']], stdin=subprocess.PIPE)

    warm = np.array([150, 215, 255], np.float32) / 255  # BGR warm white
    zoom_amp = cfg.get('zoom', 0.03)
    for i in range(N):
        t = i / N
        ph = TAU * t
        # displacement
        dx = np.zeros((H, W), np.float32)
        dy = np.zeros((H, W), np.float32)
        for m, z in zones:
            w = np.sin(z.get('kx', 0) * xx + z.get('ky', 0) * yy - TAU * z.get('n', 1) * t + z.get('ph', 0))
            dx += m * z.get('ax', 0) * w
            dy += m * z.get('ay', 0) * w
        # camera: breathing zoom + slow drift (all integer-periodic)
        s = 1 + zoom_amp * (1 - math.cos(ph)) / 2
        cx, cy = cfg.get('focus', (W / 2, H / 2))
        sx = cfg.get('pan', 6) * math.sin(ph)
        sy = cfg.get('pan', 6) * 0.5 * math.sin(2 * ph)
        mapx = (xx - cx) / s + cx + dx - sx
        mapy = (yy - cy) / s + cy + dy - sy
        fr = cv2.remap(base, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

        # light sweep over gold
        gmw = cv2.remap(gm, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        gl = cv2.remap(gray, mapx, mapy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        for k, (off, wd, amp) in enumerate(cfg.get('bands', [(0.0, 0.07, 0.75)])):
            c = -0.25 + 1.5 * ((t + off) % 1.0)
            band = np.exp(-((u - c) / wd) ** 2)
            fr += (band * gmw * (0.35 + gl))[..., None] * warm * 255 * amp

        # sun / ambient glow pulse
        if glow is not None:
            pulse = 0.5 + 0.5 * math.sin(ph)
            sc = cfg['sun']
            fr += glow * np.array(sc.get('col', (120, 190, 255)), np.float32) * sc.get('amp', 0.22) * (0.55 + 0.45 * pulse)

        # sparkles
        for x, y, n, p0, r in sp_cfg:
            a = max(0.0, math.sin(n * ph + p0)) ** 8
            if a > 0.02:
                add_sprite(fr, sprites[r], x, y, a * 255 * cfg.get('spark_amp', 0.95), np.array([0.85, 0.95, 1.0], np.float32))

        # dust motes
        if P:
            layer = np.zeros((H, W, 3), np.float32)
            for j in range(P):
                x = (px[j] + pdir[0] * pv[j] * W * t) % W
                y = (py[j] + pdir[1] * pv[j] * H * t + 8 * math.sin(ph * 2 + pph[j])) % H
                tw = 0.6 + 0.4 * math.sin(ph * 3 + pph[j])
                cv2.circle(layer, (int(x), int(y)), int(max(1, ps[j])), tuple(float(c) for c in (pcol[0, 0] * 255 * pa[j] * tw)), -1, cv2.LINE_AA)
            layer = cv2.GaussianBlur(layer, (0, 0), 1.1)
            fr += layer * cfg.get('dust_amp', 1.0)

        out = np.clip(fr, 0, 255).astype(np.uint8)
        writer.stdin.write(out.tobytes())
        if i == int(N * cfg.get('dbg', 0.4)) and cfg.get('dbg_png'):
            cv2.imwrite(cfg['dbg_png'], out)
    writer.stdin.close()
    writer.wait()


if __name__ == '__main__':
    run(json.load(open(sys.argv[1])))
