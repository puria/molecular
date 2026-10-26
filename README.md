# Fontra Molecular Typography Plugin

A [Fontra](https://github.com/fontra/fontra) sidebar panel that shows the molecular formula of the selected glyph, read from its typtom components (e.g. `DIE₂K`).

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
  for f in plugin.json molecular-init.js molecular-panel.js molecular-formula.js molecule.svg; do
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

Run the formula tests with `node --test`.

## Using the panel

Open a font whose glyphs are built from typtom components, select a glyph, and click the molecule icon in the right sidebar.

- **Formula**: the glyph's molecular formula, shown large with subscript counts. Hover a letter to see the typtom's name. **Copy** puts it on the clipboard as plain text (`DIE₂K`).
- **Typtoms, left to right**: each typtom component in canvas order, joined like a molecule chain, with its x position. Click a row to select that component on the canvas; Shift- or Cmd/Ctrl-click adds it to the selection or removes it. Components you select on the canvas are highlighted in the list.
- **Not in formula**: components that aren't typtoms. They're listed separately so they're never hidden.
- The panel reads the glyph at the current designspace location and updates live as you edit, select, or move the location sliders.

## Notation

| Letter | Typtom |
| --- | --- |
| D | dottom (punctuation, e.g. `.`) |
| I | itom |
| E | etom |
| V | vtom |
| J | jtom |
| C | ctom (the big belly) |
| K | ktom |

Components are sorted by x. Any component whose name contains `tom` counts, and suffixes fold into the base name (`itom.alt` counts as `itom`). Letters appear in the order they're first seen, and repeats are counted: `itom, etom, etom, ktom` → `IE₂K`. A `*tom` name that isn't in the table appears in the formula by its base name.
