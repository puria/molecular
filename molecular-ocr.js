// Shared raster space, a canvas-free rasterizer, and a small template-matching OCR.
//
// Everything is computed in plain JavaScript from outlines: no canvas pixels are
// read back, because browsers that resist fingerprinting (LibreWolf, Firefox with
// resistFingerprinting) return random noise from getImageData.
//
// Shapes are rasterized onto a grid in font units, anchored to the baseline.
// Reading works like classic OCR: the ink is cropped and stretched to a fixed cell
// (so a condensed E still looks like an E), blurred, and correlated with every
// printable ASCII character in the reference faces (Liberation Sans, Serif and Mono,
// regular and bold). Where the ink sits relative to baseline and cap height is
// scored separately, so "." differs from "-" and "o" from "O".

const SHAPE = 24; // feature cell, in samples per side
const MAX_STRETCH = 4; // limit on how much one axis may be stretched more than the other
const POSITION_WEIGHT = 1; // penalty per cap height of top/bottom mismatch
const SUBSCANLINES = 4; // vertical anti-aliasing samples per raster row
const CURVE_STEPS = 8; // line segments per curve
export const OCR_CELLS_PER_CAP = 30;

// The reference outlines are large, so they load on first use: printable ASCII
// first, the other characters only once a non-ASCII glyph is composed.
let reference;
let extended = false;

export async function loadReferenceFaces(character = "A") {
  reference ??= await import("./molecular-reference.js");
  if (character.codePointAt(0) >= 127 && !extended) {
    const { REFERENCE_FACES } = await import("./molecular-reference-extended.js");
    REFERENCE_FACES.forEach((face, i) => Object.assign(reference.REFERENCE_FACES[i].glyphs, face.glyphs));
    extended = true;
  }
  return reference.REFERENCE_FACES;
}

// Whether any reference face draws this character.
export function hasReference(character) {
  return reference.REFERENCE_FACES.some((face) => face.glyphs[character]);
}

// metrics: { capHeight, ascender, descender } in font units; cellsPerCap sets resolution.
export function makeSpace({ capHeight, ascender, descender }, cellsPerCap) {
  const unit = capHeight / cellsPerCap;
  const top = Math.max(ascender, capHeight) + 2 * unit;
  const bottom = Math.min(descender, -0.25 * capHeight) - 2 * unit;
  const rows = Math.ceil((top - bottom) / unit);
  const cols = Math.ceil((1.6 * capHeight) / unit);
  return { unit, rows, cols, top, left: (-cols / 2) * unit, capHeight };
}

// Collects a path as polygons: [[x0, y0, x1, y1, …], …]. Has the Path2D drawing
// methods, so Fontra's path.drawToPath2d(pen) can draw into it.
class OutlinePen {
  contours = [];

  moveTo(x, y) {
    this.contours.push([x, y]);
    [this.x, this.y] = [x, y];
  }

  lineTo(x, y) {
    this.contours.at(-1).push(x, y);
    [this.x, this.y] = [x, y];
  }

  quadraticCurveTo(cx, cy, x, y) {
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS;
      const u = 1 - t;
      this.contours.at(-1).push(
        u * u * this.x + 2 * u * t * cx + t * t * x,
        u * u * this.y + 2 * u * t * cy + t * t * y
      );
    }
    [this.x, this.y] = [x, y];
  }

  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS;
      const u = 1 - t;
      this.contours.at(-1).push(
        u * u * u * this.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        u * u * u * this.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y
      );
    }
    [this.x, this.y] = [x, y];
  }

  closePath() {}
}

// Outline of a Fontra path (anything with drawToPath2d).
export function outlineOfPath(path) {
  const pen = new OutlinePen();
  path.drawToPath2d(pen);
  return pen.contours;
}

