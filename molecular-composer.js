// Composes a character out of typtoms: the reference letter is rasterized onto the
// shared grid, then typtoms (every variant, length and orientation the font offers)
// are placed one at a time where they cover the most uncovered ink and the least
// background, until no placement pays for itself.

import { partMatrix, rasterize, transformedBounds } from "./molecular-ocr.js";

// Turn rotations and mirroring; Fontra stores them as rotation + scaleX/scaleY.
const ORIENTATIONS = [0, 90, 180, -90].flatMap((rotation) => [
  { rotation, scaleX: 1 },
  { rotation, scaleX: -1 },
]);

// typtoms: [{ name, location, path, outline, bounds }], one per sampled axis value.
// allowed(typtom, orientation): whether that typtom may be turned that way.
// Unrotated variants come first so they win ties against rotated look-alikes.
export function makeVariants(space, typtoms, allowed = () => true) {
  const seen = new Set();
  const variants = [];
  for (const orientation of ORIENTATIONS) {
    for (const typtom of typtoms) {
      if (!allowed(typtom, orientation)) {
        continue;
      }
      const matrix = partMatrix(orientation);
      const box = transformedBounds(typtom.bounds, matrix);
      const width = Math.ceil((box.xMax - box.xMin) / space.unit) + 1;
      const height = Math.ceil((box.yMax - box.yMin) / space.unit) + 1;
      const local = {
        unit: space.unit,
        cols: width,
        rows: height,
        left: box.xMin,
        top: box.yMin + height * space.unit,
      };
      const raster = rasterize(local, [{ outline: typtom.outline, matrix }]);
      const cells = [];
      raster.forEach((value, i) => value > 0.5 && cells.push([Math.floor(i / width), i % width]));
      const key = `${width}x${height}:${cells.join(";")}`;
      if (!cells.length || seen.has(key)) {
        continue;
      }
      seen.add(key);
      variants.push({ ...typtom, ...orientation, box, width, height, cells });
    }
  }
  return variants;
}

// Pure greedy placement on a cols×rows grid (row 0 at the top).
// target: coverage 0…1; variants: [{ width, height, cells: [[row, col]] }].
// Returns [{ variant, row, col }].
export function greedyCompose(target, cols, rows, variants, options = {}) {
  const { outside = 1, overlap = 0.6, accept = 0.35, maxAtoms = 10 } = options;
  const covered = new Uint8Array(target.length);
  const weight = new Float32Array(target.length);
  const offsets = variants.map((v) => Int32Array.from(v.cells, ([r, c]) => r * cols + c));

  let [inkTop, inkBottom, inkLeft, inkRight] = [rows, -1, cols, -1];
  target.forEach((value, i) => {
    if (value > 0.5) {
      const [row, col] = [Math.floor(i / cols), i % cols];
      inkTop = Math.min(inkTop, row);
      inkBottom = Math.max(inkBottom, row);
      inkLeft = Math.min(inkLeft, col);
      inkRight = Math.max(inkRight, col);
    }
  });
  if (inkBottom < 0) {
    return [];
  }

  const placements = [];
  while (placements.length < maxAtoms) {
    for (let i = 0; i < target.length; i++) {
      weight[i] = target[i] * (1 - covered[i]) - outside * (1 - target[i]) - overlap * covered[i];
    }
    let best = null;
    variants.forEach((variant, v) => {
      const cells = offsets[v];
      // Only positions where the variant can touch the reference ink
      const rowStart = Math.max(0, inkTop - variant.height + 1);
      const rowEnd = Math.min(rows - variant.height, inkBottom);
      const colStart = Math.max(0, inkLeft - variant.width + 1);
      const colEnd = Math.min(cols - variant.width, inkRight);
      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const base = row * cols + col;
          let gain = 0;
          for (let k = 0; k < cells.length; k++) {
            gain += weight[base + cells[k]];
          }
          const score = gain / cells.length;
          if (gain > 0 && score >= accept && (!best || gain > best.gain)) {
            best = { gain, variant, v, row, col };
          }
        }
      }
    });
    if (!best) {
      break;
    }
    for (const offset of offsets[best.v]) {
      covered[best.row * cols + best.col + offset] = 1;
    }
    placements.push({ variant: best.variant, row: best.row, col: best.col });
  }
  return placements;
}

