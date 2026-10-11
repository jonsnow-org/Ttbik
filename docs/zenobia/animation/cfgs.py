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

for k,f in (('coin-gold','60aa42bd'),('coin-bronze','fd66cb12'),('skyline','45d179d8'),('legend','daca1f5a'),('captive','d8f2fc87')): pass
C['coin-gold']=dict(zoom=0.025,pan=5,focus=(512,512),dust=40,dust_dir=(0.3,-0.5),dust_amp=1.0,dust_col=(160,225,255),
 bands=[(0,0.07,0.9),(0.5,0.06,0.5)],band_angle=35,nspark=34,vthr=235,spark_amp=1.0,lum_mask=0.45,circle=455,
 sun=dict(x=300,y=250,r=420,amp=0.12),
 zones=[z(250,700,200,250,ax=3,kx=0.03,n=1),z(760,300,300,300,ax=3,ay=2,kx=0.02,ky=0.02,n=1)])
C['coin-bronze']=dict(zoom=0.025,pan=5,focus=(512,512),dust=30,dust_dir=(0.3,-0.4),dust_amp=0.9,dust_col=(150,215,255),
 bands=[(0,0.07,0.55),(0.5,0.06,0.35)],band_angle=35,nspark=22,vthr=190,spark_amp=0.8,lum_mask=0.4,circle=455,
 zones=[z(250,700,200,250,ax=3,kx=0.03,n=1)])
C['skyline']=dict(zoom=0.03,pan=8,focus=(690,380),dust=60,dust_dir=(0.8,-0.2),dust_amp=0.9,dust_col=(130,200,255),
 bands=[(0,0.1,0.35)],band_angle=10,nspark=0,
 sun=dict(x=170,y=290,r=380,amp=0.3,col=(80,160,255)),
 zones=[z(700,120,720,130,ax=14,kx=0.004,n=1),z(1000,650,300,120,ax=4,kx=0.02,n=1),z(110,620,170,150,ax=5,ay=2,kx=0.03,ky=0.03,n=1),
        z(1050,650,250,40,ax=14,kx=0.01,n=2)])
C['legend']=dict(zoom=0.03,pan=6,focus=(700,330),dust=90,dust_dir=(0.05,1),dust_amp=1.2,dust_col=(255,255,255),
 bands=[(0,0.08,0.22),(0.5,0.06,0.12)],band_angle=40,nspark=26,vthr=225,spark_amp=0.8,
 sun=dict(x=700,y=250,r=420,amp=0.07,col=(200,235,255)),
 zones=[z(330,150,220,140,ay=14,ax=5,kx=0.01,ky=0.02,n=1),z(1090,150,220,140,ay=14,ax=5,kx=0.01,ky=0.02,n=1,ph=0.4),
        z(700,610,330,130,ax=8,ay=4,kx=0.025,ky=0.03,n=1),z(640,300,110,160,ax=5,ay=2,kx=0.03,ky=0.03,n=1,ph=1),z(780,300,110,160,ax=5,ay=2,kx=0.03,ky=0.03,n=1,ph=2),
        z(700,500,500,400,ax=4,ay=3,kx=0.01,ky=0.012,n=1,ph=2)])
C['captive']=dict(zoom=0.06,pan=7,focus=(710,250),dust=120,dust_dir=(-1,-0.05),dust_amp=1.15,dust_col=(150,200,235),
 bands=[(0,0.06,0.5)],band_angle=20,nspark=10,vthr=170,spark_amp=0.7,lum_mask=0.4,
 sun=dict(x=100,y=300,r=500,amp=0.2),
 zones=[z(720,200,130,150,ax=7,ay=2,kx=0.03,ky=0.04,n=1),z(710,620,150,130,ax=5,ay=2,kx=0.03,ky=0.03,n=1,ph=1),
        z(150,290,170,160,ax=6,ay=3,kx=0.03,ky=0.03,n=1,ph=2),z(700,60,700,110,ax=8,kx=0.006,n=1),z(280,650,250,100,ax=6,ay=3,kx=0.02,n=1)])
C['banner']=dict(zoom=0.025,pan=8,focus=(1000,300),dust=70,dust_dir=(0.7,-0.3),dust_amp=1.0,dust_col=(130,205,255),
 bands=[(0,0.05,0.18)],band_angle=15,nspark=24,vthr=220,spark_amp=0.95,
 sun=dict(x=60,y=260,r=520,amp=0.22,col=(80,170,255)),
 zones=[z(900,110,1000,130,ax=14,kx=0.004,n=1),z(1530,420,150,200,ax=5,ay=2,kx=0.025,ky=0.03,n=1),z(1640,450,120,200,ax=5,ay=2,kx=0.025,ky=0.03,n=1,ph=1),
        z(260,330,160,100,ax=5,ay=2,kx=0.03,ky=0.03,n=1),z(1230,370,150,50,ax=5,kx=0.03,n=1,ph=2)])
C['coin2']=dict(C['coin-gold']); C['coin2']['zones']=[z(250,700,200,250,ax=3,kx=0.03,n=1),z(730,330,100,150,ax=5,ay=2,kx=0.03,ky=0.03,n=1)]
C['captive2']=dict(zoom=0.06,pan=7,focus=(720,230),dust=120,dust_dir=(-1,-0.05),dust_amp=1.15,dust_col=(150,200,235),
 bands=[(0,0.06,0.5)],band_angle=20,nspark=10,vthr=170,spark_amp=0.7,
 sun=dict(x=1100,y=300,r=500,amp=0.16),
 zones=[z(720,180,110,140,ax=7,ay=2,kx=0.03,ky=0.04,n=1),z(720,560,170,200,ax=4,ay=2,kx=0.03,ky=0.03,n=1,ph=1),
        z(700,60,700,110,ax=8,kx=0.006,n=1),z(300,600,250,150,ax=3,ay=1,kx=0.02,n=1,ph=2),z(1100,600,250,150,ax=3,ay=1,kx=0.02,n=1,ph=3)])
C['legend2']=dict(zoom=0.04,pan=6,focus=(700,200),dust=100,dust_dir=(0.05,-1),dust_amp=1.3,dust_col=(120,190,255),
 bands=[(0,0.06,0.5),(0.5,0.05,0.3)],band_angle=40,nspark=34,vthr=215,spark_amp=1.0,
 sun=dict(x=700,y=170,r=260,amp=0.22,col=(120,200,255)),
 zones=[z(700,420,260,280,ax=7,ay=3,kx=0.025,ky=0.03,n=1),z(660,170,80,60,ax=3,ay=1,kx=0.04,ky=0.04,n=1,ph=1),
        z(780,330,360,110,ay=6,ax=5,kx=0.015,ky=0.02,n=2,ph=2),z(700,60,700,60,ax=3,kx=0.006,n=1)])
import sys
if __name__=='__main__':
    k=sys.argv[1]; c=dict(C[k]); c['src']=D+f'src/{k}.jpg'; c['out']=D+f'out/{k}.mp4'
    if len(sys.argv)>2: c['dbg_png']=D+f'out/{k}-dbg.png'; c['dbg']=float(sys.argv[2])
    import anim; anim.run(c)
