# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Type designers building typtom-based fonts in Fontra. While they compose a glyph from typtom components, they keep the Molecular panel open in Fontra's right sidebar to read the glyph's molecular formula and to get compositions for the letters, digits and punctuation they still need to draw.

## Product Purpose

A Fontra editor plugin that shows the molecular formula of the selected glyph, built from its typtom components, updates it as the glyph is edited, and suggests typtom compositions for any printable ASCII character, ranked by how clearly a local OCR reads them.

## Positioning

Brings the molecular typography notation from *Understanding Molecular Typography* (seven typtoms: dotom, itom, etom, vtom, jtom, ctom, ktom) into the editor itself, so the formula is read straight from the components on the canvas.

Terminology confirmed by the user: **dotom** (D) is the punctuation typtom, e.g. the `.` (the user also writes it "dottom"; both spellings count); **ctom** (C) is the one with the big belly.

Reference fonts: `TemplateBase.fontra` and `Rounded.fontra` in https://github.com/puria/molecular-fonts. Typtoms are variable components (`i-length`, `e-length`, `v-height` glyph axes), with variants such as `ctom.half`, `ktom.alt`, `vtom.alt`, used rotated in 90° steps and mirrored. The same letter is composed differently from font to font.

## Operating Context

- Runs inside Fontra's editor as a sidebar panel; it inherits Fontra's light/dark theme, UI font and sidebar layout.
- Installed through Fontra's Plugin Manager from the GitHub repository (served by jsDelivr), with no build step.

## Capabilities and Constraints

- Plain ES modules; plugins cannot import Fontra's bundled modules, so the panel only uses the `editorController` / `sceneController` objects Fontra passes in.
- Formula notation is fixed and must not change: components are sorted left to right by x, every component name containing `tom` counts, suffixes fold into the base name (`itom.alt` → `itom`), typtoms map to D I E V J C K, letters appear in first-seen order, and repeats get a subscript count.
- Compositions are suggestions: the designer picks one and refines it. The user wants many structurally different options per character (e.g. several ampersand forms, including the "Et" form), with pieces joined edge to edge and no broken strokes or stray gaps. The search is meant to be exhaustive: tedious for a person, cheap for the computer.
- Must work in privacy-hardened browsers (the user runs LibreWolf, where canvas pixel reads return noise): rasterizing and OCR are pure JavaScript on outlines; reference letters ship as data, not system fonts.
- Composition must follow the rules of molecular typography (source: the user's workshop slides in molecular-fonts/workshops/slides, after H.F. Henderson). Confirmed by the user:
  - Roles: Itom vertical stroke, Etom horizontal, Vtom diagonal, Ctom curve, Jtom descending curve, Ktom appendage/spur/tail, Dotom point. Strict, but any turn the user's molecular fonts already use is allowed.
  - Anchors: all typtoms bond at their ends; Itom, Etom, Vtom also anywhere on their faces; Jtom also anywhere on its curve; Ctom, Ktom only at ends. Bond types: direct (end–end), flush (end–face), overlap, offset (end meets face but sticks out), split (passes through, as in t and f).
  - Charges: each end has its own sign (anchors `end+` / `end-` in the typtom glyph). Opposite charges are required only where two ends meet (direct bonds); flush/offset bonds and overlaps need anchors but no charge. Charges turn with the typtom (flips and rotations move them). Chosen because E (arms on one face), D/b (both Ctom ends on one face) and O (Ctoms end to end) cannot all hold if faces carry charge too.
  - Dotom: no anchors, never bonds, but may touch other typtoms as a joint (attraction).
  - Other typtoms play the one their name starts with (cctom → Ctom, ditom → Dotom, jatom → Jtom); htom, rtom, xtom → Ctom, hhtom → Dotom (confirmed by the user).
  - Anchors and charges live as Fontra anchors in the typtom glyphs (`end+`, `end-`, `face`, `curve`), with shape-based defaults when missing; the panel can write the defaults into the glyphs and draws them in red on the canvas.
  - Sources: the user's molecules (molecular-fonts repo) first, then a rule-abiding search after reference typefaces, mixed in one list.

## Product Principles

- The formula is the readout; everything else in the panel explains where it comes from.
- Never hide a component: anything that does not count toward the formula is still shown.
- Stay a native-feeling Fontra panel; no world of its own.

## Open Ideas

- Done as Font setup (draw the seven typtoms; mirrored `.alt` and same-weight `.half` isotopes are generated; then all 94 ASCII glyphs are composed). Still open: accented letters in the setup, and setting up typtoms on every master of a multi-master font.
