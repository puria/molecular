import MolecularPanel from "./molecular-panel.js";

export function initPlugin(editorController, pluginPath) {
  const panel = new MolecularPanel(editorController, `${pluginPath}/molecule.svg`);
  editorController.addSidebarPanel(panel, "right");
  panel.installOverlay();
  // Fontra titles sidebar tabs from its own translation table, which has no entry for plugins
  document
    .querySelector(`.sidebar-tab[data-sidebar-name="${panel.identifier}"]`)
    ?.setAttribute("title", "Molecular formula");
}
