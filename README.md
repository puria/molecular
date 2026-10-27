# Fontra Molecular Typography Plugin

A [Fontra](https://github.com/fontra/fontra) sidebar panel that shows the molecular formula of the selected glyph, read from its typtom components (e.g. `DIE₂K`), and suggests typtom compositions for letters, digits and punctuation.

Tested against Fontra `main` at commit `4762f5b` (2026-10-26).

## Install from GitHub (no release needed)

Fontra loads plugins straight from GitHub through [jsDelivr](https://www.jsdelivr.com/), so pushing to `main` is enough. You don't need a tag or a release.

1. In Fontra, open **Fontra → Plugin Manager** (the menu at the top left).
2. Click **+** and paste one of the addresses below.
3. Reload the editor tab. A molecule icon appears in the right sidebar.

| Address | What you get |
| --- | --- |
| `puria/molecular` | Shorthand for `https://cdn.jsdelivr.net/gh/puria/molecular@latest`. While the repo has no tags, `@latest` serves the `main` branch. Once a tag exists, it serves the newest tag instead. |
| `https://cdn.jsdelivr.net/gh/puria/molecular@main` | Always the `main` branch, even after tags exist. |
| `https://cdn.jsdelivr.net/gh/puria/molecular@<full-commit-sha>` | One exact commit. It never changes, so it's the safest way to share a specific version. Use the full 40-character SHA: jsDelivr resolves short SHAs like a branch name and caches them. |

### Getting new commits

jsDelivr caches branch URLs (`@latest`, `@main`) for up to 12 hours on the CDN and up to 7 days in the browser. To pick up a fresh push straight away, either:

- switch the Plugin Manager entry to the new full commit SHA, or
- purge the CDN cache for each changed file, then hard-reload Fontra:

  ```sh
  for f in plugin.json molecular-init.js molecular-panel.js molecular-formula.js molecular-composer.js molecular-bonds.js molecular-wizard.js molecular-ocr.js molecular-reference.js molecular-reference-extended.js molecular-catalogue.js molecule.svg; do
    curl -s "https://purge.jsdelivr.net/gh/puria/molecular@main/$f" >/dev/null
  done
  ```

  Use `@latest` in the URL instead of `@main` if that's the address you installed.

### Local development

Fontra imports the plugin as an ES module from another origin, so the server must send CORS headers:

```sh
npx http-server --cors -c-1 -p 8765 .
```

Then add `http://127.0.0.1:8765` in the Plugin Manager.

Run the tests with `node --test`.

`molecular-reference.js` (about 2 MB, 750 KB compressed) holds the reference outlines of printable ASCII and loads when the panel first composes; `molecular-reference-extended.js` (about 4 MB, 1.5 MB compressed) holds the other characters and loads only once a non-ASCII glyph is composed. The browser caches both. They are generated with `python scripts/build-reference-glyphs.py` (needs fontTools; system fonts listed in the script, Google Fonts downloaded automatically). The fonts' copyright notices and license are in `REFERENCE-FONTS.txt`.

`molecular-catalogue.js` holds the molecules of the [molecular fonts](https://github.com/puria/molecular-fonts). Regenerate it after changing those fonts with `python scripts/build-molecule-catalogue.py PATH/TO/molecular-fonts`.

## Starting a new molecular font

1. Create an empty font: `fontra new MyFont.fontra` (with Fontra installed from source, in the folder Fontra serves), then open it in Fontra. Or copy [TemplateBase.fontra](https://github.com/puria/molecular-fonts/tree/main/TemplateBase.fontra) to start from its typtoms.
2. Open the Molecular panel. A font that lacks typtoms shows **Font setup** at the top:
   - **1 · Draw the seven typtoms.** **Create the typtom glyphs** adds empty `itom`, `etom`, `vtom`, `ctom`, `jtom`, `ktom` and `dotom`. Each row says what to draw (a vertical stroke from the baseline to the cap height, a bowl open to the right…) and whether it's missing, empty or drawn; click a row to open that typtom for drawing. Step 2 stays locked until all seven have a shape.
   - **2 · Build the glyphs.** First the strokes get their length axes, as in TemplateBase: `i-length` and `v-height` (from 0 to the drawn height) and `e-length` (from 0 to the drawn width), each with a zero-length master made by squashing the drawn one along the stroke. Then the isotopes TemplateBase has are made from your typtoms: `vtom.alt` and `ktom.alt` are the mirror images (the diagonal leaning the other way; `vtom.alt` keeps the length axis), `ctom.half` and `ktom.half` are half as tall at the same stroke weight (the itom's width). Isotopes you already have are kept, so delete one to have it made again, or redraw it. Then every printable ASCII glyph the font lacks or has empty (94: A–Z, a–z, 0–9, punctuation) is created and filled with its best composition: one of your molecules when the catalogue has it, otherwise the best of the search. Glyphs you already drew are left alone. It takes a couple of minutes; **Stop** pauses, and clicking again carries on.
3. Glyphs still empty are listed in red, and the summary line says how many (it shows even when Font setup is folded). Click one to open it, then draw it or pick a suggestion.

Font setup disappears once all seven typtoms, the four isotopes and all 94 glyphs exist and have shapes. Only the default master is set up; if your font has more masters, give the typtoms and isotopes their shapes and zero-length layers there too.

## Using the panel

Open a font whose glyphs are built from typtom components, select a glyph, and click the molecule icon in the right sidebar.

- **Formula**: the glyph's molecular formula, shown large with subscript counts. Hover a letter to see the typtom's name. **Copy** puts it on the clipboard as plain text (`DIE₂K`).
- **Typtoms, left to right**: each typtom component in canvas order, joined like a molecule chain, with its x position. Click a row to select that component on the canvas; Shift- or Cmd/Ctrl-click adds it to the selection or removes it. Components you select on the canvas are highlighted in the list.
- **Not in formula**: components that aren't typtoms. They're listed separately so they're never hidden.
- The panel reads the glyph at the current designspace location and updates live as you edit, select, or move the location sliders.

## Composing glyphs

Every glyph gets up to 18 typtom compositions under **Compose**. Click one to put its components into the glyph. If the glyph isn't in the font yet (type the character in Fontra's text box, or `/name` for an unencoded glyph), clicking creates it. Each click is one undo step. The caption under each suggestion says where it comes from.

What a glyph is composed as:

- **Letters, digits, punctuation, symbols:** printable ASCII, and every Latin, punctuation, currency and letterlike character the bundled typefaces draw that isn't an accented letter (`ß æ ø ł đ ħ ı œ þ ¿ ¡ « » € £ § ¶ © ™ – — …` and so on).
- **Accented letters** (`À ç ő ž ạ ș…`): the base letter's suggestions, each with an accent composed from typtoms, centred above it (or below for cedilla, ogonek, comma and dot below). The accent floats apart like a dotom; over `i` and `j` the dot is dropped. Supported accents: grave, acute, circumflex, tilde, macron, breve, dot above, diaeresis, ring, double acute, caron, cedilla, ogonek, comma below, dot below.
- **Alternates and ligatures:** `a.alt` is composed as `a`, `f_i` as `f` and `i` side by side. Names like `uni0110` count as that character.

Scripts other than Latin (Greek, Cyrillic…) aren't covered yet: the panel says so.

### The rules

Suggestions follow the rules of molecular typography (*Understanding Molecular Typography*, as taught in the [workshop slides](https://github.com/puria/molecular-fonts/tree/main/workshops/slides)):

- **Roles.** Itom is a vertical stroke, Etom horizontal, Vtom diagonal: they are only flipped, or turned the ways the molecular fonts turn them (an etom turned upright, as in TemplateBase's `u`). Ctom, Jtom and Ktom turn freely. One stroke is one typtom: two itoms stacked into one stem, or an itom shortened into a block, don't count. Other typtoms play the one their name starts with (`cctom` is a Ctom, `ditom` a Dotom, `jatom` a Jtom); names that start with no typtom letter are guessed from the shape (Materico's `htom` and Revival's `rtom`, `xtom` as Ctoms, `hhtom` as a Dotom).
- **Anchors.** A typtom bonds only at its anchors: every typtom at its ends; Itom, Etom and Vtom also anywhere along their faces; Jtom also anywhere along its curve; Ctom and Ktom only at their ends.
- **Charges.** Each end carries its own charge, + or −. Where two ends meet (a direct bond) they must be opposite. An end against a face or curve (flush, offset) needs no particular charge, and nor does an overlap (one typtom laid over another, as an A's crossbar), as long as both touch at anchors.
- **Polarity turns with the typtom.** Flipping or turning a typtom moves its + end with it, so a flipped arm meeting an unflipped one end to end repels.
- **Dotom** has no anchors and never bonds. It is held by attraction: it may float apart (the dot of `i`) or sit against other typtoms as a joint, without that counting as a bond.

### Bonds on the canvas

With **Show charges and bonds on the canvas** on (the Bonds section of the panel), the edited glyph shows every typtom's anchors and bonds. The panel has a legend drawn with the same symbols:

| Symbol | Meaning |
| --- | --- |
| red disc with + | a + end: bonds to a − end, or to any face or curve |
| blue disc with − | a − end: bonds to a + end, or to any face or curve |
| hollow diamond | a face: any end may bond along it, whatever its charge |
| dashed ring | a Jtom's curve: any end may bond along it |
| green ring with ✓ | a bond that follows the rules |
| amber triangle with ! | a bond that breaks a rule (like ends meeting, or touching off an anchor); the panel names the typtoms |

Symbols keep the same size on screen at any zoom, and follow Fontra's light or dark theme. Editing a typtom glyph itself (`itom`, `ctom`…) shows its own anchors.

Anchors and charges are Fontra anchors in the typtom glyphs, named `end+`, `end-`, `face` and `curve`, so you can move, add or rename them like any anchor. A typtom without them uses defaults: the end facing up or left is +, the other −; a diagonal's end leaning left is +; a curved typtom's top end is +; a face anchor on each long side; a Jtom's curve. **Write charges into typtoms** adds these defaults as real anchors to every typtom glyph that has none (on every layer, so they follow glyph axes), ready to edit.

With the defaults, 175 of the 262 molecules in the seven molecular fonts follow every rule. The rest are flagged on the canvas: mostly Jtoms meeting Ctoms or other Jtoms end to end with like charges (TemplateBase `C`, `R`), and Ktoms crossing a stem through their middle (TemplateBase `k`). Changing those typtoms' end anchors, or the letters, makes them pass.

### Where suggestions come from

1. **Your molecules.** Each molecule the molecular fonts (TemplateBase, Rounded, BlackLetter, DeCarlo, Materico, Pittografia, Revival) have for the character is rebuilt with this font's typtoms. Every typtom keeps its turn, flip and length, scaled to this font's cap height, and is centred where the original was. A molecule is skipped when this font lacks one of its typtoms, draws one in another direction, or no longer reads as the character.
2. **Search after 83 typefaces.** The character is taken from open-licensed typefaces bundled with the plugin, each drawing it differently (one- or two-storey `a`, round or flat `&`):
   - Grotesques and other sans: Liberation Sans (Arial/Helvetica-like), Inter, Work Sans, Archivo (narrow and expanded), Space Grotesk, Hanken, Schibsted, Bricolage, Darker and Familjen Grotesk, Host Grotesk, Instrument Sans, Public Sans, Manrope, Jost, Josefin Sans, Noto Sans, Source Sans, Carlito, Biolinum.
   - Serifs: Liberation Serif, Noto Serif, Source Serif, Caladea, Libertine, Gentium, EB Garamond, Playfair Display, Libre Baskerville, Crimson Pro, Bodoni Moda, Lora, Fraunces, DM Serif Display, Abril Fatface, Alegreya, with italics.
   - Odd ones: Press Start 2P, Silkscreen and VT323 (pixel), Major Mono Display, Space Mono, Share Tech Mono, Source Code, Liberation Mono, Syne, Unbounded, Righteous, Audiowide, Orbitron, Bungee, Comfortaa, Fredoka, Rubik Mono One, Chakra Petch, Poiret One, Limelight, Reem Kufi and UnifrakturMaguntia (blackletter).

   For each one:
   - typtoms that may play the needed role are placed one at a time where they cover the most of the letter and the least of the background, at eighths of their glyph axis (`i-length`, `e-length`, `v-height`);
   - a search moves, resizes or drops pieces until the result has as many separate parts and counters as the letter;
   - edges are snapped onto neighbouring edges and the vertical metrics, stretching variable typtoms where that makes more edges meet;
   - any piece still apart slides the shortest distance until it touches the rest at both pieces' anchors, checked on the actual outlines: it stops flush against a face or end rather than sinking into it, and the touching edges are then snapped to meet exactly.

   Your molecules get the same last two steps, so they keep their exact positions unless this font's thicker or thinner typtoms opened a gap. When a molecule uses two isotopes this font draws the same (DeCarlo's `itom` and `itom.alt`), the copies that land on one another become one piece.

   Results that break a rule are dropped.

A small OCR reads every result back. It compares the shape with every printable ASCII character in the bundled typefaces and checks where it sits relative to the baseline and cap height. Search results are shown only when they read as the wanted character at 0.65 or more (1.00 is a perfect match): each typeface's best take first, near-duplicates skipped, fewer typtoms ranked higher among near-equals. Your molecules come before them.

Composing a character takes a few seconds the first time (the panel shows its progress); results are kept for the session.

The panel also shows how the current glyph reads, so you can check your own compositions. Everything runs locally in the browser, with no API key and no network. Nothing reads canvas pixels back, so it also works in LibreWolf and in Firefox with `privacy.resistFingerprinting`, which return random noise for canvas reads.

Notes:

- Suggestions use the typtom sizes at the current location. A new glyph gets one source, at the default location; add the other masters yourself.
- The ink starts at x = 0, and the advance width leaves a tenth of the cap height after it.
- Some pairs can't be told apart by shape alone (`I`/`l`, `O`/`0`), and the score shows that.

## Notation

| Letter | Typtom |
| --- | --- |
| D | dotom (punctuation, e.g. `.`); `dottom` also counts |
| I | itom |
| E | etom |
| V | vtom |
| J | jtom |
| C | ctom (the big belly) |
| K | ktom |

Components are sorted by x. Any component whose name contains `tom` counts, and suffixes fold into the base name (`itom.alt` counts as `itom`). Letters appear in the order they're first seen, and repeats are counted: `itom, etom, etom, ktom` → `IE₂K`. A `*tom` name that isn't in the table appears in the formula by its base name.
