import assert from "node:assert/strict";
import test from "node:test";
import { formulaParts, formulaText } from "./molecular-formula.js";

test("formula keeps first-seen order, folds suffixes and spellings, counts repeats", () => {
  // Component names already sorted left to right by x
  const names = ["dotom", "itom", "etom.alt", "bar", "etom", "ktom", "itom.ss01", "dottom"];
  const parts = formulaParts(names);
  assert.deepEqual(
    parts.map(({ symbol, count }) => [symbol, count]),
    [
      ["D", 2],
      ["I", 2],
      ["E", 2],
      ["K", 1],
    ]
  );
  assert.equal(formulaText(parts), "D₂I₂E₂K");
});

test("unknown *tom components show their base name; multi-digit counts", () => {
  const names = [...Array(12).fill("itom"), "xtom.alt"];
  assert.equal(formulaText(formulaParts(names)), "I₁₂xtom");
});
