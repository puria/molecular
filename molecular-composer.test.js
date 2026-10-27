import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseBonds,
  endRegions,
  greedyCompose,
  joinPieces,
  refineComposition,
  snapComponents,
  topology,
} from "./molecular-composer.js";

function bar(width, height) {
  const cells = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      cells.push([row, col]);
    }
  }
  return { width, height, cells };
}

test("covers an E with one stem and three arms, and nothing else", () => {
  const [cols, rows] = [20, 26];
  const target = new Float32Array(cols * rows);
  const fill = (row0, col0, width, height) => {
    for (let row = row0; row < row0 + height; row++) {
      for (let col = col0; col < col0 + width; col++) {
        target[row * cols + col] = 1;
      }
    }
  };
  fill(2, 2, 2, 20); // stem
  fill(2, 4, 10, 2); // top arm
  fill(11, 4, 8, 2); // middle arm
  fill(20, 4, 10, 2); // bottom arm

  const stem = { name: "stem", ...bar(2, 20) };
  const longArm = { name: "long", ...bar(10, 2) };
  const shortArm = { name: "short", ...bar(8, 2) };
  const placements = greedyCompose(target, cols, rows, [stem, longArm, shortArm]);

  assert.deepEqual(
    placements.map(({ variant, row, col }) => [variant.name, row, col]).sort(),
    [
      ["long", 2, 4],
      ["long", 20, 4],
      ["short", 11, 4],
      ["stem", 2, 2],
    ]
  );
});

test("refinement closes a gap so the pieces of an L touch", () => {
  const [cols, rows] = [16, 16];
  const target = new Float32Array(cols * rows);
  for (let row = 2; row < 14; row++) target[row * cols + 2] = target[row * cols + 3] = 1;
  for (let col = 4; col < 12; col++) target[12 * cols + col] = target[13 * cols + col] = 1;
  const stem = { name: "stem", rotation: 0, scaleX: 1, ...bar(2, 12) };
  const arm = { name: "arm", rotation: 0, scaleX: 1, ...bar(8, 2) };
  // Arm placed one cell off: two separate ink regions where the L has one
  const broken = [
    { variant: stem, row: 2, col: 2 },
    { variant: arm, row: 12, col: 5 },
  ];
  const mask = (placements) => {
    const m = new Uint8Array(cols * rows);
    for (const { variant, row, col } of placements)
      for (const [r, c] of variant.cells) m[(row + r) * cols + col + c] = 1;
    return m;
  };
  assert.equal(topology(mask(broken), cols, rows).ink, 2);
  const fixed = refineComposition(target, cols, rows, [stem, arm], broken);
  assert.equal(topology(mask(fixed), cols, rows).ink, 1);
});

test("snapping moves a piece so its edge meets its neighbour exactly", () => {
  const box = { xMin: 0, yMin: 0, xMax: 100, yMax: 500 };
  const geometry = (c) => ({
    xMin: c.x + box.xMin,
    xMax: c.x + box.xMax,
    yMin: c.y + box.yMin,
    yMax: c.y + box.yMax,
  });
  const [stem, next] = snapComponents(
    [
      { name: "a", x: 0, y: 0 },
      { name: "b", x: 118, y: 9 }, // 18 units off to the right, 9 above the baseline
    ],
    geometry,
    [0, 500],
    30
  );
  assert.deepEqual([stem.x, stem.y, next.x, next.y], [0, 0, 100, 0]);
});

const COLS = 12;
function cellsAt(row0, col0, width, height) {
  const out = [];
  for (let row = row0; row < row0 + height; row++)
    for (let col = col0; col < col0 + width; col++) out.push(row * COLS + col);
  return out;
}
// A piece charged the same everywhere
function piece(cells, charge, floating = false) {
  return { cells, charges: Int8Array.from(cells, () => charge), floating };
}

