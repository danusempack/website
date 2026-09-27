#!/usr/bin/env python3
"""Generate assets/data/demo.json — a preset in the REAL Alight Motion 5.x
format (root <scene>, <transform> with <location>/<scale>/<rotation>/<opacity>,
effects addressed by their com.alightcreative.effects.* id), verified against
an actual 138 KB AM export.

It deliberately includes one effect id that is NOT in our local registry, so
the "efek belum didukung" path is visible without hunting for a weird file.
"""

import json
import os

W, H, DUR, FPS = 720, 1280, 6000, 30
EX = "com.alightcreative.effects."

EASE_IN = "cubicBezier 0.42 0.0 1.0 1.0"
EASE_OUT = "cubicBezier 0.0 0.0 0.58 1.0"
EASE_IO = "cubicBezier 0.42 0.0 0.58 1.0"
ELASTIC = "elastic 0.5 1.0 0.0 1.0"
REV_ELASTIC = "reverse elastic 0.5 1.0 0.0 1.0"


def tsec(ms):
    return f"{ms / 1000:.6f}"


def kfs(pairs, ease=EASE_IO):
    """AM writes the easing on the kf that STARTS the segment."""
    out = []
    for i, (t, v) in enumerate(pairs):
        e = f' e="{ease}"' if i < len(pairs) - 1 else ""
        out.append(f'<kf t="{tsec(t)}" v="{v}"{e} />')
    return "".join(out)


def track(tag, pairs=None, ease=EASE_IO, static=None):
    if static is not None:
        return f"<{tag} value=\"{static}\" />"
    return f"<{tag}>{kfs(pairs, ease)}</{tag}>"


def fx(fxid, **props):
    body = ""
    for k, v in props.items():
        if isinstance(v, list):
            body += f'<property name="{k}" type="float">{kfs(v, EASE_IO)}</property>'
        else:
            body += f'<property name="{k}" type="float" value="{v:.6f}" />'
    return f'<effect id="{EX}{fxid}" locallyApplied="false">{body}</effect>'


layers = []

layers.append(
    f'<shape id="1001" label="Accent Bar" startTime="0" endTime="{DUR}"'
    f' fillType="color" mediaFillMode="fill" s=".rect">'
    f'<transform>'
    f'{track("location", [(0, "360,300,0"), (900, "360,300,0"), (2400, "360,170,0"), (4200, "360,1010,0"), (6000, "360,1130,0")])}'
    f'{track("opacity", [(0, "0"), (600, "1"), (5200, "1"), (6000, "0")])}'
    f'</transform>'
    f'<effect id="{EX}dbur" locallyApplied="false">'
    f'<property name="size" type="float" value="14.000000" />'
    f'</effect>'
    f'<fillColor value="#ffa0a0a0" />'
    f'<property name="size" type="vec2" value="560.000000,26.000000" />'
    f'</shape>'
)

layers.append(
    f'<shape id="1002" label="Orb" startTime="0" endTime="{DUR}"'
    f' fillType="color" mediaFillMode="fill" s=".circle">'
    f'<transform>'
    f'{track("location", [(0, "360,640,0"), (1500, "360,560,0"), (3000, "360,780,0"), (4500, "360,600,0"), (6000, "360,640,0")])}'
    f'{track("scale", [(0, "0.400000,0.400000"), (1200, "0.800000,0.800000"), (3000, "1.000000,1.000000"), (6000, "0.600000,0.600000")], ELASTIC)}'
    f'{track("rotation", [(0, "-15"), (6000, "360")], EASE_IN)}'
    f'{track("opacity", static="0.900000")}'
    f'</transform>'
    f'{fx("exposure", exposure=14)}'
    f'{fx("satvib", vib=40)}'
    f'{fx("neonGlowUltra", strength=3)}'
    f'<fillColor value="#ffff7a59" />'
    f'<property name="size" type="vec2" value="420.000000,420.000000" />'
    f'</shape>'
)

