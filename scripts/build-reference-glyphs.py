"""Writes molecular-reference.js and REFERENCE-FONTS.txt.

molecular-reference.js holds outlines of printable ASCII from open-licensed
typefaces. Every face is a "base": the composer tries to rebuild each one's letters
out of typtoms, so different faces give structurally different suggestions (a
two-storey or one-storey a, a figure-eight or an "Et" ampersand). The OCR compares
shapes against all of them too.

Outlines ship as data, not drawn from system fonts, because browsers that resist
fingerprinting (LibreWolf, Firefox with resistFingerprinting) randomize canvas pixel
readback, and system fonts differ from machine to machine.

Usage: python scripts/build-reference-glyphs.py
Needs fontTools. The system faces are read from the paths below (Arch Linux
packages: ttf-liberation, noto-fonts, adobe-source-*-pro-fonts, ttf-carlito,
ttf-caladea, ttf-linux-libertine, ttf-gentium-basic, ttf-reem-kufi); the Google
Fonts ones are downloaded from github.com/google/fonts into ~/.cache.
"""

import json
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONTS = Path("/usr/share/fonts")
CACHE = Path.home() / ".cache" / "molecular-reference-fonts"
GOOGLE_FONTS = "https://raw.githubusercontent.com/google/fonts/main/ofl/"
# (label, file under FONTS or "gf:" + path under google/fonts/ofl, variable-font location)
FACES = [
    ("Liberation Sans", "TTF/liberation/LiberationSans-Regular.ttf"),
    ("Liberation Sans Bold", "TTF/liberation/LiberationSans-Bold.ttf"),
    ("Liberation Sans Italic", "TTF/liberation/LiberationSans-Italic.ttf"),
    ("Liberation Serif", "TTF/liberation/LiberationSerif-Regular.ttf"),
    ("Liberation Serif Bold", "TTF/liberation/LiberationSerif-Bold.ttf"),
    ("Liberation Serif Italic", "TTF/liberation/LiberationSerif-Italic.ttf"),
    ("Liberation Mono", "TTF/liberation/LiberationMono-Regular.ttf"),
    ("Liberation Mono Bold", "TTF/liberation/LiberationMono-Bold.ttf"),
    ("Noto Sans", "noto/NotoSans-Regular.ttf"),
    ("Noto Sans Bold", "noto/NotoSans-Bold.ttf"),
    ("Noto Sans Italic", "noto/NotoSans-Italic.ttf"),
    ("Noto Serif", "noto/NotoSerif-Regular.ttf"),
    ("Noto Serif Italic", "noto/NotoSerif-Italic.ttf"),
    ("Source Sans", "TTF/adobe/SourceSansPro-Regular.ttf"),
    ("Source Sans Bold", "TTF/adobe/SourceSansPro-Bold.ttf"),
    ("Source Serif", "TTF/adobe/SourceSerifPro-Regular.ttf"),
    ("Source Serif Italic", "TTF/adobe/SourceSerifPro-It.ttf"),
    ("Source Code", "OTF/SourceCodePro-Regular.otf"),
    ("Source Code Bold", "OTF/SourceCodePro-Bold.otf"),
    ("Carlito", "TTF/crosextra/Carlito-Regular.ttf"),
    ("Carlito Bold", "TTF/crosextra/Carlito-Bold.ttf"),
    ("Carlito Italic", "TTF/crosextra/Carlito-Italic.ttf"),
    ("Caladea", "TTF/crosextra/Caladea-Regular.ttf"),
    ("Caladea Italic", "TTF/crosextra/Caladea-Italic.ttf"),
    ("Biolinum", "TTF/libertine/LinBiolinum_R_G.ttf"),
    ("Biolinum Bold", "TTF/libertine/LinBiolinum_RB_G.ttf"),
    ("Libertine", "TTF/libertine/LinLibertine_R_G.ttf"),
    ("Libertine Italic", "TTF/libertine/LinLibertine_RI_G.ttf"),
    ("Gentium", "SIL/GenBasR.ttf"),
    ("Gentium Italic", "SIL/GenBasI.ttf"),
    ("Reem Kufi", "TTF/arabic/ReemKufi.ttf"),
    # Grotesques and other sans
    ("Inter", "gf:inter/Inter[opsz,wght].ttf"),
    ("Inter Black", "gf:inter/Inter[opsz,wght].ttf", {"wght": 900}),
    ("Work Sans", "gf:worksans/WorkSans[wght].ttf"),
    ("Work Sans Bold", "gf:worksans/WorkSans[wght].ttf", {"wght": 700}),
    ("Archivo Narrow Bold", "gf:archivo/Archivo[wdth,wght].ttf", {"wdth": 62, "wght": 700}),
    ("Archivo Expanded", "gf:archivo/Archivo[wdth,wght].ttf", {"wdth": 125}),
    ("Space Grotesk", "gf:spacegrotesk/SpaceGrotesk[wght].ttf"),
    ("Hanken Grotesk", "gf:hankengrotesk/HankenGrotesk[wght].ttf"),
    ("Schibsted Grotesk Black", "gf:schibstedgrotesk/SchibstedGrotesk[wght].ttf", {"wght": 900}),
    ("Bricolage Grotesque", "gf:bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf", {"opsz": 96, "wght": 700}),
    ("Darker Grotesque", "gf:darkergrotesque/DarkerGrotesque[wght].ttf"),
    ("Familjen Grotesk", "gf:familjengrotesk/FamiljenGrotesk[wght].ttf"),
    ("Host Grotesk", "gf:hostgrotesk/HostGrotesk[wght].ttf"),
    ("Instrument Sans", "gf:instrumentsans/InstrumentSans[wdth,wght].ttf"),
    ("Public Sans", "gf:publicsans/PublicSans[wght].ttf"),
    ("Manrope", "gf:manrope/Manrope[wght].ttf"),
    ("Jost", "gf:jost/Jost[wght].ttf"),
    ("Jost Italic", "gf:jost/Jost-Italic[wght].ttf"),
    ("Josefin Sans", "gf:josefinsans/JosefinSans[wght].ttf"),
    # Serifs
    ("EB Garamond", "gf:ebgaramond/EBGaramond[wght].ttf"),
    ("EB Garamond Italic", "gf:ebgaramond/EBGaramond-Italic[wght].ttf"),
    ("Playfair Display", "gf:playfairdisplay/PlayfairDisplay[wght].ttf"),
    ("Playfair Display Italic", "gf:playfairdisplay/PlayfairDisplay-Italic[wght].ttf"),
    ("Libre Baskerville", "gf:librebaskerville/LibreBaskerville[wght].ttf"),
    ("Libre Baskerville Italic", "gf:librebaskerville/LibreBaskerville-Italic[wght].ttf"),
    ("Crimson Pro Italic", "gf:crimsonpro/CrimsonPro-Italic[wght].ttf"),
    ("Bodoni Moda", "gf:bodonimoda/BodoniModa[opsz,wght].ttf", {"opsz": 96}),
    ("Lora Italic", "gf:lora/Lora-Italic[wght].ttf"),
    ("Fraunces", "gf:fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf", {"opsz": 144, "wght": 700}),
    ("Fraunces Italic", "gf:fraunces/Fraunces-Italic[SOFT,WONK,opsz,wght].ttf"),
    ("DM Serif Display", "gf:dmserifdisplay/DMSerifDisplay-Regular.ttf"),
    ("Abril Fatface", "gf:abrilfatface/AbrilFatface-Regular.ttf"),
    ("Alegreya Italic", "gf:alegreya/Alegreya-Italic[wght].ttf"),
    # Pixel, techno, rounded, blackletter and other odd ones
    ("Press Start 2P", "gf:pressstart2p/PressStart2P-Regular.ttf"),
    ("Silkscreen", "gf:silkscreen/Silkscreen-Regular.ttf"),
    ("VT323", "gf:vt323/VT323-Regular.ttf"),
    ("Major Mono Display", "gf:majormonodisplay/MajorMonoDisplay-Regular.ttf"),
    ("Space Mono", "gf:spacemono/SpaceMono-Regular.ttf"),
    ("Syne ExtraBold", "gf:syne/Syne[wght].ttf", {"wght": 800}),
    ("Unbounded", "gf:unbounded/Unbounded[wght].ttf"),
    ("Righteous", "gf:righteous/Righteous-Regular.ttf"),
    ("Audiowide", "gf:audiowide/Audiowide-Regular.ttf"),
    ("Orbitron", "gf:orbitron/Orbitron[wght].ttf"),
    ("Bungee", "gf:bungee/Bungee-Regular.ttf"),
    ("Comfortaa", "gf:comfortaa/Comfortaa[wght].ttf"),
    ("Fredoka", "gf:fredoka/Fredoka[wdth,wght].ttf"),
    ("UnifrakturMaguntia", "gf:unifrakturmaguntia/UnifrakturMaguntia-Book.ttf"),
    ("Rubik Mono One", "gf:rubikmonoone/RubikMonoOne-Regular.ttf"),
    ("Chakra Petch", "gf:chakrapetch/ChakraPetch-Regular.ttf"),
    ("Share Tech Mono", "gf:sharetechmono/ShareTechMono-Regular.ttf"),
    ("Poiret One", "gf:poiretone/PoiretOne-Regular.ttf"),
    ("Limelight", "gf:limelight/Limelight-Regular.ttf"),
]
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "molecular-reference.js"
NOTICE = ROOT / "REFERENCE-FONTS.txt"