// Outline of SVG path data with absolute M L H V Q C Z commands (as fontTools writes them).
export function outlineOfPathData(data) {
  const pen = new OutlinePen();
  const tokens = data.match(/[MLHVQCZ]|-?\d+(?:\.\d+)?/g);
  let command;
  for (let i = 0; i < tokens.length; ) {
    if (/[A-Z]/.test(tokens[i])) {
      command = tokens[i++];
      if (command === "Z") {
        continue;
      }
    }
    const take = (n) => tokens.slice(i, (i += n)).map(Number);
    switch (command) {
      case "M":
        pen.moveTo(...take(2));
        command = "L"; // further pairs after M are lines
        break;
      case "L":
        pen.lineTo(...take(2));
        break;
      case "H":
        pen.lineTo(take(1)[0], pen.y);
        break;
      case "V":
        pen.lineTo(pen.x, take(1)[0]);
        break;
      case "Q":
        pen.quadraticCurveTo(...take(4));
        break;
      case "C":
        pen.bezierCurveTo(...take(6));
        break;
    }
  }
  return pen.contours;
}

// Product m · n of two affine matrices [xx, xy, yx, yy, dx, dy] (n applied first).
function multiply(m, n) {
  return [
    n[0] * m[0] + n[1] * m[2],
    n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2],
    n[2] * m[1] + n[3] * m[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Matrix of a Fontra decomposed transformation (as decomposedToTransform builds it),
// with the translation in x and y.
export function partMatrix({
  rotation = 0,
  scaleX = 1,
  scaleY = 1,
  skewX = 0,
  skewY = 0,
  tCenterX = 0,
  tCenterY = 0,
  x = 0,
  y = 0,
}) {
  const angle = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return [
    [1, 0, 0, 1, x + tCenterX, y + tCenterY],
    [cos, sin, -sin, cos, 0, 0],
    [scaleX, 0, 0, scaleY, 0, 0],
    [1, Math.tan((skewY * Math.PI) / 180), Math.tan((skewX * Math.PI) / 180), 1, 0, 0],
    [1, 0, 0, 1, -tCenterX, -tCenterY],
  ].reduce(multiply);
}

export function transformedBounds(bounds, [a, b, c, d, e, f]) {
  const xs = [];
  const ys = [];
  for (const x of [bounds.xMin, bounds.xMax]) {
    for (const y of [bounds.yMin, bounds.yMax]) {
      xs.push(a * x + c * y + e);
      ys.push(b * x + d * y + f);
    }
  }
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
}

// Spans [x0, x1] inside one part (nonzero winding) along a horizontal line, from
// the part's edges [x0, y0, x1, y1] that cross it.
function partSpans(edges, y, spans) {
  const crossings = [];
  for (const [x0, y0, x1, y1] of edges) {
    if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
      crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
    }
  }
  crossings.sort((a, b) => a[0] - b[0]);
  let [winding, start] = [0, 0];
  for (const [x, direction] of crossings) {
    const before = winding;
    winding += direction;
    if (before === 0 && winding !== 0) {
      start = x;
    } else if (before !== 0 && winding === 0) {
      spans.push([start, x]);
    }
  }
}

// Coverage 0…1 per cell, rows top to bottom. parts: [{ outline, matrix }] in font
// units, y up. Overlapping parts unite, whatever their direction.
export function rasterize(space, parts) {
  const { unit, cols, rows, left, top } = space;
  const coverage = new Float32Array(cols * rows);
  // Each part's edges, in cells, filed under every row they cross
  const toCells = (a, b, c, d, e, f, x, y) => [
    (a * x + c * y + e - left) / unit,
    (top - (b * x + d * y + f)) / unit,
  ];
  const shapes = parts.map(({ outline, matrix }) => {
    const byRow = Array.from({ length: rows }, () => []);
    for (const contour of outline) {
      const n = contour.length;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const [x0, y0] = toCells(...matrix, contour[i], contour[i + 1]);
        const [x1, y1] = toCells(...matrix, contour[j], contour[j + 1]);
        const first = Math.max(0, Math.floor(Math.min(y0, y1)));
        const last = Math.min(rows - 1, Math.floor(Math.max(y0, y1)));
        for (let row = first; row <= last; row++) {
          byRow[row].push([x0, y0, x1, y1]);
        }
      }
    }
    return byRow;
  });

  for (let row = 0; row < rows; row++) {
    for (let sub = 0; sub < SUBSCANLINES; sub++) {
      const y = row + (sub + 0.5) / SUBSCANLINES;
      const spans = [];
      for (const byRow of shapes) {
        if (byRow[row].length) {
          partSpans(byRow[row], y, spans);
        }
      }
      spans.sort((p, q) => p[0] - q[0]);
      let [start, end] = [null, null];
      const fill = () => {
        const [x0, x1] = [Math.max(0, start), Math.min(cols, end)];
        for (let col = Math.floor(x0); col < x1; col++) {
          const overlap = Math.min(x1, col + 1) - Math.max(x0, col);
          coverage[row * cols + col] += overlap / SUBSCANLINES;
        }
      };
      for (const [x0, x1] of spans) {
        if (start !== null && x0 <= end) {
          end = Math.max(end, x1);
        } else {
          if (start !== null) {
            fill();
          }
          [start, end] = [x0, x1];
        }
      }
      if (start !== null) {
        fill();
      }
    }
  }
  return coverage;
}