test("joining slides a loose piece flush onto the rest, but keeps an i's dot apart", () => {
  const stem = piece(cellsAt(1, 1, 2, 8), -1);
  const arm = piece(cellsAt(7, 5, 3, 2), 1); // two white columns away
  // Slides two columns, so it lies against the stem's face without sinking into it
  assert.deepEqual(joinPieces([stem, arm], COLS, 12, 1, 3), [
    [0, 0],
    [-2, 0],
  ]);
  // An arm already flush against the stem stays where it is
  const flush = piece(cellsAt(7, 3, 3, 2), 1);
  assert.deepEqual(joinPieces([stem, flush], COLS, 12, 1, 3), [
    [0, 0],
    [0, 0],
  ]);
  const dot = piece(cellsAt(0, 1, 2, 1), 0, true);
  const body = piece(cellsAt(3, 1, 2, 6), 1);
  assert.deepEqual(joinPieces([dot, body], COLS, 12, 2, 3), [
    [0, 0],
    [0, 0],
  ]);
});

test("a dotom may touch as a joint, without that counting as a bond", () => {
  const stem = piece(cellsAt(3, 1, 2, 8), 1);
  const dot = piece(cellsAt(2, 1, 2, 1), 0, true); // sits on the stem
  const { violations, regions } = analyseBonds([stem, dot], [[0, 0], [0, 0]], COLS, 12);
  assert.equal(violations, 0);
  assert.equal(regions.length, 2);
});

test("an overlap bonds whatever the charges", () => {
  const stem = piece(cellsAt(1, 1, 3, 8), 1);
  const inside = piece(cellsAt(4, 2, 1, 2), 1); // wholly inside the stem, same charge
  const { violations, regions } = analyseBonds([stem, inside], [[0, 0], [0, 0]], COLS, 12);
  assert.equal(violations, 0);
  assert.equal(regions.length, 1);
});

test("like charges repel: two + pieces touching break the rules, + and - bond", () => {
  const stem = piece(cellsAt(1, 1, 2, 8), 1);
  assert.equal(analyseBonds([stem, piece(cellsAt(7, 3, 3, 2), 1)], [[0, 0], [0, 0]], COLS, 12).violations > 0, true);
  const { violations, regions } = analyseBonds(
    [stem, piece(cellsAt(7, 3, 3, 2), -1)],
    [[0, 0], [0, 0]],
    COLS,
    12
  );
  assert.equal(violations, 0);
  assert.equal(regions.length, 1);
});

test("a piece that bonds only at its ends cannot be joined by its middle", () => {
  // A horizontal bar charged + at its two ends and 0 between, a - stem under its middle
  const cells = cellsAt(2, 2, 8, 2);
  const bar = { cells, charges: Int8Array.from(cells, (i) => (i % COLS < 3 || i % COLS > 8 ? 1 : 0)) };
  const stem = piece(cellsAt(5, 5, 2, 6), -1);
  const shifts = joinPieces([bar, stem], COLS, 12, 1, 4);
  const { regions, violations } = analyseBonds([bar, stem], shifts, COLS, 12);
  assert.equal(violations, 0);
  assert.equal(regions.length, 1);
  // The stem's top meets one of the bar's ends, not its middle
  const stemCol = 5 + shifts[1][0] - shifts[0][0];
  assert.ok(stemCol <= 3 || stemCol >= 7, `stem column ${stemCol}`);
});

test("a C-shaped stroke has its ends at its two tips, not along the curve", () => {
  const cols = 30;
  const at = (row, col) => row * cols + col;
  // A thick bracket: top arm, spine, bottom arm (3 cells thick)
  const cells = [];
  for (let row = 2; row < 27; row++) for (let col = 2; col < 5; col++) cells.push(at(row, col));
  for (let col = 5; col < 20; col++)
    for (const row of [2, 3, 4, 24, 25, 26]) cells.push(at(row, col));
  const { tips, tipOf } = endRegions(cells, cols);
  assert.equal(tips.length, 2);
  assert.notEqual(tipOf.get(at(3, 19)), tipOf.get(at(25, 19)), "each tip has its own end");
  assert.ok(tipOf.has(at(3, 19)) && tipOf.has(at(25, 19)), "tips are ends");
  assert.ok(!tipOf.has(at(14, 3)), "the middle of the spine is not");
});
