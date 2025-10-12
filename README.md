# Fontra Molecular Typography Plugin

A Fontra editor panel plugin that displays the molecular formula of glyphs based on their typtom components.

## Installation

In Fontra's Plugin Manager, add:
```
puria/molecular
```


## Features

- Displays molecular formula notation for glyphs (e.g., I₂E for a glyph with 2 itoms and 1 etom)
- Components sorted by X position (left to right)
- Automatically groups typtom variants (itom, itom.alt, etc.)
- Shows detailed component list with X positions
- Updates in real-time as you edit glyphs

## Usage

1. Open a font with typtom-based glyphs in Fontra
2. Look for the layers icon in the right sidebar
3. Click it to open the Molecular Typography panel
4. The formula shows the molecular notation (e.g., DIE₂K)
5. Below shows each component with its X position