const referenceOutlines = new Map();

// A reference face's character with its ink centred on x = 0, scaled so the face's
// cap height matches the space's. Returns a part for rasterize(), or null.
export function referencePart(space, face, character) {
  const glyph = face.glyphs[character];
  if (!glyph) {
    return null;
  }
  const key = face.name + character;
  if (!referenceOutlines.has(key)) {
    referenceOutlines.set(key, outlineOfPathData(glyph[0]));
  }
  const scale = space.capHeight / reference.REFERENCE_CAP_HEIGHT;
  const [, xMin, , xMax] = glyph;
  return {
    outline: referenceOutlines.get(key),
    matrix: [scale, 0, 0, scale, (-scale * (xMin + xMax)) / 2, 0],
  };
}

function blur(values) {
  const out = new Float32Array(values.length);
  for (let y = 0; y < SHAPE; y++) {
    for (let x = 0; x < SHAPE; x++) {
      let [sum, count] = [0, 0];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [xx, yy] = [x + dx, y + dy];
          if (xx >= 0 && xx < SHAPE && yy >= 0 && yy < SHAPE) {
            sum += values[yy * SHAPE + xx];
            count++;
          }
        }
      }
      out[y * SHAPE + x] = sum / count;
    }
  }
  return out;
}

// Bilinear sample at continuous raster coordinates (cell centres at i + 0.5).
function sample(raster, cols, rows, x, y) {
  const [fx, fy] = [x - 0.5, y - 0.5];
  const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
  const [tx, ty] = [fx - x0, fy - y0];
  const at = (col, row) =>
    col >= 0 && col < cols && row >= 0 && row < rows ? raster[row * cols + col] : 0;
  return (
    (1 - ty) * ((1 - tx) * at(x0, y0) + tx * at(x0 + 1, y0)) +
    ty * ((1 - tx) * at(x0, y0 + 1) + tx * at(x0 + 1, y0 + 1))
  );
}

