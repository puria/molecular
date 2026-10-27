import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReferenceFaces,
  makeReader,
  makeSpace,
  partMatrix,
  rasterize,
} from "./molecular-ocr.js";

await loadReferenceFaces();
const space = makeSpace({ capHeight: 750, ascender: 800, descender: -250 }, 30);
const read = makeReader(space);

// A counter-clockwise rectangle, as a part at (x, y)
function box(x, y, width, height, transform = {}) {
  return {
    outline: [[0, 0, width, 0, width, height, 0, height]],
    matrix: partMatrix({ ...transform, x, y }),
  };
}

test("overlapping parts unite even when one is mirrored", () => {
  const plain = rasterize(space, [box(0, 0, 100, 750)]);
  // Mirroring reverses the contour direction; a single nonzero pass would cancel it out
  const both = rasterize(space, [box(0, 0, 100, 750), box(100, 0, 100, 750, { scaleX: -1 })]);
  assert.deepEqual(both, plain);
});

test("a stem and three arms read as E", () => {
  const raster = rasterize(space, [
    box(0, 0, 100, 750),
    box(0, 650, 380, 100),
    box(0, 325, 300, 100),
    box(0, 0, 380, 100),
  ]);
  assert.equal(read(raster)[0].character, "E");
});

test("the same square reads by where it sits: baseline dot, raised dash", () => {
  assert.equal(read(rasterize(space, [box(0, 0, 120, 120)]))[0].character, ".");
  assert.equal(read(rasterize(space, [box(0, 280, 250, 90)]))[0].character, "-");
});
