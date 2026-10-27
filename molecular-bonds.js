// Anchors, charges and bonds of typtoms, after the rules of molecular typography
// (see README, "The rules"):
//
// - Every typtom except the Dotom has anchors where it may bond: its ends, the
//   faces of Itom, Etom and Vtom, and the curve of a Jtom; Ctom and Ktom bond only at
//   their ends.
// - Each end carries its own charge. Where two ends meet (a direct bond) they must
//   be opposite; an end meeting a face or curve (flush, offset), and any overlap,
//   only needs both to be anchors.
// - Charges turn with the typtom: flipping or turning one reverses where its + is.
// - The Dotom has no anchors: it never bonds, but may sit against others as a joint.
//
// Anchors are Fontra anchors in the typtom glyphs, named "end+", "end-", "face" or
// "curve", so the designer can see and move them. A typtom without them gets default
// ones (defaultAnchors): the end facing up or left is +, the other -.

import { baseTyptomName } from "./molecular-formula.js";
import { endRegions } from "./molecular-composer.js";
import { rasterize } from "./molecular-ocr.js";

export const ANCHOR_NAME = /^(end|face|curve)([+-]?)$/;
// A cell's charge: an end's +1 or -1, BONDS where it bonds without charge (a face or
// curve), 0 where it may not bond
export const BONDS = 2;
const STROKES = new Set(["itom", "etom", "vtom"]);
const CURVES = new Set(["jtom"]);
const SEVEN = { d: "dotom", i: "itom", e: "etom", v: "vtom", j: "jtom", c: "ctom", k: "ktom" };

// Which of the seven typtoms a typtom glyph plays: its own base name, or for other
// typtoms (cctom, ditom, jatom…) the one their name starts with; failing that, a
// guess from the shape: a compact blob is a Dotom, a long straight stroke an Itom
// (upright) or Etom (lying), anything else a Ctom.
export function roleOf(name, outline, bounds) {
  const base = baseTyptomName(name) || name;
  if (Object.values(SEVEN).includes(base)) {
    return base;
  }
  if (SEVEN[base[0]]) {
    return SEVEN[base[0]];
  }
  const width = bounds.xMax - bounds.xMin;
  const height = bounds.yMax - bounds.yMin;
  const space = localSpace(bounds, 40);
  const filled = rasterize(space, [{ outline, matrix: [1, 0, 0, 1, 0, 0] }]).reduce((a, v) => a + v, 0);
  const fill = (filled * space.unit * space.unit) / Math.max(1, width * height);
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (fill > 0.6 && aspect < 1.6) {
    return "dotom";
  }
  if (fill > 0.75 && aspect >= 2.5) {
    return height > width ? "itom" : "etom";
  }
  return "ctom";
}

// Bond anchors of a list of Fontra anchors: [{ kind, sign, x, y }], sign 0 for faces
// and curves ("face+" and "face-" are read as "face").
export function bondAnchors(anchors) {
  const result = [];
  for (const { name, x, y } of anchors || []) {
    const match = name.match(ANCHOR_NAME);
    if (match) {
      const sign = match[1] === "end" ? (match[2] === "+" ? 1 : -1) : 0;
      result.push({ kind: match[1], sign, x, y });
    }
  }
  return result.filter((anchor) => anchor.kind !== "end" || anchor.sign);
}

export function anchorName({ kind, sign }) {
  return kind === "end" ? `end${sign > 0 ? "+" : "-"}` : kind;
}

// A grid over a box, for rasterize(): `cells` cells along its longer side.
function localSpace(bounds, cells) {
  const unit = Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin, 1) / cells;
  return {
    unit,
    left: bounds.xMin - 2 * unit,
    top: bounds.yMax + 2 * unit,
    cols: Math.ceil((bounds.xMax - bounds.xMin) / unit) + 4,
    rows: Math.ceil((bounds.yMax - bounds.yMin) / unit) + 4,
  };
}

