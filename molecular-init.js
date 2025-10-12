import MolecularPanel from "./molecular-panel.js";

export async function initPlugin(editorController, pluginPath) {
  console.log("Molecular Typography Plugin loaded!");
  const molecularPanel = new MolecularPanel(editorController);
  editorController.addSidebarPanel(molecularPanel, "right");
}
