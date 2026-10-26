import {
  TYPTOM_LETTERS,
  baseTyptomName,
  formulaParts,
  formulaText,
} from "./molecular-formula.js";

const COPY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9.667A2.667 2.667 0 0 1 9.667 7h8.666A2.667 2.667 0 0 1 21 9.667v8.666A2.667 2.667 0 0 1 18.333 21H9.667A2.667 2.667 0 0 1 7 18.333z"/><path d="M4.012 16.737A2 2 0 0 1 3 15V5c0-1.1.9-2 2-2h10c.75 0 1.158.385 1.5 1"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`;

const STYLES = `
  :host {
    --mol-muted: color-mix(in srgb, currentColor 64%, transparent);
    --mol-row-hover-light: var(--fontra-theme-marker) #0000000a;
    --mol-row-hover: var(--mol-row-hover-light, #ffffff12);
    --mol-row-selected-light: var(--fontra-theme-marker) #ddd;
    --mol-row-selected: var(--mol-row-selected-light, #555);
    --mol-atom-size: 1.6rem;
    --mol-row-height: 2.3rem;
    display: block;
    height: 100%;
  }

  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden auto;
    padding: 1em;
    gap: 1.25em;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    min-height: 1.9rem;
  }

  .glyph-name {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    flex: none;
    padding: 0.3em 0.7em;
    border: none;
    border-radius: 1em;
    background: var(--text-input-background-color);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: background-color 150ms ease-out;
  }

  .copy:hover {
    background: var(--mol-row-selected);
  }

  .copy:disabled {
    opacity: 0.4;
    cursor: default;
    background: var(--text-input-background-color);
  }

  .copy svg {
    width: 1.05em;
    height: 1.05em;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .formula {
    margin: 0;
    font-family: fontra-ui-semibold, fontra-ui-regular, sans-serif;
    font-size: 3.4rem;
    line-height: 1.1;
    letter-spacing: 0.03em;
    overflow-wrap: anywhere;
  }

  .formula sub {
    font-size: 0.5em;
    vertical-align: baseline;
    position: relative;
    top: 0.3em;
    margin-left: 0.04em;
    letter-spacing: 0;
  }

  .formula.is-empty {
    font-size: 1rem;
    line-height: 1.4;
    color: var(--mol-muted);
    font-family: inherit;
    letter-spacing: 0;
  }

  .section-title {
    margin: 0 0 0.35em;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--mol-muted);
  }

  .chain,
  .others {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The bond: one line joining the atoms, top to bottom = left to right on the canvas */
  .chain::before {
    content: "";
    position: absolute;
    left: calc(0.4em + var(--mol-atom-size) / 2);
    top: calc(var(--mol-row-height) / 2);
    bottom: calc(var(--mol-row-height) / 2);
    border-left: 1.5px solid var(--horizontal-rule-color);
  }

  .row {
    display: grid;
    grid-template-columns: var(--mol-atom-size) 1fr auto;
    align-items: center;
    gap: 0.6em;
    width: 100%;
    height: var(--mol-row-height);
    padding: 0 0.6em 0 0.4em;
    border: none;
    border-radius: 0.35em;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 150ms ease-out;
  }

  .row:hover {
    background: var(--mol-row-hover);
  }

  .row[aria-pressed="true"] {
    background: var(--mol-row-selected);
  }

  .row:focus-visible,
  .copy:focus-visible {
    outline: 2px solid var(--fontra-light-red-color);
    outline-offset: 1px;
  }

  .atom {
    position: relative; /* above the bond line */
    display: grid;
    place-items: center;
    width: var(--mol-atom-size);
    height: var(--mol-atom-size);
    border-radius: 50%;
    border: 1.5px solid currentColor;
    background: var(--ui-element-background-color);
    font-family: fontra-ui-semibold, fontra-ui-regular, sans-serif;
    font-size: 0.8rem;
    line-height: 1;
    transition:
      background-color 150ms ease-out,
      color 150ms ease-out;
  }

  .row[aria-pressed="true"] .atom {
    background: var(--foreground-color);
    color: var(--ui-element-background-color);
  }

  .others .atom {
    border-style: dashed;
    color: var(--mol-muted);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .x {
    color: var(--mol-muted);
    font-variant-numeric: tabular-nums;
  }

  .row[aria-pressed="true"] .x {
    color: inherit; /* muted grey drops below 4.5:1 on the dark selected row */
  }

  .hint {
    margin: 0;
    color: var(--mol-muted);
    line-height: 1.45;
  }

  .hint b {
    color: var(--foreground-color);
    font-weight: 700;
  }

  [hidden] {
    display: none !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .row,
    .atom,
    .copy {
      transition: none;
    }
  }
`;

