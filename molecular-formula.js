export const TYPTOM_LETTERS = {
  dottom: "D",
  itom: "I",
  etom: "E",
  vtom: "V",
  jtom: "J",
  ctom: "C",
  ktom: "K",
};

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

export function baseTyptomName(componentName) {
  return componentName.includes("tom") ? componentName.split(".")[0] : null;
}

// Typtom notation: names of x-sorted components in, letters in first-seen order out,
// repeats counted.
export function formulaParts(componentNames) {
  const counts = new Map();
  for (const name of componentNames) {
    const base = baseTyptomName(name);
    if (base) {
      counts.set(base, (counts.get(base) || 0) + 1);
    }
  }
  return [...counts].map(([base, count]) => ({
    base,
    symbol: TYPTOM_LETTERS[base] || base,
    count,
  }));
}

export function formulaText(parts) {
  return parts
    .map(
      ({ symbol, count }) =>
        symbol +
        (count > 1 ? [...String(count)].map((d) => SUBSCRIPT_DIGITS[d]).join("") : "")
    )
    .join("");
}