// Number of 4-connected ink regions, and of enclosed white regions (holes).
export function topology(mask, cols, rows) {
  const label = new Int32Array(mask.length);
  const stack = [];
  const flood = (start, value, id) => {
    let touchesBorder = false;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const [row, col] = [Math.floor(i / cols), i % cols];
      if (row === 0 || col === 0 || row === rows - 1 || col === cols - 1) {
        touchesBorder = true;
      }
      for (const j of [i - cols, i + cols, col > 0 ? i - 1 : -1, col < cols - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < mask.length && !label[j] && mask[j] === value) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    return touchesBorder;
  };
  let [ink, holes, id] = [0, 0, 0];
  for (let i = 0; i < mask.length; i++) {
    if (!label[i]) {
      const touchesBorder = flood(i, mask[i], ++id);
      if (mask[i]) {
        ink++;
      } else if (!touchesBorder) {
        holes++;
      }
    }
  }
  return { ink, holes };
}

// Improves a greedy result by moving, resizing or dropping typtoms, scoring coverage
// plus topology: every ink region or hole the reference letter doesn't have costs
// as much as `join` cells of ink, so pieces are pulled together until they touch.
export function refineComposition(target, cols, rows, variants, placements, options = {}) {
  const { outside = 1, overlap = 0.1, join = 12, piece = 2, rounds = 8 } = options;
  const index = new Map(variants.map((variant, v) => [variant, v]));
  const offsets = variants.map((v) => Int32Array.from(v.cells, ([r, c]) => r * cols + c));
  // Same typtom and orientation, different length: the variants a piece may swap to
  const families = new Map();
  variants.forEach((variant, v) => {
    const key = `${variant.name}|${variant.rotation}|${variant.scaleX}`;
    families.set(key, [...(families.get(key) || []), v]);
  });
  for (const family of families.values()) {
    family.sort((a, b) => variants[a].cells.length - variants[b].cells.length);
  }
  const familyOf = (v) =>
    families.get(`${variants[v].name}|${variants[v].rotation}|${variants[v].scaleX}`);

  const targetMask = Uint8Array.from(target, (t) => (t > 0.5 ? 1 : 0));
  const wanted = topology(targetMask, cols, rows);
  const count = new Uint8Array(target.length);
  const mask = new Uint8Array(target.length);

  const fits = ({ v, row, col }) =>
    row >= 0 && col >= 0 && row + variants[v].height <= rows && col + variants[v].width <= cols;

  const score = (state) => {
    count.fill(0);
    for (const { v, row, col } of state) {
      const base = row * cols + col;
      for (const offset of offsets[v]) {
        count[base + offset]++;
      }
    }
    let total = 0;
    for (let i = 0; i < count.length; i++) {
      mask[i] = count[i] ? 1 : 0;
      if (count[i]) {
        total += target[i] - outside * (1 - target[i]) - overlap * (count[i] - 1);
      }
    }
    const { ink, holes } = topology(mask, cols, rows);
    return (
      total -
      join * (Math.max(0, ink - wanted.ink) + Math.max(0, holes - wanted.holes)) -
      piece * state.length
    );
  };

  let state = placements.map(({ variant, row, col }) => ({ v: index.get(variant), row, col }));
  let best = score(state);
  for (let round = 0; round < rounds; round++) {
    let improved = null;
    const consider = (candidate) => {
      if (candidate.every(fits)) {
        const value = score(candidate);
        if (value > best + 1e-6 && (!improved || value > improved.value)) {
          improved = { value, candidate };
        }
      }
    };
    state.forEach((placement, i) => {
      const replace = (next) => state.map((p, j) => (j === i ? next : p));
      consider(state.filter((_, j) => j !== i));
      // Nudges of one cell; joinPieces closes larger gaps later, on the real outlines
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) {
            consider(replace({ ...placement, row: placement.row + dy, col: placement.col + dx }));
          }
        }
      }
      // The next shorter or longer piece of the same typtom and orientation
      const family = familyOf(placement.v);
      const at = family.indexOf(placement.v);
      for (const v of [family[at - 1], family[at + 1]]) {
        if (v === undefined) {
          continue;
        }
        // Keep whichever end of the piece is closer to where it was
        const dw = variants[v].width - variants[placement.v].width;
        const dh = variants[v].height - variants[placement.v].height;
        for (const [dy, dx] of [
          [0, 0],
          [-dh, 0],
          [0, -dw],
          [-dh, -dw],
        ]) {
          consider(replace({ v, row: placement.row + dy, col: placement.col + dx }));
        }
      }
    });
    if (!improved) {
      break;
    }
    state = improved.candidate;
    best = improved.value;
  }
  return state.map(({ v, row, col }) => ({ variant: variants[v], row, col }));
}