layers.append(
    f'<shape id="1003" label="Ring" startTime="800" endTime="5200"'
    f' fillType="color" mediaFillMode="fill" s=".circle">'
    f'<transform>'
    f'{track("location", [(800, "360,640,0"), (5200, "360,640,0")])}'
    f'{track("rotation", [(800, "0"), (5200, "720")], EASE_IN)}'
    f'{track("scale", [(800, "0.200000,0.200000"), (2000, "1.000000,1.000000"), (4000, "0.750000,0.750000"), (5200, "0.100000,0.100000")])}'
    f'{track("opacity", [(800, "0"), (1400, "0.850000"), (4600, "0.850000"), (5200, "0")])}'
    f'</transform>'
    f'{fx("tile", scale=1.02, mirror=1.0, vertoffs=0.0, angle=0.0)}'
    f'{fx("swing2", freq=0.86, a1=-1.3, a2=1.3, phase=0.0, type=0.0)}'
    f'<effect id="com.alightcreative.effects.satvib" locallyApplied="false">'
    f'<property name="blendMode" type="int" value="1" />'
    f'<property name="vib" type="float" value="30.000000" />'
    f'</effect>'
    f'<fillColor value="#ffffffff" />'
    f'<property name="size" type="vec2" value="600.000000,600.000000" />'
    f'</shape>'
)

layers.append(
    f'<shape id="1004" label="Panel" startTime="1200" endTime="{DUR}"'
    f' fillType="color" mediaFillMode="fill" s=".rect">'
    f'<transform>'
    f'{track("location", [(1200, "360,1560,0"), (2400, "360,900,0"), (6000, "360,760,0")], EASE_OUT)}'
    f'{track("opacity", [(1200, "0"), (2000, "0.700000"), (5600, "0.700000"), (6000, "0")])}'
    f'</transform>'
    f'{fx("vignette", radius=45)}'
    f'{fx("lift", m1=-8)}'
    f'<fillColor value="#ff5b4bdb" />'
    f'<property name="size" type="vec2" value="720.000000,520.000000" />'
    f'</shape>'
)

layers.append(
    f'<image id="1005" label="Photo Slot" startTime="2000" endTime="{DUR}"'
    f' fillType="media" fillImage="my_photo.jpg" mediaFillMode="crop" s=".rect">'
    f'<transform>'
    f'{track("location", [(2000, "360,520,0"), (6000, "360,520,0")])}'
    f'{track("scale", [(2000, "1.200000,1.200000"), (3000, "1.000000,1.000000"), (6000, "1.050000,1.050000")])}'
    f'{track("rotation", [(2000, "6"), (3600, "-4"), (6000, "2")], REV_ELASTIC)}'
    f'{track("opacity", [(2000, "0"), (2600, "1"), (6000, "0.900000")])}'
    f'</transform>'
    f'{fx("motionblur2", mag=8, usePos=1.0, useScale=1.0, useAngle=1.0)}'
    f'{fx("lumakey3", lowThreshold=0.1, highThreshold=1.0, feather=0.05, weighted=1.0)}'
    f'<property name="size" type="vec2" value="560.000000,560.000000" />'
    f'</image>'
)

chips = [("Chip A", "180,60", "#ffff7a59", 380, 8),
         ("Chip B", "180,60", "#ff5b4bdb", 560, -6),
         ("Chip C", "180,60", "#ff0d9488", 740, 4)]
kids = ""
for i, (nm, sz, col, y, rot) in enumerate(chips):
    s = 2600 + i * 120
    kids += (
        f'<shape id="{1100 + i}" label="{nm}" startTime="{s}" endTime="{DUR}"'
        f' fillType="color" mediaFillMode="fill" s=".roundRect">'
        f'<transform>'
        f'{track("location", [(s, f"360,{y},0"), (DUR, f"360,{y},0")])}'
        f'{track("rotation", [(s, "0"), (DUR, str(rot * 4))], EASE_IN)}'
        f'{track("opacity", [(s, "0"), (s + 600, "1")], EASE_OUT)}'
        f'</transform>'
        f'<fillColor value="{col}" />'
        f'<property name="size" type="vec2" value="{sz}" />'
        f'</shape>'
    )

