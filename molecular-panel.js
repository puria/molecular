import {
  TYPTOM_LETTERS,
  baseTyptomName,
  formulaParts,
  formulaText,
} from "./molecular-formula.js";
import {
  analyseBonds,
  compositionKey,
  greedyCompose,
  joinPieces,
  makeVariants,
  placementTransform,
  refineComposition,
  snapComponents,
  topology,
} from "./molecular-composer.js";
import {
  drawParts,
  hasReference,
  loadReferenceFaces,
  OCR_CELLS_PER_CAP,
  makeReader,
  makeSpace,
  partMatrix,
  outlineOfPath,
  rasterize,
  referencePart,
  transformedBounds,
} from "./molecular-ocr.js";
import {
  anchorName,
  bondAnchors,
  cellCharges,
  defaultAnchors,
  roleOf,
  transformAnchors,
} from "./molecular-bonds.js";
import {
  ALPHABET,
  ISOTOPES,
  TYPTOMS,
  addIsotopes,
  addLengthAxes,
  alphabetGlyphs,
  createTyptoms,
  fontraComponents,
  glyphState,
  writeComponents,
} from "./molecular-wizard.js";

const THUMBNAIL_SIZE = 80; // CSS px
const COMPOSE_CELLS_PER_CAP = 20; // coarser than the OCR grid: placement search cost grows fast
const JOIN_CELLS_PER_CAP = 60; // fine grid on which pieces are made to touch
const PARSIMONY = 0.03; // ranking cost per typtom, in OCR margin points
const MAX_SUGGESTIONS = 18;
const MIN_SCORE = 0.65; // search results reading weaker than this are not shown
const DISTINCT = 0.8; // suggestions overlapping more than this (IoU) count as the same idea
const IDENTITY = [1, 0, 0, 1, 0, 0];
const ACCENT_GAP = 0.08; // white between a letter and the accent above it, in cap heights
const SHOW_BONDS_KEY = "molecular.show-bonds";
const OVERLAY_ID = "molecular.bonds";
// Overlay colours [light theme, dark theme]: + and − ends in the usual red and blue,
// uncharged anchors (faces, curves) neutral, valid bonds green, broken ones amber.
const PALETTE = {
  plus: ["#d4002a", "#ff5c74"],
  minus: ["#0a5ad6", "#5aa2ff"],
  anchor: ["#3b3b3b", "#e6e6e6"],
  ok: ["#16803a", "#4fd17a"],
  broken: ["#d97000", "#ffb02e"],
  on: ["#fff", "#000"],
};

function palette(dark) {
  return Object.fromEntries(Object.entries(PALETTE).map(([key, pair]) => [key, pair[dark ? 1 : 0]]));
}

// One overlay symbol at (x, y) in a y-up context, r its radius:
//   plus / minus: a + or − end, a filled disc with the sign
//   face: a face anchor, a hollow diamond
//   curve: a curve anchor, a dashed ring
//   bond: a valid bond, a ring with a check mark
//   broken: a bond breaking a rule, a warning triangle with !
function drawSymbol(ctx, kind, x, y, r, colors) {
  const text = (glyph, color, size = 1.5 * r) => {
    ctx.save();
    ctx.scale(1, -1);
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, x, -y + 0.06 * r);
    ctx.restore();
  };
  ctx.lineWidth = 0.28 * r;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  switch (kind) {
    case "plus":
    case "minus": {
      ctx.fillStyle = colors[kind];
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      // Drawn bars, not text, so + and − are equally sized and centred
      ctx.strokeStyle = colors.on;
      ctx.lineWidth = 0.3 * r;
      ctx.beginPath();
      ctx.moveTo(x - 0.55 * r, y);
      ctx.lineTo(x + 0.55 * r, y);
      if (kind === "plus") {
        ctx.moveTo(x, y - 0.55 * r);
        ctx.lineTo(x, y + 0.55 * r);
      }
      ctx.stroke();
      break;
    }
    case "face":
      ctx.strokeStyle = colors.anchor;
      ctx.moveTo(x, y + r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.stroke();
      break;
    case "curve":
      ctx.strokeStyle = colors.anchor;
      ctx.setLineDash([0.5 * r, 0.4 * r]);
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case "bond":
      ctx.strokeStyle = colors.ok;
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 0.45 * r, y);
      ctx.lineTo(x - 0.1 * r, y - 0.4 * r);
      ctx.lineTo(x + 0.5 * r, y + 0.4 * r);
      ctx.stroke();
      break;
    case "broken":
      ctx.fillStyle = colors.broken;
      ctx.moveTo(x, y + 1.15 * r);
      ctx.lineTo(x + 1.15 * r, y - 0.85 * r);
      ctx.lineTo(x - 1.15 * r, y - 0.85 * r);
      ctx.closePath();
      ctx.fill();
      text("!", colors.on, 1.3 * r);
      break;
  }
}

const LEGEND = [
  ["plus", "+ end: bonds to a − end, or to any face or curve"],
  ["minus", "− end: bonds to a + end, or to any face or curve"],
  ["face", "Face: any end may bond along it, whatever its charge"],
  ["curve", "Jtom curve: any end may bond along it"],
  ["bond", "Bond that follows the rules"],
  ["broken", "Bond that breaks a rule: like ends meeting, or touching off an anchor"],
];

// What a bond report depends on: the glyph, its components' placement and anchors.
function bondKey(positionedGlyph) {
  const instance = positionedGlyph?.isUndefined ? null : positionedGlyph?.glyph?.instance;
  return JSON.stringify([
    positionedGlyph?.glyphName,
    instance?.components.map(({ name, transformation, location }) => [name, transformation, location]),
    instance?.anchors,
    positionedGlyph?.glyph?.bounds,
  ]);
}

// One sentence about a glyph's charges and bonds, for the panel.
function bondSummary(report) {
  if (report.typtom) {
    if (!report.anchors.length) {
      return "A dotom has no anchors: it never bonds, it floats by attraction.";
    }
    const count = (test) => report.anchors.filter(test).length;
    const [plus, minus] = [count((a) => a.sign > 0), count((a) => a.sign < 0)];
    const faces = count((a) => a.kind === "face");
    const curves = count((a) => a.kind === "curve");
    const where = report.drawn
      ? "drawn as anchors in this glyph"
      : "defaults: the end facing up or left is +";
    const parts = [`ends ${plus} + and ${minus} −`];
    if (faces) {
      parts.push(`${faces} ${faces === 1 ? "face" : "faces"}`);
    }
    if (curves) {
      parts.push("its curve");
    }
    return `Bonds at ${parts.join(", ")} (${where}).`;
  }
  const broken = report.bonds.filter((b) => !b.valid);
  const parts = [
    `${report.typtoms} typtoms, ${report.bonds.length} ${report.bonds.length === 1 ? "bond" : "bonds"}`,
  ];
  if (!report.bonds.length) {
    parts.push("nothing touches yet");
  } else if (!broken.length) {
    parts.push("all at anchors, ends meeting opposite charges");
  } else {
    const [first] = broken;
    parts.push(
      `${broken.length} ${broken.length === 1 ? "breaks" : "break"} the rules: ${first.names.join(" and ")} ` +
        "touch away from their anchors, or end to end with like charges"
    );
  }
  const note = report.undrawn.length
    ? ` Default charges for ${report.undrawn.join(", ")}.`
    : "";
  return parts.join(", ") + "." + note;
}

// Combining marks (as Unicode decomposes accented letters) and the spacing accent
// composed for each; "right" accents (ogonek) align with the letter's right side.
const ACCENTS = {
  "\u0300": { spacing: "`", above: true },
  "\u0301": { spacing: "´", above: true },
  "\u0302": { spacing: "ˆ", above: true },
  "\u0303": { spacing: "˜", above: true },
  "\u0304": { spacing: "¯", above: true },
  "\u0306": { spacing: "˘", above: true },
  "\u0307": { spacing: "˙", above: true },
  "\u0308": { spacing: "¨", above: true },
  "\u030A": { spacing: "˚", above: true },
  "\u030B": { spacing: "˝", above: true },
  "\u030C": { spacing: "ˇ", above: true },
  "\u0323": { spacing: ".", above: false },
  "\u0326": { spacing: ",", above: false },
  "\u0327": { spacing: "¸", above: false },
  "\u0328": { spacing: "˛", above: false, right: true },
};
const SPACING_ACCENTS = new Set(Object.values(ACCENTS).map((accent) => accent.spacing));