// Snaps pieces so their edges meet exactly, in font units: each piece moves (and a
// variable typtom also stretches) by up to `tolerance` so that its edges land on
// other pieces' edges or on the vertical metrics in `lines`. The grid search places
// pieces only to the nearest grid cell, which otherwise leaves hairline gaps.
// components: [{ name, location, rotation, scaleX, x, y }];
// geometry(component) -> its box; stretch(component, edge, to) -> resized component or null.
export function snapComponents(components, geometry, lines, tolerance, stretch = () => null) {
  const result = components.map((c) => ({ ...c }));
  // Pieces snap in order of size, each only to the metrics and to pieces already
  // placed, so the big strokes stay put and the small ones join them
  const area = (c) => {
    const box = geometry(c);
    return (box.xMax - box.xMin) * (box.yMax - box.yMin);
  };
  const order = result.map((_, i) => i).sort((i, j) => area(result[j]) - area(result[i]));
  const edgesOf = (placed) => {
    const xs = [];
    const ys = [...lines];
    for (const j of placed) {
      const box = geometry(result[j]);
      xs.push(box.xMin, box.xMax);
      ys.push(box.yMin, box.yMax);
    }
    return { xs, ys };
  };
  const nearest = (values, candidates) => {
    let best = null;
    for (const value of values) {
      for (const candidate of candidates) {
        const delta = candidate - value;
        if (Math.abs(delta) <= tolerance && (best === null || Math.abs(delta) < Math.abs(best))) {
          best = delta;
        }
      }
    }
    return best ?? 0;
  };
  const matched = (c, { xs, ys }) => {
    const box = geometry(c);
    const on = (value, candidates) => candidates.some((e) => Math.abs(e - value) < 0.5);
    return (
      on(box.xMin, xs) + on(box.xMax, xs) + on(box.yMin, ys) + on(box.yMax, ys)
    );
  };
  const shift = (c, edges) => {
    const box = geometry(c);
    return {
      ...c,
      x: c.x + nearest([box.xMin, box.xMax], edges.xs),
      y: c.y + nearest([box.yMin, box.yMax], edges.ys),
    };
  };

  order.forEach((i, k) => {
    const edges = edgesOf(order.slice(0, k));
    let c = shift(result[i], edges);
    // Then try stretching each edge onto a nearby edge, keeping it if more edges meet
    for (const edge of ["xMin", "xMax", "yMin", "yMax"]) {
      const box = geometry(c);
      const delta = nearest([box[edge]], edge[0] === "x" ? edges.xs : edges.ys);
      if (!delta) {
        continue;
      }
      const stretched = stretch(c, edge, box[edge] + delta);
      if (stretched) {
        const moved = shift(stretched, edges);
        if (matched(moved, edges) > matched(c, edges)) {
          c = moved;
        }
      }
    }
    result[i] = c;
  });
  return result.map((c) => ({ ...c, x: Math.round(c.x), y: Math.round(c.y) }));
}

