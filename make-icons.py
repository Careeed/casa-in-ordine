# Rigenera le icone Android (scopa stilizzata). Richiede Pillow. Non serve per la build: i PNG sono già nel progetto.
import math, os
from PIL import Image, ImageDraw
BG=(47,111,107,255); HANDLE=(232,213,176,255); BAND=(150,98,54,255); BRISTLE=(245,200,90,255); LINE=(196,146,40,255)
OUT=os.path.join(os.path.dirname(__file__),'..','resources','android')
def broom(size, scale, bg=None, shape=None):
    S=size*4; img=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(img)
    if bg:
        if shape=='circle': d.ellipse([0,0,S-1,S-1],fill=bg)
        else: d.rounded_rectangle([0,0,S-1,S-1],radius=int(S*0.22),fill=bg)
    ang=math.radians(35); c=0.5
    def T(x,y):  # ruota attorno al centro e scala
        x,y=(x-c)*scale,(y-c)*scale
        rx=x*math.cos(ang)-y*math.sin(ang); ry=x*math.sin(ang)+y*math.cos(ang)
        return ((rx+c)*S,(ry+c)*S)
    P=lambda pts:[T(x,y) for x,y in pts]
    d.polygon(P([(.465,.10),(.535,.10),(.535,.60),(.465,.60)]),fill=HANDLE)          # manico
    d.polygon(P([(.395,.58),(.605,.58),(.62,.66),(.38,.66)]),fill=BAND)              # fascetta
    d.polygon(P([(.38,.66),(.62,.66),(.72,.92),(.28,.92)]),fill=BRISTLE)             # setole
    for x0,x1 in [(.44,.40),(.50,.50),(.56,.60)]:
        d.line(P([(x0,.68),(x1,.91)]),fill=LINE,width=max(2,int(S*0.012)))
    return img.resize((size,size),Image.LANCZOS)
dens={'mdpi':1,'hdpi':1.5,'xhdpi':2,'xxhdpi':3,'xxxhdpi':4}
for n,f in dens.items():
    p=os.path.join(OUT,'res','mipmap-'+n); os.makedirs(p,exist_ok=True)
    broom(int(48*f),1.0,BG,'square').save(os.path.join(p,'ic_launcher.png'))
    broom(int(48*f),1.0,BG,'circle').save(os.path.join(p,'ic_launcher_round.png'))
    broom(int(108*f),0.78).save(os.path.join(p,'casa_icon_fg.png'))   # primo piano dell'icona adattiva (zona sicura)
v=os.path.join(OUT,'res','mipmap-anydpi-v26'); os.makedirs(v,exist_ok=True)
xml='<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/casa_icon_bg"/>\n    <foreground android:drawable="@mipmap/casa_icon_fg"/>\n</adaptive-icon>\n'
for f in ('ic_launcher.xml','ic_launcher_round.xml'): open(os.path.join(v,f),'w').write(xml)
vv=os.path.join(OUT,'res','values'); os.makedirs(vv,exist_ok=True)
open(os.path.join(vv,'casa_icon_colors.xml'),'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="casa_icon_bg">#2F6F6B</color>\n</resources>\n')
Image.new('RGBA',(8,8),(245,244,240,255)).save(os.path.join(OUT,'splash.png'))  # sostituisce il logo Capacitor all'avvio
# anteprima
prev=Image.new('RGBA',(560,200),(245,244,240,255)); prev.paste(broom(192,1.0,BG,'square'),(4,4)); prev.paste(broom(192,1.0,BG,'circle'),(204,4))
fg=Image.new('RGBA',(192,192),BG); fg.alpha_composite(broom(192,0.78)); prev.paste(fg,(404,4)); prev.save('/tmp/preview.png')
