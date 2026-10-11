import json
D='/tmp/claude-0/-home-user-Ttbik/a4cebf50-4c70-52a6-90e9-fd3f8589c164/scratchpad/zn/'
def z(cx,cy,rx,ry,ax=0,ay=0,kx=0,ky=0,n=1,ph=0): return dict(cx=cx,cy=cy,rx=rx,ry=ry,ax=ax,ay=ay,kx=kx,ky=ky,n=n,ph=ph)
C={}
C['warrior-horse']=dict(zoom=0.05,pan=10,focus=(620,330),dust=120,dust_dir=(-1,-0.1),dust_amp=1.1,dust_col=(150,200,235),
 bands=[(0,0.06,0.8),(0.5,0.05,0.5)],band_angle=20,nspark=26,
 sun=dict(x=1100,y=190,r=380,amp=0.18),
 zones=[z(500,150,150,150,ax=10,ay=5,kx=0.03,ky=0.04,n=1), z(610,40,60,80,ax=6,kx=0.05,ky=.03,n=2),
        z(380,430,140,150,ax=9,ay=4,kx=0.03,ky=0.03,n=1,ph=1), z(800,150,110,130,ax=8,ay=6,kx=0.04,ky=0.05,n=1,ph=2),
        z(300,690,170,70,ax=12,ay=6,kx=0.03,ky=0.03,n=1,ph=.5), z(700,720,500,70,ax=7,ay=4,kx=0.012,ky=0.02,n=1)])
C['warrior-wall']=dict(zoom=0.035,pan=7,focus=(700,330),dust=50,dust_dir=(1,-0.2),dust_col=(140,215,255),
 bands=[(0,0.06,0.8),(0.5,0.05,0.45)],band_angle=30,nspark=40,
 sun=dict(x=20,y=230,r=420,amp=0.22),
 zones=[z(600,330,120,230,ax=6,ay=2,kx=0.02,ky=0.03,n=1), z(970,320,110,200,ax=6,ay=2,kx=0.02,ky=0.03,n=1,ph=1.5),
        z(775,50,60,90,ax=4,kx=0.05,ky=.03,n=2), z(530,640,70,120,ax=4,ay=2,kx=0.03,ky=0.03,n=1,ph=2), z(980,640,70,130,ax=4,ay=2,kx=0.03,ky=0.03,n=1,ph=3),
        z(150,380,150,120,ax=5,ay=3,kx=0.03,ky=0.04,n=1,ph=.7), z(700,130,700,110,ax=5,kx=0.006,n=1)])
C['child']=dict(zoom=0.03,pan=6,focus=(950,380),dust=70,dust_dir=(0.6,-0.4),dust_col=(140,215,255),dust_amp=1.1,
 bands=[(0,0.07,0.55),(0.5,0.06,0.35)],band_angle=15,nspark=18,vthr=215,
 sun=dict(x=275,y=190,r=340,amp=0.28),
 zones=[z(905,250,60,130,ax=3,ay=1,kx=0.04,ky=0.04,n=1), z(1020,230,60,70,ax=3,ay=1,kx=0.04,ky=0.04,n=1,ph=1),
        z(1330,150,130,190,ax=7,ay=2,kx=0.02,ky=0.03,n=1), z(105,300,80,130,ax=5,ay=2,kx=0.03,ky=0.03,n=1,ph=2),
        z(780,375,70,40,ax=2,ay=2,kx=0.05,ky=0.05,n=1), z(700,120,700,110,ax=5,kx=0.006,n=1)])
C['queen']=dict(zoom=0.03,pan=6,focus=(780,380),dust=60,dust_dir=(0.5,-0.5),dust_col=(140,215,255),dust_amp=1.15,
 bands=[(0,0.06,0.9),(0.5,0.05,0.55)],band_angle=28,nspark=46,vthr=220,spark_amp=1.0,
 sun=dict(x=1000,y=80,r=520,amp=0.18),
 zones=[z(590,360,130,260,ax=6,ay=2,kx=0.02,ky=0.03,n=1), z(1000,380,130,270,ax=6,ay=2,kx=0.02,ky=0.03,n=1,ph=1.5),
        z(700,100,700,110,ax=6,kx=0.006,n=1), z(1260,420,130,150,ax=4,ay=2,kx=0.03,ky=0.03,n=1,ph=2)])
import sys
if __name__=='__main__':
    k=sys.argv[1]; c=dict(C[k]); c['src']=D+f'src/{k}.jpg'; c['out']=D+f'out/{k}.mp4'
    if len(sys.argv)>2: c['dbg_png']=D+f'out/{k}-dbg.png'; c['dbg']=float(sys.argv[2])
    import anim; anim.run(c)