function element(tag, attributes = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

export default class MolecularPanel extends HTMLElement {
  identifier = "molecular-typography";

  constructor(editorController, iconPath) {
    super();
    this.iconPath = iconPath;
    this.sceneController = editorController.sceneController;
    this.sceneSettings = this.sceneController.sceneSettings;
    this.sceneModel = this.sceneController.sceneModel;
    this._renderedKey = null;

    this.attachShadow({ mode: "open" });
    this.shadowRoot.append(
      element("link", { rel: "stylesheet", href: "/css/shared.css" }),
      element("style", {}, [STYLES]),
      this.buildContent()
    );

    this.sceneController.sceneSettingsController.addKeyListener(
      [
        "selectedGlyph",
        "selection",
        "fontLocationSourceMapped",
        "glyphLocation",
        "editLayerName",
        "positionedLines",
      ],
      () => this.scheduleUpdate()
    );
    this.sceneController.addCurrentGlyphChangeListener(() => this.scheduleUpdate());
  }

  buildContent() {
    this.glyphNameElement = element("h2", { class: "glyph-name" });
    this.copyButton = element("button", { class: "copy", type: "button" });
    this.copyButton.addEventListener("click", () => this.copyFormula());
    this.formulaElement = element("p", { class: "formula" });
    this.chainTitle = element("h3", { class: "section-title" });
    this.chainList = element("ol", { class: "chain" });
    this.othersTitle = element("h3", { class: "section-title" }, ["Not in formula"]);
    this.othersList = element("ol", { class: "others" });
    this.hintElement = element("p", { class: "hint" });

    for (const list of [this.chainList, this.othersList]) {
      list.addEventListener("click", (event) => {
        const row = event.target.closest(".row");
        if (row) {
          this.selectComponent(
            Number(row.dataset.index),
            event.shiftKey || event.metaKey || event.ctrlKey
          );
        }
      });
    }

    this.chainSection = element("section", {}, [this.chainTitle, this.chainList]);
    this.othersSection = element("section", {}, [this.othersTitle, this.othersList]);

    return element("div", { class: "panel" }, [
      element("div", { class: "head" }, [this.glyphNameElement, this.copyButton]),
      this.formulaElement,
      this.chainSection,
      this.othersSection,
      this.hintElement,
    ]);
  }

  scheduleUpdate() {
    if (this._updateTimer) {
      return;
    }
    this._updateTimer = setTimeout(() => {
      this._updateTimer = null;
      this.update();
    }, 60);
  }

  update() {
    if (!this.offsetParent) {
      return; // panel closed; toggle() refreshes on open
    }
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    const glyphName = positionedGlyph?.glyphName;
    const components = positionedGlyph?.isUndefined
      ? []
      : positionedGlyph?.glyph?.instance?.components || [];

    const sorted = components
      .map((component, index) => ({
        index,
        name: component.name,
        x: component.transformation?.translateX || 0,
        base: baseTyptomName(component.name),
      }))
      .sort((a, b) => a.x - b.x);

    const key = JSON.stringify([
      glyphName,
      positionedGlyph?.isUndefined,
      sorted.map(({ index, name, x }) => [index, name, Math.round(x)]),
    ]);
    if (key !== this._renderedKey) {
      this._renderedKey = key;
      this.render(positionedGlyph, sorted);
    }
    this.updateSelectionState();
  }

  render(positionedGlyph, sorted) {
    const typtoms = sorted.filter((c) => c.base);
    const others = sorted.filter((c) => !c.base);
    this.parts = formulaParts(typtoms.map((c) => c.name));

    this.glyphNameElement.textContent = positionedGlyph?.glyphName ?? "Molecular";
    this.glyphNameElement.title = positionedGlyph?.glyphName ?? "";
    this.resetCopyButton();
    this.copyButton.disabled = !this.parts.length;

    this.formulaElement.replaceChildren();
    this.formulaElement.classList.toggle("is-empty", !this.parts.length);
    if (this.parts.length) {
      for (const { base, symbol, count } of this.parts) {
        const span = element("span", { title: count > 1 ? `${base} × ${count}` : base }, [
          symbol,
        ]);
        if (count > 1) {
          span.append(element("sub", {}, [String(count)]));
        }
        this.formulaElement.append(span);
      }
      this.formulaElement.setAttribute(
        "aria-label",
        "Formula: " +
          this.parts
            .map(({ base, count }) => (count > 1 ? `${count} ${base}` : base))
            .join(", ")
      );
    } else {
      this.formulaElement.removeAttribute("aria-label");
      this.formulaElement.textContent = !positionedGlyph
        ? "Select a glyph to read its formula."
        : positionedGlyph.isUndefined
          ? `${positionedGlyph.glyphName} is not in this font yet.`
          : "No typtoms in this glyph.";
    }

    this.chainTitle.textContent =
      typtoms.length === 1 ? "1 typtom, left to right" : `${typtoms.length} typtoms, left to right`;
    this.chainList.replaceChildren(...typtoms.map((c) => this.buildRow(c)));
    this.chainSection.hidden = !typtoms.length;

    this.othersList.replaceChildren(...others.map((c) => this.buildRow(c)));
    this.othersSection.hidden = !others.length;

    // Teach the notation only where there is nothing to read yet
    this.hintElement.hidden = !positionedGlyph || positionedGlyph.isUndefined || !!typtoms.length;
    this.hintElement.replaceChildren(
      "Add typtoms as components to build a molecule: ",
      ...Object.entries(TYPTOM_LETTERS).flatMap(([base, letter], i) => [
        i ? ", " : "",
        element("b", {}, [letter]),
        ` ${base}`,
      ]),
      "."
    );
  }

  buildRow({ index, name, x, base }) {
    const symbol = base ? TYPTOM_LETTERS[base] || base.charAt(0).toUpperCase() : "";
    return element("li", {}, [
      element(
        "button",
        {
          "class": "row",
          "type": "button",
          "data-index": index,
          "aria-pressed": "false",
          "title": "Select on canvas (Shift-click to add)",
        },
        [
          element("span", { "class": "atom", "aria-hidden": "true" }, [symbol]),
          element("span", { class: "name" }, [name]),
          element("span", { class: "x" }, [`x ${Math.round(x)}`]),
        ]
      ),
    ]);
  }

  updateSelectionState() {
    const selection = this.sceneController.selection || new Set();
    for (const row of this.shadowRoot.querySelectorAll(".row")) {
      row.setAttribute(
        "aria-pressed",
        String(selection.has(`component/${row.dataset.index}`))
      );
    }
  }

  selectComponent(index, extend) {
    const key = `component/${index}`;
    const selection = new Set(extend ? this.sceneController.selection : []);
    if (extend && selection.has(key)) {
      selection.delete(key);
    } else {
      selection.add(key);
    }
    const selectedGlyph = this.sceneSettings.selectedGlyph;
    if (selectedGlyph && !selectedGlyph.isEditing) {
      this.sceneSettings.selectedGlyph = { ...selectedGlyph, isEditing: true };
    }
    this.sceneController.selection = selection;
  }

  async copyFormula() {
    clearTimeout(this._copyResetTimer);
    try {
      await navigator.clipboard.writeText(formulaText(this.parts));
      this.setCopyButton(CHECK_ICON, "Copied");
    } catch (error) {
      console.error("Molecular: copying the formula failed", error);
      this.setCopyButton(COPY_ICON, "Copy failed");
    }
    this._copyResetTimer = setTimeout(() => this.resetCopyButton(), 1500);
  }

  setCopyButton(icon, label) {
    this.copyButton.innerHTML = icon;
    this.copyButton.append(element("span", { "aria-live": "polite" }, [label]));
  }

  resetCopyButton() {
    clearTimeout(this._copyResetTimer);
    this.setCopyButton(COPY_ICON, "Copy");
  }

  async toggle(on) {
    if (on) {
      this._renderedKey = null;
      // Wait for the sidebar to make the panel visible before measuring offsetParent
      requestAnimationFrame(() => this.update());
    }
  }
}

customElements.define("panel-molecular-typography", MolecularPanel);