// { vector, top, bottom } for a raster of `space`, or null when it is empty.
function features(space, raster) {
  const { cols, rows, unit, top, capHeight } = space;
  let [xMin, xMax, yMin, yMax] = [cols, -1, rows, -1];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (raster[row * cols + col] > 0.25) {
        xMin = Math.min(xMin, col);
        xMax = Math.max(xMax, col);
        yMin = Math.min(yMin, row);
        yMax = Math.max(yMax, row);
      }
    }
  }
  if (xMax < 0) {
    return null;
  }
  const [width, height] = [xMax - xMin + 1, yMax - yMin + 1];
  let [scaleX, scaleY] = [SHAPE / width, SHAPE / height];
  scaleX = Math.min(scaleX, scaleY * MAX_STRETCH);
  scaleY = Math.min(scaleY, scaleX * MAX_STRETCH);
  const originX = (xMin + xMax + 1) / 2 - SHAPE / scaleX / 2;
  const originY = (yMin + yMax + 1) / 2 - SHAPE / scaleY / 2;

  // Each feature sample averages a 3×3 grid over its footprint in the raster
  let values = new Float32Array(SHAPE * SHAPE);
  for (let y = 0; y < SHAPE; y++) {
    for (let x = 0; x < SHAPE; x++) {
      let sum = 0;
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          sum += sample(
            raster,
            cols,
            rows,
            originX + (x + (i + 0.5) / 3) / scaleX,
            originY + (y + (j + 0.5) / 3) / scaleY
          );
        }
      }
      values[y * SHAPE + x] = sum / 9;
    }
  }
  values = blur(values);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  let norm = 0;
  for (let i = 0; i < values.length; i++) {
    values[i] -= mean;
    norm += values[i] * values[i];
  }
  norm = Math.sqrt(norm) || 1;
  return {
    vector: values.map((v) => v / norm),
    top: (top - yMin * unit) / capHeight,
    bottom: (top - (yMax + 1) * unit) / capHeight,
  };
}

function similarity(a, b) {
  let correlation = 0;
  for (let i = 0; i < a.vector.length; i++) {
    correlation += a.vector[i] * b.vector[i];
  }
  return (
    correlation -
    POSITION_WEIGHT * (Math.abs(a.top - b.top) + Math.abs(a.bottom - b.bottom))
  );
}

const templateCache = new Map();

function templatesFor(space, character) {
  const key = JSON.stringify(space) + character;
  if (!templateCache.has(key)) {
    const templates = [];
    for (const face of reference.REFERENCE_FACES) {
      if (face.glyphs[character]) {
        const shape = features(space, rasterize(space, [referencePart(space, face, character)]));
        if (shape) {
          templates.push({ character, features: shape });
        }
      }
    }
    templateCache.set(key, templates);
  }
  return templateCache.get(key);
}

const ASCII = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));

// Returns a function reading a raster of `space`: characters best first,
// [{ character, score }]; 1 is a perfect match. It compares with printable ASCII
// and with `target` when that is another character, so lookalikes such as "º" or
// "ı" never stand in for "o" or "i". Needs loadReferenceFaces(target) first.
export function makeReader(space, target = "") {
  const characters = [...ASCII, ...(target && !ASCII.includes(target) ? [target] : [])];
  const templates = characters.flatMap((character) => templatesFor(space, character));
  return (raster) => {
    const shape = features(space, raster);
    if (!shape) {
      return [];
    }
    const best = new Map();
    for (const { character, features: template } of templates) {
      const score = similarity(shape, template);
      if (score > (best.get(character) ?? -Infinity)) {
        best.set(character, score);
      }
    }
    return [...best]
      .map(([character, score]) => ({ character, score }))
      .sort((a, b) => b.score - a.score);
  };
}

// Draws parts ({ path: Path2D, bounds, matrix }) fitted into a size×size canvas box.
export function drawParts(ctx, parts, size, padding) {
  const boxes = parts.map(({ bounds, matrix }) => transformedBounds(bounds, matrix));
  const xMin = Math.min(...boxes.map((b) => b.xMin));
  const yMin = Math.min(...boxes.map((b) => b.yMin));
  const xMax = Math.max(...boxes.map((b) => b.xMax));
  const yMax = Math.max(...boxes.map((b) => b.yMax));
  const scale = (size - 2 * padding) / Math.max(xMax - xMin, yMax - yMin, 1);
  const offsetX = (size - (xMax - xMin) * scale) / 2 - xMin * scale;
  const offsetY = (size + (yMax - yMin) * scale) / 2 + yMin * scale;
  for (const { path, matrix } of parts) {
    const [a, b, c, d, e, f] = matrix;
    ctx.setTransform(
      a * scale,
      -b * scale,
      c * scale,
      -d * scale,
      offsetX + e * scale,
      offsetY - f * scale
    );
    ctx.fill(path);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
