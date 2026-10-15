#!/bin/sh
# Generated (royalty-free) upbeat pad + soft pulse, 40s.
ffmpeg -y -loglevel error -f lavfi -i "aevalsrc='0.10*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.08*sin(2*PI*277.18*t)+0.07*sin(2*PI*329.63*t)+0.05*sin(2*PI*440*t)*(0.5+0.5*sin(2*PI*2*t))+0.18*sin(2*PI*55*t)*exp(-8*mod(t,0.5))':s=44100:d=40" -af "lowpass=f=2500,aecho=0.8:0.6:120:0.25,afade=t=in:d=1" -ac 2 public/music.mp3