// The union of the ink boxes of placed components.
function inkBox(components) {
  const boxes = components.map((c) => transformedBounds(c.bounds, partMatrix(c)));
  return {
    xMin: Math.min(...boxes.map((b) => b.xMin)),
    yMin: Math.min(...boxes.map((b) => b.yMin)),
    xMax: Math.max(...boxes.map((b) => b.xMax)),
    yMax: Math.max(...boxes.map((b) => b.yMax)),
  };
}

// A suggestion from placed components: ink moved to start at x = 0, with a tenth of
// the cap height after it, as the template fonts do.
function finishComposition(components, source, reading, ocrSpace, metrics) {
  const box = inkBox(components);
  const placed = components.map((c) => ({ ...c, x: Math.round(c.x - box.xMin), y: Math.round(c.y) }));
  const parts = placed.map((c) => ({
    path: c.path,
    outline: c.outline,
    bounds: c.bounds,
    matrix: partMatrix(c),
  }));
  return {
    source,
    components: placed,
    parts,
    raster: rasterize(ocrSpace, parts),
    reading,
    xAdvance: Math.round(box.xMax - box.xMin + metrics.capHeight * 0.1),
  };
}

// Axis values worth trying: quarters of the range plus the font's own vertical metrics.
function sampleAxis({ minValue, maxValue }, { capHeight, xHeight }) {
  const span = maxValue - minValue;
  const values = [1, 2, 3, 4, 5, 6, 7, 8]
    .map((k) => minValue + (span * k) / 8)
    .concat([capHeight, xHeight, capHeight / 2, xHeight / 2, capHeight - xHeight]);
  return [...new Set(values.filter((v) => v > minValue && v <= maxValue).map(Math.round))];
}

// How far the wanted character's score is ahead of the best other character.
function marginFor(character, reading) {
  const own = reading.find((r) => r.character === character)?.score ?? -1;
  const rival = reading.find((r) => r.character !== character)?.score ?? -1;
  return own - rival;
}

// Overlap of two rasters of the same space: intersection over union.
function similarity(a, b) {
  let [shared, either] = [0, 0];
  for (let i = 0; i < a.length; i++) {
    shared += Math.min(a[i], b[i]);
    either += Math.max(a[i], b[i]);
  }
  return either ? shared / either : 1;
}

// A variable typtom's bounds at any axis value, from its sampled instances
// (bounds of a variable glyph move linearly between masters).
function interpolateBounds(samples, location) {
  const axis = samples[0].axis;
  if (!axis) {
    return samples[0].bounds;
  }
  const value = location[axis.name];
  const sorted = [...samples].sort((p, q) => p.location[axis.name] - q.location[axis.name]);
  let [low, high] = [sorted[0], sorted[1] ?? sorted[0]];
  for (let i = 1; i < sorted.length - 1 && sorted[i].location[axis.name] <= value; i++) {
    [low, high] = [sorted[i], sorted[i + 1]];
  }
  const [v0, v1] = [low.location[axis.name], high.location[axis.name]];
  const t = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
  const mix = (key) => low.bounds[key] + t * (high.bounds[key] - low.bounds[key]);
  return { xMin: mix("xMin"), yMin: mix("yMin"), xMax: mix("xMax"), yMax: mix("yMax") };
}

// Typtoms whose role fixes their direction (vertical, horizontal, diagonal stroke):
// they may only be flipped, or turned the ways the molecular fonts turn them.
const ROLE_TYPTOMS = ["itom", "etom", "vtom"];
// "rotation|mirror" in the form makeVariants uses, or null for an angle off 90° steps.
function orientationKey({ rotation = 0, scaleX = 1, scaleY = 1 }) {
  let [turn, mirror] = [rotation, Math.sign(scaleX) || 1];
  if (scaleY < 0) {
    [turn, mirror] = [turn + 180, -mirror]; // a vertical flip is a half turn plus a mirror
  }
  turn = ((Math.round(turn) % 360) + 360) % 360;
  return turn % 90 ? null : `${turn === 270 ? -90 : turn}|${mirror}`;
}

function allowedOrientations(catalogue) {
  const allowed = Object.fromEntries(
    ROLE_TYPTOMS.map((base) => [base, new Set(["0|1", "0|-1", "180|1", "180|-1"])])
  );
  for (const font of catalogue) {
    for (const molecules of Object.values(font.molecules)) {
      for (const { components } of molecules) {
        for (const c of components) {
          const key = orientationKey(c);
          if (key) {
            allowed[baseTyptomName(c.name)]?.add(key);
          }
        }
      }
    }
  }
  return allowed;
}

// A molecular font's typtom bounds at a glyph-axis location (control bounds,
// interpolated between its sources); null when the font has no such contour typtom.
function catalogueBounds(font, name, location) {
  const typtom = font.typtoms[name];
  if (!typtom) {
    return null;
  }
  const axis = typtom.axis;
  const valueOf = (loc) => (axis ? (loc[axis.name] ?? Object.values(loc)[0] ?? axis.defaultValue) : 0);
  const samples = typtom.samples.map(({ location, bounds }) => ({
    axis,
    location: axis ? { [axis.name]: valueOf(location) } : {},
    bounds,
  }));
  return interpolateBounds(samples, axis ? { [axis.name]: valueOf(location) } : {});
}

function scaleBox(box, ratio) {
  return Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value * ratio]));
}

// How much wider than tall a box is.
function wideness(box) {
  return (box.xMax - box.xMin) / Math.max(1, box.yMax - box.yMin);
}

// A catalogue molecule as components of this font: every typtom keeps its turn,
// flip and length (scaled by `ratio`, this font's cap height over the source's) and
// is centred where the source typtom was. Null when this font lacks one of the
// typtoms, or draws one in another direction (a horizontal etom where the source's
// was vertical), since its role would change.
function retarget(molecule, font, ratio, samples, boundsAt) {
  const placed = [];
  for (const c of molecule.components) {
    const name = samples.has(c.name) ? c.name : baseTyptomName(c.name);
    const sourceBounds = catalogueBounds(font, c.name, c.location);
    if (!samples.has(name) || !sourceBounds) {
      return null;
    }
    const axis = samples.get(name)[0].axis;
    let location = {};
    if (axis) {
      const given = Object.values(c.location)[0];
      const value = given === undefined ? axis.defaultValue : Math.round(given * ratio);
      location = { [axis.name]: Math.min(axis.maxValue, Math.max(axis.minValue, value)) };
    }
    const shape = {
      rotation: c.rotation ?? 0,
      scaleX: c.scaleX ?? 1,
      scaleY: c.scaleY ?? 1,
      skewX: c.skewX ?? 0,
      skewY: c.skewY ?? 0,
      tCenterX: (c.tCenterX ?? 0) * ratio,
      tCenterY: (c.tCenterY ?? 0) * ratio,
    };
    const was = scaleBox(
      transformedBounds(
        sourceBounds,
        partMatrix({ ...shape, x: c.translateX ?? 0, y: c.translateY ?? 0 })
      ),
      ratio
    );
    const is = transformedBounds(boundsAt(name, location), partMatrix(shape));
    const [w0, w1] = [wideness(was), wideness(is)];
    if ((w0 > 1.3 && w1 < 1 / 1.3) || (w0 < 1 / 1.3 && w1 > 1.3)) {
      return null;
    }
    const x = (was.xMin + was.xMax - is.xMin - is.xMax) / 2;
    const y = (was.yMin + was.yMax - is.yMin - is.yMax) / 2;
    // Two isotopes this font draws as the same typtom can land on one another:
    // keep one piece where they coincide
    const box = { xMin: is.xMin + x, yMin: is.yMin + y, xMax: is.xMax + x, yMax: is.yMax + y };
    const near = (a, b) => Math.abs(a - b) <= 0.02 * (box.yMax - box.yMin + box.xMax - box.xMin);
    if (
      placed.some(
        (p) => p.name === name && ["xMin", "yMin", "xMax", "yMax"].every((k) => near(p.box[k], box[k]))
      )
    ) {
      continue;
    }
    placed.push({ name, location, ...shape, x, y, box });
  }
  return placed.map(({ box, ...component }) => component);
}