// Bonding rules of molecular typography, on a fine grid where the actual outlines
// are compared. pieces: [{ cells, charges, sides, floating }] on a cols×rows grid:
// cells are cell indices; charges the charge of each cell (+1 or -1 on an end, 2 on
// a face or curve, 0 where the piece may not bond, such as the middle of a Ctom; see
// molecular-bonds.js); floating marks a Dotom, which never bonds: held by attraction
// only, it may sit against other typtoms as a joint without that counting as a bond.
// Two pieces bond where they touch at anchors of both. Where two ends meet edge to
// edge (a direct bond) their charges must be opposite; an end on a face or curve
// (flush, offset) and any overlap need no charge. Any other touch is a violation.

// Each piece's cells moved by its shift, as [cell, k] with k the index into its
// cells (and charges).
function layout(pieces, shifts, cols, rows) {
  return pieces.map(({ cells }, p) => {
    const [dx, dy] = shifts[p];
    const out = [];
    cells.forEach((i, k) => {
      const [row, col] = [Math.floor(i / cols) + dy, (i % cols) + dx];
      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        out.push([row * cols + col, k]);
      }
    });
    return out;
  });
}

// Pairs of pieces that overlap somewhere (share a cell): "p|q" with p < q. Such a
// pair is bonded by overlap, so its contacts ignore the sign of the charges (but
// still happen only where both may bond).
function overlappingPairs(placed, cols, rows) {
  const seen = new Uint32Array(cols * rows);
  const pairs = new Set();
  placed.forEach((cells, p) => {
    const bit = 2 ** Math.min(p, 31);
    for (const [i] of cells) {
      for (let q = 0; q < p && q < 32; q++) {
        if (seen[i] & (2 ** q)) {
          pairs.add(`${q}|${p}`);
        }
      }
      seen[i] |= bit;
    }
  });
  return pairs;
}

// Contacts between piece p's cells and everything already written to the grid
// (owner: piece per cell, slot: that piece's cell index k): onContact(q, valid, cell)
// for every touching cell pair. A stroke piece touched on a face uses the charge of
// that face at that cell (`sides`, per direction and cell), so an arm lying along
// the top of a stem's face meets the face, not the stem's end.
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
function contactsOf(p, cells, owner, slot, pieces, cols, overlapping, onContact) {
  for (const [i, k] of cells) {
    const col = i % cols;
    for (const [j, dir] of [
      [i, null],
      [i - cols, "up"],
      [i + cols, "down"],
      [col > 0 ? i - 1 : -1, "left"],
      [col < cols - 1 ? i + 1 : -1, "right"],
    ]) {
      const q = j >= 0 && j < owner.length ? owner[j] : -1;
      if (q >= 0 && q !== p) {
        if (pieces[p].floating || pieces[q].floating) {
          continue; // a Dotom touching is attraction, not a bond
        }
        const mine = pieces[p].sides?.[dir]?.[k] ?? pieces[p].charges[k];
        const theirs =
          pieces[q].sides?.[OPPOSITE[dir]]?.[slot[j]] ?? pieces[q].charges[slot[j]];
        // Two ends meeting (a direct bond) must be opposite; an end meeting a face or
        // curve, or any overlap, only needs both to be anchors
        const direct = Math.abs(mine) === 1 && Math.abs(theirs) === 1;
        const overlap = overlapping.has(`${Math.min(p, q)}|${Math.max(p, q)}`);
        onContact(q, mine !== 0 && theirs !== 0 && (overlap || !direct || mine === -theirs), i);
      }
    }
  }
}