// The tips of a curved typtom's skeleton, in font units, topmost first.
function tipsOf(outline, bounds) {
  const space = localSpace(bounds, 60);
  const raster = rasterize(space, [{ outline, matrix: [1, 0, 0, 1, 0, 0] }]);
  const cells = [];
  raster.forEach((value, i) => value > 0.5 && cells.push(i));
  return endRegions(cells, space.cols)
    .tips.map((i) => ({
      x: space.left + ((i % space.cols) + 0.5) * space.unit,
      y: space.top - (Math.floor(i / space.cols) + 0.5) * space.unit,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
}

// Default anchors of a typtom (base name such as "itom") in its own coordinates.
// `tall` says whether a stroke stands upright; pass the full-size typtom's, since a
// variable typtom shortened to nothing would otherwise be read as lying down.
export function defaultAnchors(base, outline, bounds, tall = undefined) {
  const { xMin, yMin, xMax, yMax } = bounds;
  const [cx, cy] = [(xMin + xMax) / 2, (yMin + yMax) / 2];
  if (base === "dotom") {
    return [];
  }
  if (base === "vtom") {
    // A diagonal: the end that leans right is -, the one that leans left is +
    // (so the two tops of an A, and the two feet of a V, attract)
    const band = 0.1 * (yMax - yMin);
    const xs = (near) =>
      outline.flatMap((contour) => contour.filter((v, k) => k % 2 === 0 && near(contour[k + 1])));
    const mean = (values) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const topX = mean(xs((y) => y >= yMax - band));
    const bottomX = mean(xs((y) => y <= yMin + band));
    const topSign = topX > bottomX ? -1 : 1;
    return [
      { kind: "end", sign: topSign, x: topX, y: yMax },
      { kind: "end", sign: -topSign, x: bottomX, y: yMin },
      { kind: "face", sign: 0, x: xMin, y: cy },
      { kind: "face", sign: 0, x: xMax, y: cy },
    ];
  }
  if (STROKES.has(base)) {
    return (tall ?? yMax - yMin >= xMax - xMin)
      ? [
          { kind: "end", sign: 1, x: cx, y: yMax },
          { kind: "end", sign: -1, x: cx, y: yMin },
          { kind: "face", sign: 0, x: xMin, y: cy },
          { kind: "face", sign: 0, x: xMax, y: cy },
        ]
      : [
          { kind: "end", sign: 1, x: xMin, y: cy },
          { kind: "end", sign: -1, x: xMax, y: cy },
          { kind: "face", sign: 0, x: cx, y: yMax },
          { kind: "face", sign: 0, x: cx, y: yMin },
        ];
  }
  if (CURVES.has(base)) {
    // Its ends (the top one +, the other -) and its curve
    return [
      ...tipsOf(outline, bounds).map(({ x, y }, k) => ({ kind: "end", sign: k ? -1 : 1, x, y })),
      { kind: "curve", sign: 0, x: cx, y: cy },
    ];
  }
  // Ctom, Ktom and any other typtom: its ends, the top one +, the others -
  return tipsOf(outline, bounds).map(({ x, y }, k) => ({ kind: "end", sign: k ? -1 : 1, x, y }));
}

export function transformAnchors(anchors, [a, b, c, d, e, f]) {
  return anchors.map((anchor) => ({
    ...anchor,
    x: a * anchor.x + c * anchor.y + e,
    y: b * anchor.x + d * anchor.y + f,
  }));
}

// The charges of a placed typtom on a grid (`space` as in rasterize): cells, its cell
// indices; anchors, its bond anchors in the same font units. Returns { charges, sides }:
// charges is an Int8Array parallel to cells (+1 or -1 on an end, BONDS on a face or
// curve, 0 where it may not bond); sides, for stroke typtoms only, what its two faces
// are by the direction they face ({ left, right } for an upright stroke), used where
// another piece touches a face from that direction, so an arm along the top of a
// stem's face meets the face and not the stem's end.
export function cellCharges(base, cells, space, anchors) {
  const charges = new Int8Array(cells.length);
  if (base === "dotom" || !cells.length) {
    return { charges };
  }
  const { cols, unit, left, top } = space;
  const toGrid = ({ x, y }) => [(x - left) / unit, (top - y) / unit];
  // The nearest anchor of a kind: its charge (BONDS for a face or curve), 0 if none
  const nearest = (kind, gx, gy) => {
    let best = null;
    for (const anchor of anchors) {
      if (anchor.kind === kind) {
        const [ax, ay] = toGrid(anchor);
        const distance = Math.hypot(ax - gx, ay - gy);
        if (!best || distance < best.distance) {
          best = { distance, charge: anchor.sign || BONDS };
        }
      }
    }
    return best?.charge ?? 0;
  };
  const rowOf = (i) => Math.floor(i / cols);
  const colOf = (i) => i % cols;

  if (STROKES.has(base)) {
    // Ends are the short sides, faces the long ones; stroke thickness from the area
    const rows = cells.map(rowOf);
    const columns = cells.map(colOf);
    const [rowMin, rowMax] = [Math.min(...rows), Math.max(...rows)];
    const [colMin, colMax] = [Math.min(...columns), Math.max(...columns)];
    const tall = rowMax - rowMin >= colMax - colMin;
    const length = (tall ? rowMax - rowMin : colMax - colMin) + 1;
    const thickness = Math.max(1, cells.length / length);
    // The stroke's centre line: the middle of its ink in each row (or column), so the
    // faces of a diagonal follow its slant
    const centre = new Map();
    cells.forEach((i) => {
      const [key, value] = tall ? [rowOf(i), colOf(i) + 0.5] : [colOf(i), rowOf(i) + 0.5];
      const [sum, count] = centre.get(key) || [0, 0];
      centre.set(key, [sum + value, count + 1]);
    });
    const centreOf = (key) => {
      const [sum, count] = centre.get(key);
      return sum / count;
    };
    const [midRow, midCol] = [(rowMin + rowMax + 1) / 2, (colMin + colMax + 1) / 2];
    // A face bonds when an anchor lies on its side of the centre line
    const faceSides = new Set(
      anchors
        .filter((anchor) => anchor.kind === "face")
        .map((anchor) => {
          const [gx, gy] = toGrid(anchor);
          const [along, across] = tall ? [gy, gx] : [gx, gy];
          const key = Math.min(
            Math.max(Math.floor(along), tall ? rowMin : colMin),
            tall ? rowMax : colMax
          );
          return across < (centre.has(key) ? centreOf(key) : tall ? midCol : midRow)
            ? "low"
            : "high";
        })
    );
    const [lowFace, highFace] = [faceSides.has("low") ? BONDS : 0, faceSides.has("high") ? BONDS : 0];
    const [startEnd, finishEnd] = tall
      ? [nearest("end", midCol, rowMin), nearest("end", midCol, rowMax + 1)]
      : [nearest("end", colMin, midRow), nearest("end", colMax + 1, midRow)];
    cells.forEach((i, k) => {
      const [row, col] = [rowOf(i), colOf(i)];
      const [position, across, key, start, finish] = tall
        ? [row, col + 0.5, row, rowMin, rowMax]
        : [col, row + 0.5, col, colMin, colMax];
      charges[k] =
        position - start < thickness
          ? startEnd
          : finish - position < thickness
            ? finishEnd
            : across < centreOf(key)
              ? lowFace
              : highFace;
    });
    const face = (charge) => new Int8Array(cells.length).fill(charge);
    return {
      charges,
      sides: tall
        ? { left: face(lowFace), right: face(highFace) }
        : { up: face(lowFace), down: face(highFace) },
    };
  }

  // Curved typtoms: their ends carry the charge of their end anchors; a Jtom also
  // bonds along its curve, a Ctom or Ktom nowhere else
  const { tips, tipOf } = endRegions(cells, cols);
  const tipCharges = tips.map((i) => nearest("end", colOf(i) + 0.5, rowOf(i) + 0.5));
  const curve = CURVES.has(base) && anchors.some((anchor) => anchor.kind === "curve") ? BONDS : 0;
  cells.forEach((i, k) => {
    const tip = tipOf.get(i);
    charges[k] = tip !== undefined ? tipCharges[tip] : curve;
  });
  return { charges };
}

