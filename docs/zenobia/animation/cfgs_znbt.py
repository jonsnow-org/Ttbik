"""Animation configs for the ZNBt chapter-2 art (1376x768 sources). Faces are never inside a warp zone (protect + no zones)."""
import json, sys, subprocess
SRC = '/tmp/znimg/'
OUT = '/tmp/znout/'
def z(cx, cy, rx, ry, ax=0, ay=0, kx=0, ky=0, n=1, ph=0): return dict(cx=cx, cy=cy, rx=rx, ry=ry, ax=ax, ay=ay, kx=kx, ky=ky, n=n, ph=ph)
C = {}
C['child'] = dict(src=SRC + '01.jpg', zoom=0.03, pan=6, focus=(560, 380), dust=70, dust_dir=(0.6, -0.4), dust_col=(140, 215, 255), dust_amp=1.1,
    bands=[(0, 0.05, 0.6)], band_angle=15, nspark=10, vthr=215, protect=[(545, 270, 90, 110)],
    sun=dict(x=1078, y=330, r=330, amp=0.26),
    zones=[z(1260, 140, 120, 180, ax=7, ay=2, kx=0.02, ky=0.03, n=1), z(200, 180, 110, 150, ax=5, ay=2, kx=0.03, ky=0.03, n=1, ph=2),
           z(790, 620, 45, 60, ax=3, ay=2, kx=0.06, ky=0.05, n=1), z(700, 330, 700, 90, ax=5, kx=0.006, n=1)])
C['queen'] = dict(src=SRC + '02.jpg', zoom=0.03, pan=6, focus=(900, 380), dust=60, dust_dir=(0.5, -0.5), dust_col=(140, 215, 255), dust_amp=1.1,
    bands=[(0, 0.05, 0.45), (0.5, 0.04, 0.3)], band_angle=28, nspark=40, vthr=220, protect=[(1060, 150, 70, 95)],
    sun=dict(x=720, y=240, r=450, amp=0.1),
    zones=[z(690, 110, 100, 90, ax=9, ay=4, kx=0.03, ky=0.04, n=1), z(160, 150, 110, 130, ax=7, ay=3, kx=0.03, ky=0.03, n=1, ph=1),
           z(1300, 110, 60, 110, ax=6, ay=3, kx=0.04, ky=0.03, n=1, ph=2), z(1160, 640, 130, 110, ax=5, ay=3, kx=0.03, ky=0.03, n=1, ph=.5)])
C['warrior'] = dict(src=SRC + '03.jpg', zoom=0.05, pan=10, focus=(900, 330), dust=120, dust_dir=(-1, -0.1), dust_amp=0.8, dust_col=(150, 200, 235),
    bands=[(0, 0.05, 0.45), (0.5, 0.04, 0.3)], band_angle=20, nspark=30, protect=[(935, 150, 60, 80)],
    sun=dict(x=1010, y=230, r=400, amp=0.1),
    zones=[z(150, 110, 170, 110, ax=10, ay=5, kx=0.03, ky=0.04, n=1), z(300, 270, 90, 80, ax=7, ay=4, kx=0.04, ky=0.04, n=1, ph=1),
           z(1240, 190, 100, 90, ax=8, ay=4, kx=0.04, ky=0.05, n=1, ph=2), z(700, 400, 130, 150, ax=8, ay=4, kx=0.03, ky=0.03, n=1, ph=.5),
           z(700, 720, 600, 70, ax=7, ay=4, kx=0.012, ky=0.02, n=1)])
C['captive'] = dict(src=SRC + '04.jpg', zoom=0.03, pan=5, focus=(690, 400), dust=35, dust_dir=(0.3, -0.3), dust_col=(255, 215, 170), dust_amp=0.9,
    bands=[(0, 0.05, 0.7)], band_angle=35, nspark=30, vthr=200, protect=[(690, 210, 70, 90)],
    sun=dict(x=585, y=275, r=240, amp=0.3),
    zones=[z(200, 190, 70, 90, ax=6, ay=3, kx=0.04, ky=0.04, n=1), z(1090, 230, 70, 80, ax=6, ay=3, kx=0.04, ky=0.04, n=1, ph=1.5),
           z(580, 265, 30, 45, ax=3, ay=3, kx=0.08, ky=0.08, n=3), z(820, 290, 28, 40, ax=3, ay=3, kx=0.08, ky=0.08, n=3, ph=1)])
C['legend'] = dict(src=SRC + '05.jpg', zoom=0.03, pan=6, focus=(688, 330), dust=80, dust_dir=(0, -1), dust_amp=1.2, dust_col=(120, 200, 255),
    bands=[(0, 0.06, 0.9), (0.5, 0.05, 0.6)], band_angle=60, nspark=70, vthr=190, spark_amp=1.1, protect=[(688, 125, 60, 75)],
    sun=dict(x=688, y=420, r=500, amp=0.3),
    zones=[z(260, 300, 200, 150, ax=10, ay=6, kx=0.025, ky=0.03, n=1), z(1120, 300, 200, 150, ax=10, ay=6, kx=0.025, ky=0.03, n=1, ph=2),
           z(688, 560, 150, 180, ax=6, ay=4, kx=0.03, ky=0.04, n=1, ph=1)])
C['coin'] = dict(src=SRC + '06.jpg', zoom=0.02, pan=3, focus=(512, 512), dust=0, nspark=26, vthr=200, spark_amp=1.0,
    bands=[(0, 0.08, 0.8), (0.5, 0.06, 0.5)], band_angle=35, zones=[])
C['banner'] = dict(src=SRC + 'banner.jpg', zoom=0.03, pan=5, focus=(700, 230), dust=60, dust_dir=(0.5, -0.4), dust_col=(140, 215, 255), dust_amp=1.1,
    bands=[(0, 0.05, 0.4), (0.5, 0.04, 0.25)], band_angle=25, nspark=36, vthr=215, protect=[(1070, 120, 60, 85)],
    sun=dict(x=1180, y=60, r=420, amp=0.1),
    zones=[z(880, 40, 100, 80, ax=8, ay=4, kx=0.03, ky=0.04, n=1), z(860, 190, 60, 50, ax=6, ay=3, kx=0.04, ky=0.04, n=1, ph=1), z(260, 210, 90, 60, ax=5, ay=3, kx=0.04, ky=0.04, n=1, ph=2)])
if __name__ == '__main__':
    import anim
    name = sys.argv[1]
    cfg = dict(C[name]); cfg['out'] = OUT + name + '.mp4'; cfg['dbg_png'] = OUT + name + '-dbg.png'
    anim.run(cfg)