def cap_height_of(glyph_set, glyph_name):
    pen = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    return round(pen.bounds[3])


CAP = 100  # outlines are scaled so every face's cap height is this many units


def wanted(code):
    """Printable ASCII, plus characters in the Latin, punctuation and currency blocks
    that have no canonical decomposition (accented letters are composed by the panel
    from their base and accent, so they need no outline of their own)."""
    if 33 <= code <= 126:
        return True
    blocks = [(0xA1, 0x24F), (0x2000, 0x206F), (0x20A0, 0x20CF), (0x2100, 0x214F)]
    if not any(low <= code <= high for low, high in blocks):
        return code in SPACING_ACCENTS
    character = chr(code)
    decomposition = unicodedata.decomposition(character)
    return (
        unicodedata.category(character)[0] in "LNPS"
        and (not decomposition or decomposition.startswith("<"))
    )


# Spacing forms of the accents the panel puts over or under a base letter
SPACING_ACCENTS = {0x2C6, 0x2C7, 0x2C9, 0x2D8, 0x2D9, 0x2DA, 0x2DB, 0x2DC, 0x2DD}
CODES = [code for code in range(33, 0x2150) if wanted(code)]


def font_file(path):
    if not path.startswith("gf:"):
        return FONTS / path
    local = CACHE / path[3:]
    if not local.exists():
        local.parent.mkdir(parents=True, exist_ok=True)
        url = GOOGLE_FONTS + urllib.parse.quote(path[3:])
        local.write_bytes(urllib.request.urlopen(url).read())
    return local


