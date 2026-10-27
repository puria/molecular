import assert from "node:assert/strict";
import test from "node:test";
import { halvedContours, mirroredContours, squashedContours } from "./molecular-wizard.js";

// A path with one closed contour, as Fontra's VarPackedPath exposes it
function path(points) {
  return {
    numContours: 1,
    getUnpackedContour: () => ({ isClosed: true, points: points.map(([x, y]) => ({ x, y })) }),
  };
}
const xy = (contours) => contours[0].points.map((p) => [p.x, p.y]);

test("a diagonal's zero-length master collapses along its slant, as in TemplateBase", () => {
  // TemplateBase's vtom and its v-height=0 layer
  const vtom = path([[275, 750], [175, 750], [0, 0], [100, 0]]);
  assert.deepEqual(xy(squashedContours(vtom, "v-height")), [[100, 0], [0, 0], [0, 0], [100, 0]]);
});

test("an etom collapses onto its left edge", () => {
  const etom = path([[0, 500], [0, 400], [500, 400], [500, 500]]);
  assert.deepEqual(xy(squashedContours(etom, "e-length")), [[0, 500], [0, 400], [0, 400], [0, 500]]);
});

const contour = (points) => ({ isClosed: true, points: points.map(([x, y]) => ({ x, y })) });
// Same closed contour, whatever point it starts at
function sameCycle(actual, expected) {
  const start = actual.findIndex(([x, y]) => x === expected[0][0] && y === expected[0][1]);
  assert.deepEqual([...actual.slice(start), ...actual.slice(0, start)], expected);
}

test("mirroring vtom gives TemplateBase's vtom.alt, same direction", () => {
  const [mirrored] = mirroredContours([contour([[275, 750], [175, 750], [0, 0], [100, 0]])], {
    xMin: 0,
    xMax: 275,
  });
  sameCycle(xy([mirrored]), [[0, 750], [175, 0], [275, 0], [100, 750]]);
});

test("a half typtom is half as tall and keeps its stroke weight", () => {
  // A stem 100 wide, either direction
  for (const points of [[[0, 0], [100, 0], [100, 750], [0, 750]], [[0, 0], [0, 750], [100, 750], [100, 0]]]) {
    const [half] = halvedContours([contour(points)], 100);
    const ps = xy([half]);
    assert.deepEqual([Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))], [100, 375]);
  }
  // A square ring, 100 thick: the counter shrinks rather than grows
  const ring = [contour([[0, 0], [600, 0], [600, 600], [0, 600]]), contour([[100, 100], [100, 500], [500, 500], [500, 100]])];
  const [outer, counter] = halvedContours(ring, 100).map((c) => xy([c]));
  assert.deepEqual([Math.max(...outer.map((p) => p[0])), Math.max(...outer.map((p) => p[1]))], [300, 300]);
  assert.deepEqual([Math.min(...counter.map((p) => p[0])), Math.max(...counter.map((p) => p[0]))], [100, 200]);
});
