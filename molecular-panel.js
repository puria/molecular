class Panel extends HTMLElement {
  constructor(editorController) {
    super();
    this.editorController = editorController;
    this.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 0.5em;
      }
      .panel-section {
        padding: 1em;
      }
    `;
    this.shadowRoot.appendChild(style);

    const content = this.getContentElement();
    this.shadowRoot.appendChild(content);
  }

  getContentElement() {
    return document.createElement("div");
  }

  async toggle(on, focus) {}
}

export default class MolecularPanel extends Panel {
  identifier = "components-list";
  iconPath = "/tabler-icons/layers.svg";

  constructor(editorController) {
    super(editorController);
    this.sceneController = editorController.sceneController;

    // Listen for glyph changes
    this.sceneController.addCurrentGlyphChangeListener(() => {
      this.updateComponentsList();
    });
  }

  getContentElement() {
    const container = document.createElement("div");
    container.className = "panel";

    const section = document.createElement("div");
    section.className = "panel-section";
    section.style.cssText = "padding: 1em;";

    const title = document.createElement("div");
    title.textContent = "Components";
    title.style.cssText =
      "font-weight: bold; margin-bottom: 0.5em; font-size: 1.1rem;";

    this.componentsList = document.createElement("ul");
    this.componentsList.style.cssText = `
      list-style: none;
      padding: 0;
      margin: 0;
    `;

    this.emptyMessage = document.createElement("div");
    this.emptyMessage.textContent = "No components in this glyph";
    this.emptyMessage.style.cssText = "color: #999; font-style: italic;";

    section.appendChild(title);
    section.appendChild(this.componentsList);
    section.appendChild(this.emptyMessage);
    container.appendChild(section);

    return container;
  }

  async updateComponentsList() {
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;

    // Clear the list
    this.componentsList.innerHTML = "";

    if (!varGlyph) {
      this.componentsList.style.display = "none";
      this.emptyMessage.style.display = "block";
      this.emptyMessage.textContent = "No glyph selected";
      return;
    }

    // Get the current source location
    const location = this.sceneController.sceneSettings.location || {};

    // Find the active source for the current location
    let activeLayerName = null;
    if (varGlyph.sources && varGlyph.sources.length > 0) {
      // For now, use the first source's layer (at default location)
      // In a more complex setup, you'd match the location to find the right source
      const defaultSource =
        varGlyph.sources.find((s) => !s.inactive) || varGlyph.sources[0];
      activeLayerName = defaultSource?.layerName;
    }

    // Get components sorted by X position from the active layer
    let sortedComponents = [];

    if (activeLayerName && varGlyph.layers[activeLayerName]) {
      const layer = varGlyph.layers[activeLayerName];
      if (layer.glyph?.components) {
        // Sort components by X position (translateX)
        sortedComponents = [...layer.glyph.components].sort((a, b) => {
          const xA = a.transformation?.translateX || 0;
          const xB = b.transformation?.translateX || 0;
          return xA - xB;
        });
      }
    }

    if (sortedComponents.length === 0) {
      this.componentsList.style.display = "none";
      this.emptyMessage.style.display = "block";
      this.emptyMessage.textContent = "No components in this glyph";
    } else {
      this.componentsList.style.display = "block";
      this.emptyMessage.style.display = "none";

      // Helper to get base typtom name and short notation
      const getBaseTyptom = (name) => {
        if (!name.includes("tom")) return null;
        return name.split(".")[0];
      };

      const getTyptomShortName = (baseName) => {
        const mapping = {
          dotom: "D",
          itom: "I",
          etom: "E",
          vtom: "V",
          jtom: "J",
          ctom: "C",
          ktom: "K",
        };
        return mapping[baseName] || baseName;
      };

      // Build molecular formula: count total occurrences but maintain first appearance order
      const typtomSequence = sortedComponents
        .map((c) => getBaseTyptom(c.name))
        .filter((b) => b !== null);

      // Track first appearance and total count
      const seen = new Set();
      const counts = new Map();
      const order = [];

      for (const baseName of typtomSequence) {
        if (!seen.has(baseName)) {
          seen.add(baseName);
          order.push(baseName);
        }
        counts.set(baseName, (counts.get(baseName) || 0) + 1);
      }

      // Build formula
      const formulaParts = order.map((baseName) => {
        const shortName = getTyptomShortName(baseName);
        const count = counts.get(baseName);
        if (count === 1) {
          return shortName;
        } else {
          return `${shortName}<sub>${count}</sub>`;
        }
      });

      const formula = formulaParts.join("");

      // Add formula as first item
      const formulaItem = document.createElement("li");
      formulaItem.innerHTML = `<strong>Formula:</strong> ${formula}`;
      formulaItem.style.cssText = `
        padding: 0.5em;
        margin-bottom: 0.8em;
        background-color: var(--text-input-background-color);
        border-radius: 0.25em;
        border: 1px solid var(--text-input-foreground-color);
        font-size: 1.1rem;
      `;
      this.componentsList.appendChild(formulaItem);

      // Add each component in order with its X position
      for (const component of sortedComponents) {
        const x = component.transformation?.translateX || 0;
        const li = document.createElement("li");
        li.innerHTML = `${component.name} <span style="opacity: 0.7;">(x: ${Math.round(x)})</span>`;
        li.style.cssText = `
          padding: 0.4em 0.5em;
          margin-bottom: 0.2em;
          background-color: var(--text-input-background-color);
          border-radius: 0.25em;
          cursor: pointer;
        `;
        li.onmouseover = () => {
          li.style.backgroundColor = "var(--text-input-foreground-color)";
          li.style.color = "var(--text-input-background-color)";
        };
        li.onmouseout = () => {
          li.style.backgroundColor = "var(--text-input-background-color)";
          li.style.color = "var(--text-input-foreground-color)";
        };
        this.componentsList.appendChild(li);
      }
    }
  }

  async toggle(on) {
    if (on) {
      await this.updateComponentsList();
    }
  }
}

customElements.define("panel-molecular-typography", MolecularPanel);
