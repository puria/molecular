import assert from "node:assert/strict";
import test from "node:test";
import { cellCharges, defaultAnchors, transformAnchors } from "./molecular-bonds.js";
import { analyseBonds } from "./molecular-composer.js";
import { makeSpace, partMatrix, rasterize } from "./molecular-ocr.js";

const space = makeSpace({ capHeight: 750, ascender: 800, descender: -250 }, 60);

function box(width, height) {
  return {
    outline: [[0, 0, width, 0, width, height, 0, height]],
    bounds: { xMin: 0, yMin: 0, xMax: width, yMax: height },
  };
}

// A typtom placed with a transformation, as a piece for analyseBonds
function place(base, shape, transform) {
  const matrix = partMatrix(transform);
  const cells = [];
  rasterize(space, [{ outline: shape.outline, matrix }]).forEach((v, i) => v > 0.5 && cells.push(i));
  const anchors = transformAnchors(defaultAnchors(base, shape.outline, shape.bounds), matrix);
  return { cells, ...cellCharges(base, cells, space, anchors) };
}

const itom = box(100, 750);
const etom = box(300, 100);

test("an E's arm bonds to the stem's face", () => {
  const stem = place("itom", itom, {});
  const arm = place("etom", etom, { x: 100, y: 650 });
  const { violations, regions } = analyseBonds([stem, arm], [[0, 0], [0, 0]], space.cols, space.rows);
  assert.equal(violations, 0);
  assert.equal(regions.length, 1);
});

test("charges turn with the typtom: two arms end to end attract, unless one is flipped", () => {
  const left = place("etom", etom, { x: 0, y: 300 });
  const right = place("etom", etom, { x: 300, y: 300 });
  // left's - end meets right's + end
  assert.equal(analyseBonds([left, right], [[0, 0], [0, 0]], space.cols, space.rows).violations, 0);
  // Flipped, the right arm's + end is now on its right: - meets -
  const flipped = place("etom", etom, { x: 600, y: 300, scaleX: -1 });
  assert.ok(analyseBonds([left, flipped], [[0, 0], [0, 0]], space.cols, space.rows).violations > 0);
});

test("an end on a face needs no charge: a flipped arm still bonds to the stem", () => {
  const stem = place("itom", itom, { x: 300 });
  const arm = place("etom", etom, { x: 300, y: 650, scaleX: -1 });
  const { violations } = analyseBonds([stem, arm], [[0, 0], [0, 0]], space.cols, space.rows);
  assert.equal(violations, 0);
});