layers.append(
    f'<embedScene id="1099" label="Chip Group" startTime="2600" endTime="{DUR}"'
    f' fillType="intrinsic" mediaFillMode="fill">'
    f'<transform>'
    f'<location value="360.000000,560.000000,0.000000" />'
    f'<scale value="1.000000,1.000000" />'
    f'{track("opacity", [(2600, "0"), (3000, "1"), (5600, "1"), (6000, "0.850000")])}'
    f'</transform>'
    f'<fillColor value="#ff000000" />'
    f'<property name="size" type="vec2" value="360.000000,420.000000" />'
    f'<scene title="" width="720" height="1280" exportWidth="720" exportHeight="1280"'
    f' precompose="dynamicResolution" bgcolor="#00000000" totalTime="{DUR - 2600}" fps="{FPS}"'
    f' amver="1028425" am="com.alightcreative.motion/5.0.273.1028425" retime="off">'
    f'{kids}'
    f'</scene>'
    f'</embedScene>'
)

layers.append(
    f'<audio id="1098" label="Bed" startTime="0" endTime="{DUR}" src="my_bed.mp3"'
    f' mediaFillMode="fill">'
    f'<transform><location value="360.000000,640.000000,0.000000" /><scale value="0,0" /></transform>'
    f'<property name="size" type="vec2" value="0.000000,0.000000" />'
    f'</audio>'
)

media = ('<media uri="my_photo.jpg" type="image/jpeg" duration="0" orientation="0" width="1080" height="1080" />\n'
         '  <media uri="my_bed.mp3" type="audio/mpeg" duration="6000" orientation="0" width="0" height="0" />')

track_el = ('<audio id="9001" startTime="0" endTime="%d" src="my_bed.mp3" outTime="%d" mediaFillMode="fill">'
            '<gain><kf t="0.250000" v="0.000000" e="cubicBezier 0.0 0.0 0.58 1.0" />'
            '<kf t="0.000000" v="1.000000" /></gain></audio>' % (DUR, DUR))

bookmarks = "".join(f'\n  <bookmark t="{t}" />' for t in (1200, 2600, 4000))

xml = (
    "<?xml version='1.0' encoding='UTF-8' ?><!--\n"
    "Created by hand for AM Preset Studio — demo preset, no binary assets.\n"
    "-->\n"
    f'<scene title="Demo Studio" width="{W}" height="{H}" exportWidth="1080" exportHeight="1920"'
    f' precompose="dynamicResolution" bgcolor="#ff0e1020" totalTime="{DUR}" fps="{FPS}"'
    f' modifiedTime="0" amver="1028425" am="com.alightcreative.motion/5.0.273.1028425"'
    f' amplatform="android" retime="freeze" retimeAdaptFPS="false">\n'
    f"  {media}\n"
    + "\n".join("  " + l for l in layers) + "\n"
    f"  {track_el}{bookmarks}\n"
    "</scene>\n"
)

demo = {
    "name": "demo-studio.xml",
    "title": "Demo Studio",
    "note": ("Preset demo buatan, tanpa media biner. Slot my_photo.jpg dan my_bed.mp3 "
             "sengaja dikosongkan supaya alur 'Ganti media' bisa dicoba. Mengandung satu "
             "efek (neonGlowUltra) yang tidak ada di registri lokal, untuk menunjukkan "
             "bahwa efek yang tak didukung ditandai, bukan diabaikan diam-diam."),
    "xml": xml,
}

out = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "assets", "data", "demo.json"))
with open(out, "w", encoding="utf-8") as f:
    json.dump(demo, f, ensure_ascii=False, separators=(",", ":"))
print(f"wrote {out}: {len(xml)} chars XML, {len(layers)} top-level layers")