// Regions joined by bonds, the number of contacts breaking the rules, and every
// bond between two pieces: { p, q, valid, cells } (valid when no contact between
// them breaks a rule; cells are the touching cells of p).
export function analyseBonds(pieces, shifts, cols, rows) {
  const placed = layout(pieces, shifts, cols, rows);
  const overlapping = overlappingPairs(placed, cols, rows);
  const owner = new Int32Array(cols * rows).fill(-1);
  const slot = new Int32Array(cols * rows);
  const parent = pieces.map((_, p) => p);
  const find = (p) => (parent[p] === p ? p : (parent[p] = find(parent[p])));
  const bonds = new Map();
  let violations = 0;
  placed.forEach((cells, p) => {
    contactsOf(p, cells, owner, slot, pieces, cols, overlapping, (q, valid, cell) => {
      const key = `${q}|${p}`;
      if (!bonds.has(key)) {
        bonds.set(key, { p, q, valid: true, cells: [] });
      }
      const bond = bonds.get(key);
      bond.valid &&= valid;
      bond.cells.push(cell);
      if (!valid) {
        violations++;
      } else {
        parent[find(q)] = find(p);
      }
    });
    for (const [i, k] of cells) {
      owner[i] = p;
      slot[i] = k;
    }
  });
  const regions = new Map();
  placed.forEach((cells, p) => {
    if (cells.length) {
      regions.set(find(p), [...(regions.get(find(p)) || []), p]);
    }
  });
  return { regions: [...regions.values()], violations, bonds: [...bonds.values()] };
}

// Moves pieces the least distance needed so that the ink becomes at most `wantedInk`
// regions (one for most letters, two for "i") without breaking a bonding rule:
// repeatedly, the
// smallest region slides (at most `maxShift` cells) until it first touches another
// one at both regions' anchors, which leaves it flush rather than sunk in. Returns
// one [dx, dy] shift in cells per piece; snapComponents then makes the edges meet
// exactly in font units.
export function joinPieces(pieces, cols, rows, wantedInk, maxShift) {
  const shifts = pieces.map(() => [0, 0]);
  const window = [];
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      window.push([dx, dy]);
    }
  }
  window.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));

  // Contacts of the `moving` pieces with the rest, at a trial shift
  const trial = (moving, [dx, dy]) => {
    const trialShifts = shifts.map((s, p) => (moving.includes(p) ? [s[0] + dx, s[1] + dy] : s));
    const placed = layout(pieces, trialShifts, cols, rows);
    const overlapping = overlappingPairs(placed, cols, rows);
    const owner = new Int32Array(cols * rows).fill(-1);
    const slot = new Int32Array(cols * rows);
    placed.forEach((cells, p) => {
      if (!moving.includes(p)) {
        for (const [i, k] of cells) {
          owner[i] = p;
          slot[i] = k;
        }
      }
    });
    let [touching, invalid] = [0, 0];
    for (const p of moving) {
      contactsOf(p, placed[p], owner, slot, pieces, cols, overlapping, (q, valid) => {
        touching++;
        invalid += !valid;
      });
    }
    return { touching, invalid };
  };
  const move = (members, [dx, dy]) => {
    for (const p of members) {
      shifts[p] = [shifts[p][0] + dx, shifts[p][1] + dy];
    }
  };

  for (let step = 0; step < pieces.length; step++) {
    const { regions } = analyseBonds(pieces, shifts, cols, rows);
    if (regions.length <= wantedInk) {
      break;
    }
    const size = (members) => members.reduce((n, p) => n + pieces[p].cells.length, 0);
    const smallest = regions
      .filter((members) => !members.every((p) => pieces[p].floating))
      .sort((a, b) => size(a) - size(b))[0];
    const hit =
      smallest &&
      window.find((shift) => {
        const { touching, invalid } = trial(smallest, shift);
        return touching && !invalid;
      });
    if (!hit) {
      break;
    }
    move(smallest, hit);
  }
  return shifts;
}