def face_data(label, path, location=None):
    font = TTFont(font_file(path))
    glyph_set = font.getGlyphSet(location=location)
    cmap = font.getBestCmap()
    # Measured on the instance: variable fonts store the default's cap height only
    scale = CAP / cap_height_of(glyph_set, cmap[ord("H")])
    glyphs = {}
    for code in CODES:
        glyph_name = cmap.get(code)
        if glyph_name is None:
            continue
        svg = SVGPathPen(glyph_set, ntos=lambda v: str(round(v)))
        glyph_set[glyph_name].draw(TransformPen(svg, (scale, 0, 0, scale, 0, 0)))
        bounds = BoundsPen(glyph_set)
        glyph_set[glyph_name].draw(bounds)
        if bounds.bounds is None:
            continue
        x_min, y_min, x_max, y_max = (round(v * scale) for v in bounds.bounds)
        glyphs[chr(code)] = [svg.getCommands(), x_min, y_min, x_max, y_max]
    data = {"name": label, "glyphs": glyphs}
    notice = f"{label} ({Path(path).name}): {font['name'].getDebugName(0)}"
    return data, notice

results = [face_data(*face) for face in FACES]
HEADER = (
    "// Generated by scripts/build-reference-glyphs.py; do not edit.\n"
    "// Outlines of open-licensed typefaces; copyright notices and the SIL Open Font\n"
    "// License are in REFERENCE-FONTS.txt.\n"
    "// Per face: { name, glyphs: { character: [svgPath, xMin, yMin, xMax, yMax] } },\n"
    "// y up, scaled so the cap height is REFERENCE_CAP_HEIGHT.\n"
)
# Printable ASCII in one file, everything else in another that loads only when needed
for output, keep in [
    (OUTPUT, lambda c: ord(c) < 127),
    (OUTPUT.with_name("molecular-reference-extended.js"), lambda c: ord(c) >= 127),
]:
    faces = [
        {**data, "glyphs": {c: g for c, g in data["glyphs"].items() if keep(c)}}
        for data, _ in results
    ]
    output.write_text(
        HEADER
        + f"export const REFERENCE_CAP_HEIGHT = {CAP};\n"
        + f"export const REFERENCE_FACES = {json.dumps(faces, separators=(',', ':'))};\n"
    )
    print(f"wrote {output.name} ({output.stat().st_size // 1024} KiB)")
ofl = (ROOT / "scripts" / "OFL-1.1.txt").read_text()
NOTICE.write_text(
    "molecular-reference.js and molecular-reference-extended.js contain glyph outlines\n"
    "from the typefaces below, used as reference shapes. Each is licensed under the SIL\n"
    "Open Font License 1.1 (Linux Libertine and Biolinum are dual-licensed GPL/OFL; the\n"
    "OFL is used here).\n\n"
    + "\n".join(notice.replace("\n", " ") for _, notice in results)
    + "\n\n"
    + ofl
)
