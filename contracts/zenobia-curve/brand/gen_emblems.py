import re
src=open('contracts/zenobia-curve/brand/znbt-emblem.svg').read()
defs=re.search(r'<defs>.*?</defs>',src,re.S).group(0)
bg='<rect width="512" height="512" fill="url(#b)"/>'
sparkles=re.search(r'<g fill="#ffe9a3"><circle cx="110".*?</g></g>',src,re.S)
sparkles=re.search(r'<g fill="#ffe9a3"><circle cx="110".*?</circle></g>',src,re.S).group(0)
gs=re.findall(r'<g(?: opacity="0")?><animate attributeName="opacity"[^>]*/>(.*?)</g>',src,re.S)
child,queen=gs[0],gs[1]
m=re.search(r'<g opacity="0"><animate attributeName="opacity" values="0;0;1;1"[^>]*/>(.*?)</g><g fill="#ffe9a3" font-weight="700">',src,re.S)
warrior=m.group(1)
captive='<g stroke="#6b6b7a" stroke-width="10" fill="none" stroke-linecap="round"><circle cx="190" cy="360" r="22"/><circle cx="222" cy="378" r="22"/><circle cx="294" cy="378" r="22"/><circle cx="326" cy="360" r="22"/></g><circle cx="256" cy="250" r="70" fill="#6f6a5a"/><text x="256" y="272" font-size="72" font-weight="700" fill="#2b2618">Z</text><path d="M196 190 L206 136 L232 170 L256 122 L280 170 L306 136 L316 190 Z" fill="#8a8470" stroke="#4a4536" stroke-width="3"/>'
legend='<g transform="translate(256 240)"><g stroke="#ffe9a3" stroke-width="5" stroke-linecap="round" opacity=".8"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite"/><line x1="0" y1="-120" x2="0" y2="-170"/><line x1="85" y1="-85" x2="120" y2="-120"/><line x1="120" y1="0" x2="170" y2="0"/><line x1="85" y1="85" x2="120" y2="120"/><line x1="0" y1="120" x2="0" y2="170"/><line x1="-85" y1="85" x2="-120" y2="120"/><line x1="-120" y1="0" x2="-170" y2="0"/><line x1="-85" y1="-85" x2="-120" y2="-120"/></g></g><circle cx="256" cy="250" r="70" fill="url(#g)"><animate attributeName="r" values="70;76;70" dur="3s" repeatCount="indefinite"/></circle><text x="256" y="274" font-size="72" font-weight="700" fill="#5a3a08">Z</text><path d="M196 190 L206 136 L232 170 L256 122 L280 170 L306 136 L316 190 Z" fill="url(#g)" stroke="#8a5a12" stroke-width="3"/><g fill="#fff0b8"><circle cx="256" cy="110" r="5"/><circle cx="214" cy="120" r="4"/><circle cx="298" cy="120" r="4"/></g>'
stages=[('child','DAY 0-6 · CHILD · HOLD TO GROW',0.15,child),('queen','DAY 7-20 · QUEEN',0.5,queen),('warrior','DAY 21+ · WARRIOR',1.0,warrior),('captive','CAPTIVE · BUY AGAIN TO BE FREE',0.0,captive),('legend','LEGEND · BURNED IT ALL',1.0,legend)]
for i,(name,cap,fill,body) in enumerate(stages,1):
    base='<circle cx="256" cy="236" r="190" fill="none" stroke="#3a2f5a" stroke-width="12"/>'
    if name=='captive':
        ring=base+'<circle cx="256" cy="236" r="190" fill="none" stroke="#55556a" stroke-width="12" stroke-dasharray="12 14"/>'
    else:
        off=round(1194*(1-fill))
        ring=base+f'<circle cx="256" cy="236" r="190" fill="none" stroke="url(#g)" stroke-width="12" stroke-linecap="round" transform="rotate(-90 256 236)" stroke-dasharray="1194" stroke-dashoffset="{off}"/>'
    sp='' if name=='captive' else sparkles
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" font-family="Georgia,serif" text-anchor="middle">{defs}{bg}{ring}{sp}<g>{body}</g><g fill="#ffe9a3" font-weight="700"><text x="256" y="470" font-size="22">{cap}</text><text x="256" y="500" font-size="16" fill="#c9b27a">ZENOBIA CARAVAN</text></g></svg>'
    open(f'public/zenobia/emblem-{i}-{name}.svg','w').write(svg)
    print(name,len(svg))