// The ends of a stroke-like piece (Ctom, Ktom, Jtom): the tips of its skeleton, and
// the cells within one stroke width of each tip. Returns { tips, tipOf }: tips are
// cell indices, tipOf maps each end cell to the index of its tip.
export function endRegions(cells, cols) {
  if (!cells.length) {
    return { tips: [], tipOf: new Map() };
  }
  const rowsOf = cells.map((i) => Math.floor(i / cols));
  const colsOf = cells.map((i) => i % cols);
  const [top, left] = [Math.min(...rowsOf) - 1, Math.min(...colsOf) - 1];
  const [height, width] = [Math.max(...rowsOf) - top + 2, Math.max(...colsOf) - left + 2];
  const shape = new Uint8Array(width * height);
  cells.forEach((_, k) => (shape[(rowsOf[k] - top) * width + colsOf[k] - left] = 1));
  const at = (grid, x, y) => (x >= 0 && y >= 0 && x < width && y < height ? grid[y * width + x] : 0);
  const ring = (grid, x, y) =>
    [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].map(([dx, dy]) =>
      at(grid, x + dx, y + dy)
    );

  // Stroke width: twice the deepest distance from the outline (4-connected)
  const depth = new Int32Array(width * height);
  let frontier = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (shape[y * width + x] && ring(shape, x, y).some((v, k) => k % 2 === 0 && !v)) {
        depth[y * width + x] = 1;
        frontier.push([x, y]);
      }
    }
  }
  let deepest = 1;
  while (frontier.length) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const [nx, ny] = [x + dx, y + dy];
        if (at(shape, nx, ny) && !depth[ny * width + nx]) {
          depth[ny * width + nx] = depth[y * width + x] + 1;
          deepest = Math.max(deepest, depth[ny * width + nx]);
          next.push([nx, ny]);
        }
      }
    }
    frontier = next;
  }

  // Zhang–Suen thinning to a one-cell skeleton
  const skeleton = shape.slice();
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!skeleton[y * width + x]) {
            continue;
          }
          const [p2, p3, p4, p5, p6, p7, p8, p9] = ring(skeleton, x, y);
          const neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          const sequence = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let transitions = 0;
          for (let k = 0; k < 8; k++) {
            transitions += !sequence[k] && sequence[k + 1] ? 1 : 0;
          }
          const first = pass === 0 ? p2 * p4 * p6 : p2 * p4 * p8;
          const second = pass === 0 ? p4 * p6 * p8 : p2 * p6 * p8;
          if (neighbours >= 2 && neighbours <= 6 && transitions === 1 && !first && !second) {
            remove.push(y * width + x);
          }
        }
      }
      remove.forEach((i) => (skeleton[i] = 0));
      changed ||= remove.length > 0;
    }
  }

  // Ends of the skeleton, grown back over the shape by one stroke width
  const reach = new Int32Array(width * height).fill(-1);
  const label = new Int32Array(width * height).fill(-1);
  const tips = [];
  frontier = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (skeleton[y * width + x] && ring(skeleton, x, y).reduce((a, b) => a + b) === 1) {
        reach[y * width + x] = 0;
        label[y * width + x] = tips.length;
        tips.push((y + top) * cols + x + left);
        frontier.push([x, y]);
      }
    }
  }
  const radius = 2 * deepest + 1;
  while (frontier.length) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const [nx, ny] = [x + dx, y + dy];
        const i = ny * width + nx;
        if (at(shape, nx, ny) && reach[i] < 0 && reach[y * width + x] < radius) {
          reach[i] = reach[y * width + x] + 1;
          label[i] = label[y * width + x];
          next.push([nx, ny]);
        }
      }
    }
    frontier = next;
  }
  const tipOf = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (label[y * width + x] >= 0) {
        tipOf.set((y + top) * cols + x + left, label[y * width + x]);
      }
    }
  }
  return { tips, tipOf };
}

// Font-unit transformation for a placement in `space`.
export function placementTransform(space, { variant, row, col }) {
  const x = space.left + col * space.unit - variant.box.xMin;
  const y = space.top - (row + variant.height) * space.unit - variant.box.yMin;
  return { rotation: variant.rotation, scaleX: variant.scaleX, x, y };
}

export function compositionKey(components) {
  return components
    .map(({ name, location, rotation, scaleX, x, y }) =>
      [name, JSON.stringify(location), rotation, scaleX, Math.round(x), Math.round(y)].join("|")
    )
    .sort()
    .join("/");
}
