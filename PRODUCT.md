# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Type designers building typtom-based fonts in Fontra. While they compose a glyph from typtom components, they keep the Molecular panel open in Fontra's right sidebar to read the glyph's molecular formula.

## Product Purpose

A Fontra editor plugin that shows the molecular formula of the selected glyph, built from its typtom components, and updates as the glyph is edited.

## Positioning

Brings the molecular typography notation from *Understanding Molecular Typography* (seven typtoms: dottom, itom, etom, vtom, jtom, ctom, ktom) into the editor itself, so the formula is read straight from the components on the canvas.

Terminology confirmed by the user: **dottom** (D) is the punctuation typtom, e.g. the `.`; **ctom** (C) is the one with the big belly.

## Operating Context

- Runs inside Fontra's editor as a sidebar panel; it inherits Fontra's light/dark theme, UI font and sidebar layout.
- Installed through Fontra's Plugin Manager from the GitHub repository (served by jsDelivr), with no build step.

## Capabilities and Constraints

- Plain ES modules; plugins cannot import Fontra's bundled modules, so the panel only uses the `editorController` / `sceneController` objects Fontra passes in.
- Formula notation is fixed and must not change: components are sorted left to right by x, every component name containing `tom` counts, suffixes fold into the base name (`itom.alt` → `itom`), typtoms map to D I E V J C K, letters appear in first-seen order, and repeats get a subscript count.

## Product Principles

- The formula is the readout; everything else in the panel explains where it comes from.
- Never hide a component: anything that does not count toward the formula is still shown.
- Stay a native-feeling Fontra panel; no world of its own.