// One stroke is one typtom: two Itoms (or Etoms, Vtoms) lined up end to end along
// the same column or row are a single stroke split in two.
function splitsAStroke(components, geometry, tolerance) {
  const boxes = components.map((c) => [baseTyptomName(c.name), geometry(c)]);
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  return boxes.some(([base, a], i) =>
    boxes.some(
      ([other, b], j) =>
        j > i &&
        base === other &&
        ROLE_TYPTOMS.includes(base) &&
        ((near(a.xMin, b.xMin) &&
          near(a.xMax, b.xMax) &&
          Math.max(a.yMin, b.yMin) - Math.min(a.yMax, b.yMax) <= tolerance) ||
          (near(a.yMin, b.yMin) &&
            near(a.yMax, b.yMax) &&
            Math.max(a.xMin, b.xMin) - Math.min(a.xMax, b.xMax) <= tolerance))
    )
  );
}

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

  .wizard {
    border-radius: 0.35em;
    background: var(--text-input-background-color);
    padding: 0.6em 0.75em;
  }

  .wizard summary {
    cursor: pointer;
    font-weight: 700;
  }

  .wizard summary span {
    font-weight: 400;
    color: var(--mol-muted);
  }

  .wizard-step {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    margin-top: 1em;
  }

  .wizard-step h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .wizard-step[aria-disabled="true"] h3 {
    color: var(--mol-muted);
  }

  .typtom-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.2em;
  }

  .typtom-row {
    display: grid;
    grid-template-columns: var(--mol-atom-size) 1fr auto;
    align-items: center;
    gap: 0.6em;
    width: 100%;
    padding: 0.35em 0.4em;
    border: none;
    border-radius: 0.35em;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 150ms ease-out;
  }

  .typtom-row:hover {
    background: var(--mol-row-hover);
  }

  .typtom-row:focus-visible,
  .wizard button:focus-visible,
  .wizard summary:focus-visible {
    outline: 2px solid var(--fontra-light-red-color);
    outline-offset: 1px;
  }

  .typtom-row small {
    display: block;
    color: var(--mol-muted);
    line-height: 1.35;
  }

  .state {
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .state[data-state="drawn"] {
    color: var(--mol-muted);
  }

  .state[data-state="empty"],
  .state[data-state="missing"],
  .warning {
    color: var(--fontra-red-color);
    font-weight: 700;
  }

  .wizard-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
  }

  .wizard-actions button {
    background: var(--ui-element-background-color);
    box-shadow: 0 1px 2px #0003;
  }

  .wizard-actions button:hover:not(:disabled) {
    background: var(--mol-row-selected);
  }

  .wizard-actions button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .empty-glyphs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3em;
  }

  .empty-glyphs button {
    min-width: 2em;
    padding: 0.2em 0.5em;
    border: 1px solid var(--fontra-red-color);
    border-radius: 0.35em;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35em;
  }

  .legend li {
    display: grid;
    grid-template-columns: 22px 1fr;
    align-items: center;
    gap: 0.5em;
    line-height: 1.3;
  }

  .legend canvas {
    width: 22px;
    height: 22px;
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

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
  }

  .toggle input {
    margin: 0;
    accent-color: var(--fontra-red-color);
  }

  .build {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
  }

  .build .section-title {
    margin: 0;
  }

  .reading {
    margin: 0;
    color: var(--mol-muted);
    font-variant-numeric: tabular-nums;
  }

  .reading b {
    color: var(--foreground-color);
    font-weight: 700;
  }

  .suggestions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4em;
  }

  .suggestion {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2em;
    width: 100%;
    padding: 0.45em 0.2em 0.4em;
    border: none;
    border-radius: 0.35em;
    background: var(--text-input-background-color);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition:
      background-color 150ms ease-out,
      box-shadow 150ms ease-out;
  }

  .suggestion:hover {
    background: var(--mol-row-selected);
  }

  .suggestion[aria-pressed="true"] {
    box-shadow: inset 0 0 0 1.5px currentColor;
  }

  .suggestion:focus-visible {
    outline: 2px solid var(--fontra-light-red-color);
    outline-offset: 1px;
  }

  .suggestion canvas {
    width: ${THUMBNAIL_SIZE}px;
    max-width: 100%;
    aspect-ratio: 1;
  }

  .suggestion-formula {
    font-family: fontra-ui-semibold, fontra-ui-regular, sans-serif;
  }

  .suggestion-face {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: var(--mol-muted);
  }

  .suggestion-score {
    font-size: 0.8rem;
    color: var(--mol-muted);
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .row,
    .atom,
    .copy,
    .suggestion {
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
    this.editorController = editorController;
    this.sceneController = editorController.sceneController;
    this.sceneSettings = this.sceneController.sceneSettings;
    this.sceneModel = this.sceneController.sceneModel;
    this.fontController = editorController.fontController;
    this._compositionCache = new Map();
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
    this.composeTitle = element("h3", { class: "section-title" });
    this.readingElement = element("p", { "class": "reading", "aria-live": "polite" });
    this.suggestionList = element("ol", { class: "suggestions" });
    this.buildSection = element("section", { class: "build" }, [
      this.composeTitle,
      this.readingElement,
      this.suggestionList,
    ]);
    this.buildSection.hidden = true;
    this.suggestionList.addEventListener("click", (event) => {
      const button = event.target.closest(".suggestion");
      if (button) {
        this.applyComposition(this.compositions[Number(button.dataset.index)]);
      }
    });

    this.bondsTitle = element("h3", { class: "section-title" }, ["Bonds"]);
    this.bondsSummary = element("p", { "class": "reading", "aria-live": "polite" });
    this.showBondsInput = element("input", { type: "checkbox", id: "molecular-show-bonds" });
    this.showBondsInput.checked = localStorage.getItem(SHOW_BONDS_KEY) !== "false";
    this.showBondsInput.addEventListener("change", () => {
      localStorage.setItem(SHOW_BONDS_KEY, this.showBondsInput.checked);
      this.setOverlay(this.showBondsInput.checked);
    });
    this.writeAnchorsButton = element("button", { class: "copy", type: "button" }, [
      "Write charges into typtoms",
    ]);
    this.writeAnchorsButton.title =
      "Adds end±, face± and curve± anchors to every typtom that has none, so you can see and move them";
    this.writeAnchorsButton.addEventListener("click", () => this.writeDefaultAnchors());
    this.bondsSection = element("section", { class: "build" }, [
      this.bondsTitle,
      element("label", { class: "toggle", for: "molecular-show-bonds" }, [
        this.showBondsInput,
        "Show charges and bonds on the canvas",
      ]),
      (this.legendList = element("ul", { class: "legend" })),
      this.bondsSummary,
      element("div", {}, [this.writeAnchorsButton]),
    ]);
    this.bondsSection.hidden = true;

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
      this.buildWizard(),
      element("div", { class: "head" }, [this.glyphNameElement, this.copyButton]),
      this.formulaElement,
      this.chainSection,
      this.othersSection,
      this.bondsSection,
      this.buildSection,
      this.hintElement,
    ]);
  }

  // The font setup wizard: step 1 draws the seven typtoms, step 2 creates and
  // composes every printable ASCII glyph from them. Shown until the font has all
  // seven typtoms drawn and every one of those glyphs filled.
  buildWizard() {
    this.wizardStatus = element("span");
    this.typtomList = element("ul", { class: "typtom-list" });
    this.createTyptomsButton = element("button", { class: "copy", type: "button" }, [
      "Create the typtom glyphs",
    ]);
    this.createTyptomsButton.addEventListener("click", () => this.startTyptoms());
    this.typtomList.addEventListener("click", (event) => {
      const row = event.target.closest(".typtom-row");
      if (row) {
        this.openTyptom(row.dataset.name);
      }
    });
    this.composeAllButton = element("button", { class: "copy", type: "button" });
    this.composeAllButton.addEventListener("click", () =>
      this._composingAll ? (this._stopComposing = true) : this.composeAll()
    );
    this.glyphsHint = element("p", { class: "reading" });
    this.wizardProgress = element("p", { "class": "reading", "aria-live": "polite" });
    this.emptyTitle = element("p", { class: "warning" });
    this.emptyList = element("div", { class: "empty-glyphs" });
    this.emptyList.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) {
        const names = [...this.emptyList.querySelectorAll("button")].map((b) => b.dataset.name);
        this.openGlyphs(names, names.indexOf(button.dataset.name));
      }
    });
    this.glyphStep = element("section", { class: "wizard-step" }, [
      element("h3", {}, ["2 · Build the glyphs"]),
      this.glyphsHint,
      element("div", { class: "wizard-actions" }, [this.composeAllButton]),
      this.wizardProgress,
      this.emptyTitle,
      this.emptyList,
    ]);
    this.wizard = element("details", { class: "wizard" }, [
      element("summary", {}, ["Font setup ", this.wizardStatus]),
      element("section", { class: "wizard-step" }, [
        element("h3", {}, ["1 · Draw the seven typtoms"]),
        element("p", { class: "reading" }, [
          "Every glyph is built from these. Click a typtom to draw it; step 2 opens once all seven have a shape.",
        ]),
        element("div", { class: "wizard-actions" }, [this.createTyptomsButton]),
        this.typtomList,
      ]),
      this.glyphStep,
    ]);
    this.wizard.hidden = true;
    return this.wizard;
  }

  refreshWizard() {
    clearTimeout(this._wizardTimer);
    this._wizardTimer = setTimeout(() => this.renderWizard(), 300);
  }

  async renderWizard() {
    const fc = this.fontController;
    const typtoms = await Promise.all(
      TYPTOMS.map(async (t) => ({ ...t, state: await glyphState(fc, t.name) }))
    );
    const glyphs = await Promise.all(
      alphabetGlyphs(fc).map(async (g) => ({ ...g, state: await glyphState(fc, g.name) }))
    );
    const undrawn = typtoms.filter((t) => t.state !== "drawn");
    const unfilled = glyphs.filter((g) => g.state !== "drawn");
    const missingIsotopes = ISOTOPES.filter((i) => !fc.glyphMap[i.name]);
    const complete = !undrawn.length && !unfilled.length && !missingIsotopes.length;
    this.wizard.hidden = complete && !this._composingAll && !this._composedThisSession;
    if (this._wizardShown === undefined && !complete) {
      // Open on first sight while typtoms are missing; afterwards it is up to you
      this.wizard.open = undrawn.length > 0;
      this._wizardShown = true;
    }
    const emptyCount = glyphs.filter((g) => g.state === "empty").length;
    this.wizardStatus.replaceChildren(
      undrawn.length
        ? `· ${7 - undrawn.length} of 7 typtoms drawn`
        : `· ${glyphs.length - unfilled.length} of ${glyphs.length} glyphs`,
      ...(emptyCount ? [" · ", element("span", { class: "warning" }, [`${emptyCount} empty`])] : [])
    );

    const cap = this.fontMetrics().capHeight;
    this.createTyptomsButton.hidden = !typtoms.some((t) => t.state === "missing");
    this.typtomList.replaceChildren(
      ...typtoms.map(({ name, role, draw, state }) =>
        element("li", {}, [
          element("button", { "class": "typtom-row", "type": "button", "data-name": name }, [
            element("span", { "class": "atom", "aria-hidden": "true" }, [TYPTOM_LETTERS[name]]),
            element("span", {}, [
              `${name} · ${role}`,
              element("small", {}, [`Draw ${draw(cap)}.`]),
            ]),
            element("span", { "class": "state", "data-state": state }, [
              { missing: "missing", empty: "empty: draw it", drawn: "drawn" }[state],
            ]),
          ]),
        ])
      )
    );

    const ready = !undrawn.length;
    this.glyphStep.setAttribute("aria-disabled", String(!ready));
    this.composeAllButton.disabled = !ready;
    this.composeAllButton.textContent = this._composingAll
      ? "Stop"
      : "Create " +
        [
          missingIsotopes.length && `${missingIsotopes.length} isotopes`,
          unfilled.length && `${unfilled.length} glyphs`,
        ]
          .filter(Boolean)
          .join(" and ");
    this.composeAllButton.hidden = complete && !this._composingAll;
    this.glyphsHint.textContent = ready
      ? `Makes the isotopes from your typtoms (${ISOTOPES.map((i) => i.name).join(", ")}: .alt mirrored, .half half as tall at the same stroke weight), then creates every letter, digit and punctuation mark this font lacks (${ALPHABET.length} in all) and fills each with its best composition: your molecules first, then the search. Isotopes and glyphs you already have are left alone.`
      : `First draw ${undrawn.map((t) => t.name).join(", ")}.`;
    const empty = glyphs.filter((g) => g.state === "empty");
    this.emptyTitle.hidden = !empty.length;
    this.emptyTitle.textContent = `${empty.length} ${empty.length === 1 ? "glyph is" : "glyphs are"} empty. Click one to draw it or pick a suggestion.`;
    this.emptyList.replaceChildren(
      ...empty.map(({ name, character }) =>
        element("button", { "type": "button", "data-name": name, "title": name }, [character])
      )
    );
  }

  // Shows glyphs on the canvas and opens one of them for editing.
  async openGlyphs(names, index) {
    const layout = this.sceneController.sceneSettingsController.waitForKeyChange(
      "positionedLines",
      false,
      2000
    );
    this.sceneSettings.text = names.map((name) => `/${name}`).join(" ");
    await layout;
    this.sceneSettings.selectedGlyph = { lineIndex: 0, glyphIndex: index, isEditing: true };
  }

  async startTyptoms() {
    await createTyptoms(this.fontController);
    await this.openTyptom(TYPTOMS[0].name);
    this.refreshWizard();
  }

  async openTyptom(name) {
    if (!this.fontController.glyphMap[name]) {
      await createTyptoms(this.fontController);
    }
    const names = TYPTOMS.map((t) => t.name);
    await this.openGlyphs(names, names.indexOf(name));
    this.refreshWizard();
  }

  // Step 2: length axes for the strokes, then every missing or empty glyph composed.
  async composeAll() {
    this._composingAll = true;
    this._composedThisSession = true; // keeps the result on screen once complete
    this._stopComposing = false;
    this.renderWizard();
    try {
      await addLengthAxes(this.fontController, this.sceneController);
      await addIsotopes(this.fontController);
      this._compositionCache.clear(); // typtoms changed
      const metrics = this.fontMetrics();
      await loadReferenceFaces();
      const ocrSpace = makeSpace(metrics, OCR_CELLS_PER_CAP);
      const todo = [];
      for (const glyph of alphabetGlyphs(this.fontController)) {
        if ((await glyphState(this.fontController, glyph.name)) !== "drawn") {
          todo.push(glyph);
        }
      }
      for (const [n, { name, character }] of todo.entries()) {
        if (this._stopComposing) {
          break;
        }
        this.wizardProgress.textContent = `Composing “${character}” (${n + 1} of ${todo.length})…`;
        const suggestions = await this.compose(
          character,
          ocrSpace,
          metrics,
          () => this._stopComposing,
          { loose: SPACING_ACCENTS.has(character), quick: true }
        );
        if (suggestions === null) {
          break; // stopped
        }
        await writeComponents(
          this.fontController,
          this.sceneController,
          name,
          character,
          suggestions[0] ?? null // best first: your own molecules lead
        );
      }
      this.wizardProgress.textContent = this._stopComposing
        ? "Stopped. Click the button again to carry on."
        : `Done: ${todo.length} glyphs composed.`;
      // By glyph name: a literal "/" in the text would start a glyph name
      this.sceneSettings.text = alphabetGlyphs(this.fontController)
        .map((g) => `/${g.name}`)
        .join(" ");
    } catch (error) {
      console.error("Molecular: composing the font failed", error);
      this.wizardProgress.textContent = `Composing stopped on an error: ${error.message}`;
    } finally {
      this._composingAll = false;
      this.refreshWizard();
    }
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
        y: component.transformation?.translateY || 0,
        base: baseTyptomName(component.name),
      }))
      .sort((a, b) => a.x - b.x);

    const key = JSON.stringify([
      glyphName,
      positionedGlyph?.isUndefined,
      components.map(({ name, transformation, location }) => [name, transformation, location]),
      positionedGlyph?.glyph?.instance?.anchors,
      positionedGlyph?.glyph?.bounds,
      this.sceneSettings.fontLocationSourceMapped,
      this.sceneSettings.glyphLocation,
    ]);
    if (key !== this._renderedKey) {
      this._renderedKey = key;
      this.render(positionedGlyph, sorted);
      this.renderCompose(positionedGlyph);
      this.analyseGlyph(positionedGlyph);
    }
    this.refreshWizard();
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
    this.hintElement.hidden =
      !positionedGlyph || positionedGlyph.isUndefined || !!typtoms.length;
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

  // Redo the bond report for the edited glyph soon, once edits settle. Runs whether
  // or not the panel is visible, since the overlay draws on the canvas either way.
  refreshBonds() {
    clearTimeout(this._bondTimer);
    this._bondTimer = setTimeout(
      () => this.analyseGlyph(this.sceneModel.getSelectedPositionedGlyph()),
      120
    );
  }

  // Charges and bonds of the edited glyph, for the summary and the overlay. A
  // typtom glyph shows its own anchors; a molecule shows every component's anchors
  // and each bond between two components, valid or breaking the rules.
  async analyseGlyph(positionedGlyph) {
    const token = (this._bondToken = (this._bondToken || 0) + 1);
    const glyph = positionedGlyph?.isUndefined ? null : positionedGlyph?.glyph;
    const glyphName = positionedGlyph?.glyphName;
    let report = null;
    const isTyptom = glyphName && baseTyptomName(glyphName);
    if (glyph && isTyptom && glyph.bounds && !glyph.instance.components.length) {
      const outline = outlineOfPath(glyph.flattenedPath);
      const role = roleOf(glyphName, outline, glyph.bounds);
      const drawn = bondAnchors(glyph.instance.anchors);
      report = {
        glyphName,
        typtom: role,
        drawn: drawn.length > 0,
        anchors: drawn.length ? drawn : defaultAnchors(role, outline, glyph.bounds),
        bonds: [],
      };
    } else if (glyph) {
      report = await this.bondReport(glyphName, glyph.instance.components);
    }
    if (token !== this._bondToken) {
      return;
    }
    this._bondKey = bondKey(positionedGlyph);
    this.bondReportData = report;
    this.bondsSection.hidden = !report;
    if (report) {
      this.bondsSummary.textContent = [bondSummary(report), this._bondNote].filter(Boolean).join(" ");
      this._bondNote = null;
    }
    this.editorController.canvasController.requestUpdate();
  }

  async bondReport(glyphName, components) {
    const fine = makeSpace(this.fontMetrics(), JOIN_CELLS_PER_CAP);
    const placed = [];
    for (const c of components) {
      const shape = baseTyptomName(c.name) && (await this.typtomShape(c.name, c.location || {}));
      if (shape) {
        const t = c.transformation;
        const matrix = partMatrix({ ...t, x: t.translateX, y: t.translateY });
        placed.push({ shape, matrix, anchors: transformAnchors(shape.anchors, matrix) });
      }
    }
    if (!placed.length) {
      return null;
    }
    // The grid is centred on x = 0: centre the ink on it
    const boxes = placed.map((p) => transformedBounds(p.shape.bounds, p.matrix));
    const cx = (Math.min(...boxes.map((b) => b.xMin)) + Math.max(...boxes.map((b) => b.xMax))) / 2;
    const pieces = placed.map(({ shape, matrix }) => {
      const centred = [...matrix.slice(0, 4), matrix[4] - cx, matrix[5]];
      const cells = [];
      rasterize(fine, [{ outline: shape.outline, matrix: centred }]).forEach(
        (value, i) => value > 0.5 && cells.push(i)
      );
      return {
        cells,
        ...cellCharges(shape.role, cells, fine, transformAnchors(shape.anchors, centred)),
        floating: shape.role === "dotom",
      };
    });
    const { bonds, regions } = analyseBonds(
      pieces,
      pieces.map(() => [0, 0]),
      fine.cols,
      fine.rows
    );
    return {
      glyphName,
      parts: regions.length,
      typtoms: placed.length,
      undrawn: [...new Set(placed.filter((p) => !p.shape.drawnAnchors).map((p) => p.shape.name))],
      anchors: placed.flatMap((p) => p.anchors),
      bonds: bonds.map(({ p, q, valid, cells }) => {
        const [sx, sy] = cells.reduce(
          ([x, y], i) => [x + (i % fine.cols) + 0.5, y + Math.floor(i / fine.cols) + 0.5],
          [0, 0]
        );
        return {
          valid,
          names: [placed[q].shape.name, placed[p].shape.name],
          x: fine.left + (sx / cells.length) * fine.unit + cx,
          y: fine.top - (sy / cells.length) * fine.unit,
        };
      }),
    };
  }

  // Registers the red overlay with Fontra's canvas (plugins can't import Fontra's
  // modules, so the definition goes straight into the editor's layer list).
  installOverlay() {
    const layers = this.editorController.visualizationLayers;
    if (!layers.definitions.some((definition) => definition.identifier === OVERLAY_ID)) {
      const definition = {
        identifier: OVERLAY_ID,
        name: "Molecular charges and bonds",
        selectionFunc: (visContext) => visContext.glyphsBySelectionMode?.editing || [],
        zIndex: 550,
        screenParameters: { radius: 7 },
        colors: palette(false),
        colorsDarkMode: palette(true),
        draw: (args) => this.drawOverlay(args),
      };
      const at = layers.definitions.findIndex((other) => other.zIndex > definition.zIndex);
      layers.definitions.splice(at < 0 ? layers.definitions.length : at, 0, definition);
    }
    this.setOverlay(this.showBondsInput.checked);
  }

  setOverlay(on) {
    this.editorController.visualizationLayers.toggle(OVERLAY_ID, on);
    this.editorController.canvasController.requestUpdate();
  }

  drawOverlay({ context, positionedGlyph, parameters }) {
    if (this._legendDark !== this.editorController.isThemeDark) {
      this.renderLegend(); // the theme changed: redraw the legend in its colours
    }
    if (this._bondKey !== bondKey(positionedGlyph)) {
      // The glyph changed since the report (moved, turned, flipped; maybe while the
      // panel was hidden behind another one): show nothing until it is redone
      this.refreshBonds();
      return;
    }
    const report = this.bondReportData;
    if (!report) {
      return;
    }
    const r = parameters.radius;
    for (const { kind, sign, x, y } of report.anchors) {
      drawSymbol(context, kind === "end" ? (sign > 0 ? "plus" : "minus") : kind, x, y, r, parameters);
    }
    for (const { valid, x, y } of report.bonds) {
      drawSymbol(context, valid ? "bond" : "broken", x, y, 0.9 * r, parameters);
    }
  }

  // The legend, drawn with the same symbols and colours as the canvas overlay.
  renderLegend() {
    this._legendDark = this.editorController.isThemeDark;
    const colors = palette(this._legendDark);
    const size = 22;
    const ratio = window.devicePixelRatio || 1;
    this.legendList.replaceChildren(
      ...LEGEND.map(([kind, text]) => {
        const canvas = element("canvas", {
          "width": size * ratio,
          "height": size * ratio,
          "aria-hidden": "true",
        });
        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, -ratio, (size * ratio) / 2, (size * ratio) / 2);
        drawSymbol(ctx, kind, 0, 0, size * 0.32, colors);
        return element("li", {}, [canvas, element("span", {}, [text])]);
      })
    );
  }

  // Writes the default charges as anchors into every typtom glyph (each layer) that
  // has none, so the designer can see them in Fontra and move or flip them.
  async writeDefaultAnchors() {
    let written = 0;
    for (const name of Object.keys(this.fontController.glyphMap)) {
      const varGlyph = baseTyptomName(name) && (await this.fontController.getGlyph(name));
      const needed = (staticGlyph) =>
        staticGlyph.path.numPoints > 0 && !bondAnchors(staticGlyph.anchors).length;
      if (!varGlyph || !Object.values(varGlyph.glyph.layers).some((l) => needed(l.glyph))) {
        continue;
      }
      // Role and orientation come from the largest layer, so a typtom shortened to
      // nothing on a glyph axis keeps the anchors of its full-size self
      const area = ({ xMin, yMin, xMax, yMax }) => (xMax - xMin) * (yMax - yMin);
      const largest = Object.values(varGlyph.glyph.layers)
        .map((layer) => layer.glyph.path)
        .filter((path) => path.getBounds())
        .sort((a, b) => area(b.getBounds()) - area(a.getBounds()))[0];
      const reference = largest.getBounds();
      const role = roleOf(name, outlineOfPath(largest), reference);
      const tall = reference.yMax - reference.yMin >= reference.xMax - reference.xMin;
      if (role === "dotom") {
        continue;
      }
      await this.sceneController.editNamedGlyphAndRecordChanges(name, (glyph) => {
        for (const layer of Object.values(glyph.layers)) {
          const staticGlyph = layer.glyph;
          const bounds = needed(staticGlyph) && staticGlyph.path.getBounds();
          if (bounds) {
            const outline = outlineOfPath(staticGlyph.path);
            for (const anchor of defaultAnchors(role, outline, bounds, tall)) {
              staticGlyph.anchors.push({
                name: anchorName(anchor),
                x: Math.round(anchor.x),
                y: Math.round(anchor.y),
              });
            }
          }
        }
        return "Write typtom charges";
      });
      written++;
    }
    this._compositionCache.clear();
    this._renderedKey = null;
    this._bondNote = written
      ? `Charges written into ${written} typtom glyphs: move or rename their anchors in Fontra to change how they bond.`
      : "Every typtom already has its charges.";
    this.scheduleUpdate();
  }

  // The text a glyph stands for: its code point; or, from its name, a "uniXXXX" or
  // "uXXXXX" code, a one-character name, an alternate's base ("a.alt" is "a") or a
  // ligature's parts ("f_i" is "fi"). Null when there is no such text.
  targetText(positionedGlyph) {
    const glyphMap = this.fontController.glyphMap || {};
    const fromName = (name) => {
      const codePoint = glyphMap[name]?.[0];
      if (codePoint !== undefined) {
        return String.fromCodePoint(codePoint);
      }
      const code = name.match(/^uni([0-9A-F]{4})$|^u([0-9A-F]{4,6})$/);
      if (code) {
        return String.fromCodePoint(parseInt(code[1] ?? code[2], 16));
      }
      return [...name].length === 1 ? name : null;
    };
    const name = positionedGlyph.glyphName;
    const text =
      positionedGlyph.character ??
      fromName(name) ??
      fromName(name.split(".")[0]) ??
      name
        .split(".")[0]
        .split("_")
        .map((part) => fromName(part) ?? "\0")
        .join("");
    return text && !/[\p{C}\p{Z}]/u.test(text) ? text : null;
  }

  fontMetrics() {
    const lineMetrics = this.sceneModel.fontSourceInstance?.lineMetricsHorizontalLayout || {};
    const unitsPerEm = this.fontController.unitsPerEm;
    const capHeight = lineMetrics.capHeight?.value || unitsPerEm * 0.7;
    return {
      capHeight,
      xHeight: lineMetrics.xHeight?.value || capHeight * 0.68,
      ascender: lineMetrics.ascender?.value || unitsPerEm * 0.8,
      descender: lineMetrics.descender?.value || unitsPerEm * -0.2,
    };
  }

  // Every typtom glyph in the font (variants such as .half and .alt included),
  // at the current location, sampled along its first glyph axis. A stroke typtom
  // (Itom, Etom, Vtom) shortened until it is no longer than it is thick is marked
  // `squat`: it is no stroke any more, so the search does not use it.
  async typtomInstances(metrics) {
    const names = Object.keys(this.fontController.glyphMap)
      .filter((name) => baseTyptomName(name))
      .sort();
    const instances = [];
    for (const name of names) {
      const axis = (await this.fontController.getGlyph(name))?.glyph.axes?.[0];
      const full = axis && (await this.typtomShape(name, { [axis.name]: axis.defaultValue }));
      const tall = full && full.bounds.yMax - full.bounds.yMin > full.bounds.xMax - full.bounds.xMin;
      for (const value of axis ? sampleAxis(axis, metrics) : [null]) {
        const instance = await this.typtomShape(name, axis ? { [axis.name]: value } : {});
        if (instance) {
          const { xMin, yMin, xMax, yMax } = instance.bounds;
          const [length, thickness] = tall ? [yMax - yMin, xMax - xMin] : [xMax - xMin, yMax - yMin];
          const squat =
            !!full && ROLE_TYPTOMS.includes(baseTyptomName(name)) && length <= thickness;
          instances.push({ ...instance, axis, squat });
        }
      }
    }
    return instances;
  }

  // One typtom at a glyph-axis location, at the current font location, with its bond
  // anchors: the "end±", "face±", "curve±" anchors drawn in the glyph, or defaults.
  async typtomShape(name, location) {
    const instance = await this.fontController.getGlyphInstance(name, {
      ...this.sceneSettings.fontLocationSourceMapped,
      ...location,
    });
    if (!instance?.bounds) {
      return null;
    }
    const outline = outlineOfPath(instance.flattenedPath);
    const drawn = bondAnchors(instance.anchors);
    // Role and orientation from the typtom at full size (its glyph axes at default)
    const full =
      Object.keys(location).length > 0
        ? await this.fontController.getGlyphInstance(name, this.sceneSettings.fontLocationSourceMapped)
        : instance;
    const reference = full?.bounds || instance.bounds;
    const role = roleOf(name, outlineOfPath((full || instance).flattenedPath), reference);
    const tall = reference.yMax - reference.yMin >= reference.xMax - reference.xMin;
    return {
      name,
      location,
      role,
      path: instance.flattenedPath2d,
      outline,
      bounds: instance.bounds,
      anchors: drawn.length ? drawn : defaultAnchors(role, outline, instance.bounds, tall),
      drawnAnchors: drawn.length > 0,
    };
  }

  async renderCompose(positionedGlyph) {
    const token = (this._composeToken = (this._composeToken || 0) + 1);
    const glyph = positionedGlyph?.isUndefined ? undefined : positionedGlyph?.glyph;
    const text = positionedGlyph && this.targetText(positionedGlyph);
    if (!text) {
      this.buildSection.hidden = true;
      return;
    }
    this.buildSection.hidden = false;
    this.hintElement.hidden = true;
    this.composeTitle.textContent = `Compose “${text}”`;

    const metrics = this.fontMetrics();
    await loadReferenceFaces([...text].find((c) => c.codePointAt(0) >= 127) ?? "A");
    if (token !== this._composeToken) {
      return;
    }
    const ocrSpace = makeSpace(metrics, OCR_CELLS_PER_CAP);
    const read = makeReader(ocrSpace, [...text].length === 1 ? text : "");
    const current = glyph?.bounds
      ? read(rasterize(ocrSpace, [{ outline: outlineOfPath(glyph.flattenedPath), matrix: IDENTITY }]))
      : [];

    if (!this._compositionCache.has(JSON.stringify([text, this.sceneSettings.fontLocationSourceMapped]))) {
      this.readingElement.textContent = "Composing from this font’s typtoms…";
      this.suggestionList.replaceChildren();
    }
    const compositions = await this.composeText(text, ocrSpace, metrics, () => {
      return token !== this._composeToken;
    });
    if (!compositions || token !== this._composeToken) {
      return; // a newer render took over
    }
    this.compositions = compositions;

    this.readingElement.replaceChildren(
      ...(current.length
        ? [
            "This glyph reads as ",
            element("b", {}, [current[0].character]),
            ` ${current[0].score.toFixed(2)}, next ${current[1].character} ${current[1].score.toFixed(2)}.`,
          ]
        : !compositions.length
          ? ["No composition found from this font’s typtoms."]
          : glyph
            ? ["Empty glyph: pick a composition to start."]
            : ["Not in the font yet: pick a composition to create it."])
    );

    const currentKey = compositionKey(
      (glyph?.instance.components || []).map(({ name, location, transformation }) => ({
        name,
        location: location || {},
        rotation: transformation.rotation,
        scaleX: transformation.scaleX,
        x: transformation.translateX,
        y: transformation.translateY,
      }))
    );
    const color = getComputedStyle(this.suggestionList).color;
    const pixelRatio = window.devicePixelRatio || 1;
    this.suggestionList.replaceChildren(
      ...compositions.map(({ components, parts, reading, source }, index) => {
        const canvas = element("canvas", {
          width: THUMBNAIL_SIZE * pixelRatio,
          height: THUMBNAIL_SIZE * pixelRatio,
        });
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = color;
        drawParts(ctx, parts, THUMBNAIL_SIZE * pixelRatio, 5 * pixelRatio);
        const names = [...components].sort((a, b) => a.x - b.x).map((c) => c.name);
        const [first, second] = reading;
        const description =
          `Reads as ${first.character} ${first.score.toFixed(2)}, ` +
          `next ${second.character} ${second.score.toFixed(2)}. ` +
          `Click to put ${components.length === 1 ? "this typtom" : `these ${components.length} typtoms`} in the glyph. ` +
          `From ${source}.`;
        return element("li", {}, [
          element(
            "button",
            {
              "class": "suggestion",
              "type": "button",
              "data-index": index,
              "aria-pressed": String(compositionKey(components) === currentKey),
              "aria-label": description,
              "title": description,
            },
            [
              canvas,
              element("span", { class: "suggestion-formula" }, [
                formulaText(formulaParts(names)),
              ]),
              element("span", { class: "suggestion-score" }, [
                `${first.character} ${first.score.toFixed(2)}`,
              ]),
              element("span", { class: "suggestion-face" }, [source]),
            ]
          ),
        ]);
      })
    );
  }

  // Suggestions for a character, two kinds:
  // 1. the molecules your molecular fonts already have for it, rebuilt with this
  //    font's typtoms (scaled to its cap height, then joined where thicker or thinner
  //    typtoms opened gaps);
  // 2. a search after every reference typeface (as a loose and a strict fit), using
  //    typtoms only in their roles and bonds only at their anchors: greedy placement,
  //    a connectivity search, edge snapping in font units, rule-abiding joining.
  // Everything is read back with the OCR. Returns the molecules, then the readable,
  // rule-abiding, distinct search results, best first.
  // `loose` (used for accents): when nothing reads as the character, which the OCR
  // often can't tell for small marks, the best-ranked results are kept anyway.
  // `quick` (the font setup) settles for the font's own molecules when there are any.
  async compose(character, ocrSpace, metrics, isStale, { loose = false, quick = false } = {}) {
    const space = makeSpace(metrics, COMPOSE_CELLS_PER_CAP);
    const fine = makeSpace(metrics, JOIN_CELLS_PER_CAP);
    const typtoms = await this.typtomInstances(metrics);
    const [faces, catalogue] = await Promise.all([
      loadReferenceFaces(character),
      import("./molecular-catalogue.js").then((module) => module.MOLECULE_FONTS),
    ]);
    const read = makeReader(ocrSpace, character);
    if (isStale()) {
      return null;
    }
    const orientations = allowedOrientations(catalogue);
    const variants = makeVariants(space, typtoms, (typtom, { rotation, scaleX }) => {
      const allowed = orientations[baseTyptomName(typtom.name)];
      return !typtom.squat && (!allowed || allowed.has(`${rotation}|${scaleX}`));
    });

    const samples = new Map();
    for (const typtom of typtoms) {
      samples.set(typtom.name, [...(samples.get(typtom.name) || []), typtom]);
    }
    const boundsAt = (name, location) => interpolateBounds(samples.get(name), location);
    const geometry = (c) => transformedBounds(boundsAt(c.name, c.location), partMatrix(c));
    const stretch = (c, edge, to) => {
      const axis = samples.get(c.name)[0].axis;
      if (!axis) {
        return null;
      }
      const value = c.location[axis.name];
      const now = geometry(c)[edge];
      const rate = geometry({ ...c, location: { [axis.name]: value + 1 } })[edge] - now;
      const next = Math.round(value + (to - now) / rate);
      if (Math.abs(rate) < 1e-6 || next < axis.minValue || next > axis.maxValue) {
        return null;
      }
      return { ...c, location: { [axis.name]: next } };
    };
    const lines = [0, metrics.xHeight, metrics.capHeight, metrics.ascender, metrics.descender];
    // How many separate parts a reference letter has, measured on the fine grid so
    // that hairline strokes (a Bodoni crossbar) still join
    const inkOf = (face) =>
      topology(
        Uint8Array.from(rasterize(fine, [referencePart(fine, face, character)]), (t) => (t > 0.25 ? 1 : 0)),
        fine.cols,
        fine.rows
      ).ink;
    const firstFace = faces.find((face) => face.glyphs[character]);
    const referenceInk = firstFace ? inkOf(firstFace) : 1;

    // Font-unit components in, finished suggestion out (null when it breaks the rules)
    const finish = async (source, placed, { snap, enforce, wantedInk }) => {
      const snapped = snap ? snapComponents(placed, geometry, lines, space.unit, stretch) : placed;
      const shaped = [];
      for (const c of snapped) {
        const shape = await this.typtomShape(c.name, c.location);
        if (!shape) {
          return null;
        }
        shaped.push({ ...shape, ...c });
      }
      const pieces = shaped.map((c) => {
        const raster = rasterize(fine, [{ outline: c.outline, matrix: partMatrix(c) }]);
        const cells = [];
        raster.forEach((value, i) => value > 0.5 && cells.push(i));
        return {
          cells,
          ...cellCharges(c.role, cells, fine, transformAnchors(c.anchors, partMatrix(c))),
          floating: c.role === "dotom",
        };
      });
      const maxShift = Math.round((2 * space.unit) / fine.unit);
      const shifts = joinPieces(pieces, fine.cols, fine.rows, wantedInk, maxShift);
      if (enforce) {
        const { regions, violations } = analyseBonds(pieces, shifts, fine.cols, fine.rows);
        if (violations || regions.length > wantedInk) {
          return null;
        }
        const moved = shaped.map((c, i) => ({
          ...c,
          x: c.x + shifts[i][0] * fine.unit,
          y: c.y - shifts[i][1] * fine.unit,
        }));
        if (splitsAStroke(moved, geometry, metrics.capHeight * 0.04)) {
          return null;
        }
      }
      // The fine grid places pieces to within a cell; make touching edges meet exactly
      const joined = snapComponents(
        shaped.map((c, i) => ({
          ...c,
          x: c.x + shifts[i][0] * fine.unit,
          y: c.y - shifts[i][1] * fine.unit,
        })),
        geometry,
        lines,
        fine.unit * 1.5
      );
      // Start the ink at x = 0, as the template fonts do, with a tenth of the cap height after it
      const boxes = joined.map(geometry);
      const inkLeft = Math.min(...boxes.map((b) => b.xMin));
      const inkRight = Math.max(...boxes.map((b) => b.xMax));
      const components = joined.map((c) => ({
        ...c,
        x: Math.round(c.x - inkLeft),
        y: Math.round(c.y),
      }));
      const parts = components.map((c) => ({
        path: c.path,
        outline: c.outline,
        bounds: c.bounds,
        matrix: partMatrix(c),
      }));
      const raster = rasterize(ocrSpace, parts);
      const reading = read(raster);
      return {
        source,
        components,
        parts,
        raster,
        reading,
        margin: marginFor(character, reading),
        xAdvance: Math.round(inkRight - inkLeft + metrics.capHeight * 0.1),
      };
    };

    // 1. Molecules from the molecular fonts
    const molecules = [];
    for (const font of catalogue) {
      for (const molecule of font.molecules[character] || []) {
        const placed = retarget(
          molecule,
          font,
          metrics.capHeight / font.capHeight,
          samples,
          boundsAt
        );
        const result =
          placed &&
          (await finish(`${font.name} ${molecule.glyph}`, placed, {
            snap: false,
            enforce: false,
            wantedInk: referenceInk,
          }));
        // Isotopes this font lacks are swapped for its plain typtom, which can change
        // the shape a lot: keep the molecule only if it still reads as the character
        const recognised = result?.reading.slice(0, 5).some((r) => r.character === character);
        if (recognised) {
          molecules.push(result);
        }
      }
    }
    if (quick && molecules.length) {
      return molecules;
    }

    // 2. Rule-abiding search after each reference typeface
    const seen = new Set();
    const results = [];
    for (const [n, face] of faces.entries()) {
      await new Promise((resolve) => setTimeout(resolve, 0)); // keep the editor responsive
      if (isStale()) {
        return null;
      }
      this.readingElement.textContent = `Composing “${character}” after ${n + 1} of ${faces.length} typefaces…`;
      const reference = referencePart(space, face, character);
      if (!reference) {
        continue;
      }
      const target = rasterize(space, [reference]);
      const wantedInk = inkOf(face);
      for (const options of [{}, { outside: 1.6 }]) {
        const greedy = greedyCompose(target, space.cols, space.rows, variants, options);
        const placements = refineComposition(target, space.cols, space.rows, variants, greedy);
        const key = placements
          .map(({ variant, row, col }) => variants.indexOf(variant) + ":" + row + ":" + col)
          .sort()
          .join();
        if (!placements.length || seen.has(key)) {
          continue;
        }
        seen.add(key);
        const placed = placements.map((placement) => ({
          name: placement.variant.name,
          location: placement.variant.location,
          ...placementTransform(space, placement),
        }));
        const result = await finish(face.name, placed, { snap: true, enforce: true, wantedInk });
        if (result) {
          results.push(result);
        }
      }
    }

    // 3. Molecules first; then readable search results, each typeface's best take
    //    before any second one, skipping near-duplicates so each card is a new idea
    // A non-ASCII letter often differs from an ASCII one by a detail (Đ is D with a
    // bar), so for those it is enough to be among the three closest readings
    const depth = character.codePointAt(0) < 127 ? 1 : 3;
    const recognised = results.filter(({ reading }) =>
      reading.slice(0, depth).some((r) => r.character === character && r.score >= MIN_SCORE)
    );
    const readable = loose && !recognised.length ? results : recognised;
    const rank = ({ margin, components }) => margin - PARSIMONY * components.length;
    const sorted = readable.sort((a, b) => rank(b) - rank(a));
    const firsts = sorted.filter((r, i) => sorted.findIndex((s) => s.source === r.source) === i);
    const chosen = [];
    for (const result of [...molecules, ...firsts, ...sorted.filter((r) => !firsts.includes(r))]) {
      if (chosen.every((other) => similarity(other.raster, result.raster) < DISTINCT)) {
        chosen.push(result);
      }
      if (chosen.length === MAX_SUGGESTIONS) {
        break;
      }
    }
    return chosen;
  }

  // Suggestions for a glyph's text, cached per text and location. A single
  // character is composed by composeCharacter; several (a ligature such as "fi") are
  // the k-th suggestions of each character, set side by side.
  async composeText(text, ocrSpace, metrics, isStale) {
    const characters = [...text];
    if (characters.length === 1) {
      return this.composeCharacter(text, ocrSpace, metrics, isStale);
    }
    const key = JSON.stringify([text, this.sceneSettings.fontLocationSourceMapped]);
    if (this._compositionCache.has(key)) {
      return this._compositionCache.get(key);
    }
    const parts = [];
    for (const character of characters) {
      const suggestions = await this.composeCharacter(character, ocrSpace, metrics, isStale);
      if (!suggestions) {
        return null;
      }
      parts.push(suggestions);
    }
    const count = parts.some((p) => !p.length) ? 0 : Math.max(...parts.map((p) => p.length));
    const result = Array.from({ length: Math.min(count, MAX_SUGGESTIONS) }, (_, k) => {
      const chosen = parts.map((p) => p[k % p.length]);
      let offset = 0;
      const components = chosen.flatMap((suggestion) => {
        const moved = suggestion.components.map((c) => ({ ...c, x: c.x + offset }));
        offset += suggestion.xAdvance;
        return moved;
      });
      const weakest = chosen.reduce((a, b) => (b.reading[0].score < a.reading[0].score ? b : a));
      return finishComposition(components, chosen.map((s) => s.source).join(" + "), weakest.reading, ocrSpace, metrics);
    });
    this._compositionCache.set(key, result);
    return result;
  }

  // One character: composed directly when the reference typefaces draw it,
  // otherwise (an accented letter) from its base letter and its accents.
  async composeCharacter(character, ocrSpace, metrics, isStale) {
    const key = JSON.stringify([character, this.sceneSettings.fontLocationSourceMapped]);
    if (this._compositionCache.has(key)) {
      return this._compositionCache.get(key);
    }
    await loadReferenceFaces(character);
    const result = hasReference(character)
      ? await this.compose(character, ocrSpace, metrics, isStale, {
          loose: SPACING_ACCENTS.has(character),
        })
      : await this.composeAccented(character, ocrSpace, metrics, isStale);
    if (result) {
      this._compositionCache.set(key, result);
    }
    return result;
  }

  // An accented letter (À, ç, ő, ạ…): each of its base's suggestions with one of the
  // accent's suggestions above or below it, centred on the base's ink. The accent
  // floats apart from the base, like a dotom. Over i and j the dot is left out.
  async composeAccented(character, ocrSpace, metrics, isStale) {
    const [base, ...marks] = [...character.normalize("NFD")];
    if (!marks.length || marks.some((mark) => !ACCENTS[mark])) {
      return [];
    }
    let current = await this.composeCharacter(base, ocrSpace, metrics, isStale);
    for (const [m, mark] of marks.entries()) {
      const accent = ACCENTS[mark];
      const accents = current?.length
        ? await this.composeCharacter(accent.spacing, ocrSpace, metrics, isStale)
        : current;
      if (!accents?.length) {
        return accents;
      }
      const dotless = m === 0 && accent.above && (base === "i" || base === "j");
      current = current.map((suggestion, k) => {
        const mark = accents[k % accents.length];
        // The dot of i or j: a dotom lying wholly above the rest of the ink
        const stems = suggestion.components.filter((c) => baseTyptomName(c.name) !== "dotom");
        const stemTop = stems.length ? inkBox(stems).yMax : -Infinity;
        const baseComponents = dotless
          ? suggestion.components.filter(
              (c) => baseTyptomName(c.name) !== "dotom" || inkBox([c]).yMin < stemTop
            )
          : suggestion.components;
        const b = inkBox(baseComponents);
        const a = inkBox(mark.components);
        const dx = accent.right
          ? b.xMax - a.xMax
          : (b.xMin + b.xMax) / 2 - (a.xMin + a.xMax) / 2;
        const dy = accent.above
          ? b.yMax + metrics.capHeight * ACCENT_GAP - a.yMin
          : b.yMin - a.yMax;
        const components = [
          ...baseComponents,
          ...mark.components.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })),
        ];
        return finishComposition(
          components,
          `${suggestion.source} + ${mark.source}`,
          suggestion.reading,
          ocrSpace,
          metrics
        );
      });
    }
    return current;
  }

  async applyComposition(composition) {
    if (!composition) {
      return;
    }
    const positionedGlyph = this.sceneModel.getSelectedPositionedGlyph();
    const selectedGlyph = this.sceneSettings.selectedGlyph;

    if (positionedGlyph?.isUndefined) {
      await writeComponents(
        this.fontController,
        this.sceneController,
        positionedGlyph.glyphName,
        positionedGlyph.character,
        composition
      );
      this.sceneSettings.selectedGlyph = { ...selectedGlyph, isEditing: true };
      return;
    }
    const components = fontraComponents(composition);

    if (selectedGlyph && !selectedGlyph.isEditing) {
      this.sceneSettings.selectedGlyph = { ...selectedGlyph, isEditing: true };
    }
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        layerGlyph.components.splice(0, layerGlyph.components.length, ...components);
        layerGlyph.xAdvance = composition.xAdvance;
      }
      return "Compose from typtoms";
    });
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
