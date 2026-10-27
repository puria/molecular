// Setting up a new molecular font: the seven typtoms first, then every glyph built
// from them. This module holds the font operations; the panel draws the steps.

// The seven typtoms in the order they are drawn, what each is, and how to draw it
// (`cap` is the font's cap height). Strokes get a length axis, as in TemplateBase,
// so the composer can stretch them.
export const TYPTOMS = [
  { name: "itom", role: "Vertical stroke", draw: (cap) => `from the baseline up to the cap height (${cap})`, axis: "i-length" },
  { name: "etom", role: "Horizontal stroke", draw: () => "as long as your longest arm, e.g. the top of E", axis: "e-length" },
  { name: "vtom", role: "Diagonal stroke", draw: (cap) => `from the baseline to the cap height (${cap}), leaning right`, axis: "v-height" },
  { name: "ctom", role: "Curve", draw: (cap) => `a bowl ${cap} tall, open to the right, as in C`, axis: null },
  { name: "jtom", role: "Descending curve", draw: () => "a hook, as in j and the bowls of P and R", axis: null },
  { name: "ktom", role: "Appendage", draw: () => "a short spur or tail, as in K, R and Q", axis: null },
  { name: "dotom", role: "Point", draw: () => "a dot, as on i and in the period", axis: null },
];

// Printable ASCII and its standard (AGL) glyph names.
const NAMES =
  "exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright " +
  "asterisk plus comma hyphen period slash zero one two three four five six seven eight " +
  "nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q " +
  "R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b " +
  "c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde";
export const ALPHABET = NAMES.split(" ").map((name, i) => ({
  name,
  character: String.fromCharCode(33 + i),
}));

// "missing", "empty" or "drawn" (has contours or components on any layer).
export async function glyphState(fontController, name) {
  const varGlyph = fontController.glyphMap[name] ? await fontController.getGlyph(name) : null;
  if (!varGlyph) {
    return "missing";
  }
  const filled = Object.values(varGlyph.glyph.layers).some(
    ({ glyph }) => glyph.path.numPoints > 0 || glyph.components.length > 0
  );
  return filled ? "drawn" : "empty";
}

// The glyph name for each alphabet character in this font: its own glyph if it
// has one under another name, else the standard name.
export function alphabetGlyphs(fontController) {
  const byCodePoint = new Map();
  for (const [name, codePoints] of Object.entries(fontController.glyphMap)) {
    for (const codePoint of codePoints) {
      byCodePoint.set(codePoint, name);
    }
  }
  return ALPHABET.map(({ name, character }) => ({
    character,
    name: byCodePoint.get(character.codePointAt(0)) ?? name,
  }));
}

function defaultSource(fontController) {
  const identifier = fontController.defaultSourceIdentifier;
  const layerName = identifier || "default";
  return {
    name: fontController.sources[identifier] ? "" : layerName,
    location: {},
    layerName,
    locationBase: identifier,
  };
}

// Creates the typtom glyphs this font lacks, empty, ready to be drawn.
export async function createTyptoms(fontController) {
  const source = defaultSource(fontController);
  let created = 0;
  for (const { name } of TYPTOMS) {
    if (!fontController.glyphMap[name]) {
      await fontController.newGlyph(
        name,
        undefined,
        { name, sources: [source], layers: { [source.layerName]: { glyph: { xAdvance: 500 } } } },
        null,
        `New typtom "${name}"`
      );
      created++;
    }
  }
  return created;
}

// The drawn layer squashed to zero length along its stroke: an itom's or vtom's
// points down onto its bottom edge (following the slant), an etom's onto its left.
export function squashedContours(path, axis) {
  const contours = Array.from({ length: path.numContours }, (_, i) => path.getUnpackedContour(i));
  const points = contours.flatMap((contour) => contour.points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xMin, yMin, yMax] = [Math.min(...xs), Math.min(...ys), Math.max(...ys)];
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const band = 0.1 * (yMax - yMin);
  const slope =
    yMax > yMin
      ? (mean(points.filter((p) => p.y >= yMax - band).map((p) => p.x)) -
          mean(points.filter((p) => p.y <= yMin + band).map((p) => p.x))) /
        (yMax - yMin)
      : 0;
  return contours.map((contour) => ({
    ...contour,
    points: contour.points.map((p) =>
      axis === "e-length"
        ? { ...p, x: xMin }
        : { ...p, x: Math.round(p.x - (p.y - yMin) * slope), y: yMin }
    ),
  }));
}

// Gives each drawn stroke typtom that has no glyph axis yet its length axis, as in
// TemplateBase: the drawn shape is the full length, and a new "…=0" source holds it
// squashed to nothing, so any length in between interpolates.
export async function addLengthAxes(fontController, sceneController) {
  const source = defaultSource(fontController);
  for (const { name, axis } of TYPTOMS) {
    const varGlyph = axis && (await fontController.getGlyph(name));
    const drawn = varGlyph?.glyph.layers[source.layerName]?.glyph;
    if (!drawn || varGlyph.glyph.axes.length || !drawn.path.numPoints) {
      continue;
    }
    const bounds = drawn.path.getBounds();
    const length = Math.round(
      axis === "e-length" ? bounds.xMax - bounds.xMin : bounds.yMax - bounds.yMin
    );
    const zero = `${axis}=0`;
    const Layer = varGlyph.glyph.layers[source.layerName].constructor;
    const Source = varGlyph.glyph.sources[0].constructor;
    const layer = Layer.fromObject({
      glyph: { xAdvance: drawn.xAdvance, path: { contours: squashedContours(drawn.path, axis) } },
    });
    await sceneController.editNamedGlyphAndRecordChanges(name, (glyph) => {
      glyph.axes.push({ name: axis, minValue: 0, defaultValue: length, maxValue: length });
      glyph.layers[zero] = layer;
      glyph.sources.push(
        Source.fromObject({
          name: zero,
          layerName: zero,
          location: { [axis]: 0 },
          locationBase: source.locationBase,
        })
      );
      return `Length axis for ${name}`;
    });
  }
}

// The isotopes TemplateBase has, made from the plain typtoms: `.alt` is the mirror
// image (the diagonal leaning the other way), `.half` is half as tall with the same
// stroke weight.
export const ISOTOPES = [
  { name: "vtom.alt", from: "vtom", make: "mirror" },
  { name: "ktom.alt", from: "ktom", make: "mirror" },
  { name: "ctom.half", from: "ctom", make: "half" },
  { name: "ktom.half", from: "ktom", make: "half" },
];

const contoursOf = (path) =>
  Array.from({ length: path.numContours }, (_, i) => path.getUnpackedContour(i));

function boundsOf(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
}

// Mirrored left to right within `[xMin, xMax]`, contours reversed so they keep
// their direction.
export function mirroredContours(contours, { xMin, xMax }) {
  return contours.map((contour) => ({
    ...contour,
    points: contour.points.map((p) => ({ ...p, x: xMin + xMax - p.x })).reverse(),
  }));
}

// Half as tall, the stroke still `weight` thick: scaled down, then every edge pushed
// out (counters in) by as much as the scaling thinned it, and set on the baseline at
// x = 0. Null when the shape is too small to halve at that weight.
export function halvedContours(contours, weight) {
  const { yMin, yMax } = boundsOf(contours.flatMap((c) => c.points));
  const height = yMax - yMin;
  const scale = (height / 2 - weight) / (height - weight);
  if (!(scale > 0)) {
    return null;
  }
  const offset = ((1 - scale) * weight) / 2;
  const area = (points) =>
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2;
  // Outward is right of the direction of travel on the outer contour; counters run
  // the other way, so the same side shrinks them
  const outer = contours.reduce((a, b) => (Math.abs(area(b.points)) > Math.abs(area(a.points)) ? b : a));
  const side = Math.sign(area(outer.points)) || 1;
  const unit = (dx, dy) => {
    const length = Math.hypot(dx, dy);
    return [(side * dy) / length, (-side * dx) / length];
  };
  const grown = contours.map((contour) => {
    const points = contour.points.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale }));
    const n = points.length;
    const distinct = (i, step) => {
      for (let k = 1; k < n; k++) {
        const q = points[(i + step * k + n * k) % n];
        if (q.x !== points[i].x || q.y !== points[i].y) {
          return q;
        }
      }
      return points[i];
    };
    return {
      ...contour,
      points: points.map((p, i) => {
        const [prev, next] = [distinct(i, -1), distinct(i, 1)];
        if (prev === p || next === p) {
          return p;
        }
        // Mitred: `offset` away from both neighbouring edges
        const [ax, ay] = unit(p.x - prev.x, p.y - prev.y);
        const [bx, by] = unit(next.x - p.x, next.y - p.y);
        const k = offset / Math.max(1 + ax * bx + ay * by, 0.25);
        return { ...p, x: p.x + (ax + bx) * k, y: p.y + (ay + by) * k };
      }),
    };
  });
  const bounds = boundsOf(grown.flatMap((c) => c.points));
  return grown.map((contour) => ({
    ...contour,
    points: contour.points.map((p) => ({
      ...p,
      x: Math.round(p.x - bounds.xMin),
      y: Math.round(p.y - bounds.yMin),
    })),
  }));
}

// Makes the isotopes the font lacks from its drawn typtoms. The stroke weight is the
// itom's width.
export async function addIsotopes(fontController) {
  const itom = await fontController.getGlyph("itom");
  const itomLayer = itom?.glyph.layers[itom.glyph.sources[0]?.layerName]?.glyph;
  const itomPoints = itomLayer ? contoursOf(itomLayer.path).flatMap((c) => c.points) : [];
  const weight = itomPoints.length ? boundsOf(itomPoints).xMax - boundsOf(itomPoints).xMin : 0;
  for (const { name, from, make } of ISOTOPES) {
    if (fontController.glyphMap[name]) {
      continue; // yours, drawn or generated before
    }
    const base = await fontController.getGlyph(from);
    const source = defaultSource(fontController);
    const baseLayer = base?.glyph.layers[source.layerName]?.glyph;
    if (!baseLayer?.path.numPoints) {
      continue;
    }
    const drawn = boundsOf(contoursOf(baseLayer.path).flatMap((c) => c.points));
    let glyph;
    if (make === "mirror") {
      // Every layer, so a length axis keeps working
      const mirror = (x) => drawn.xMin + drawn.xMax - x;
      glyph = {
        name,
        axes: base.glyph.axes.map((axis) => ({ ...axis })),
        sources: base.glyph.sources.map(({ name, location, layerName, locationBase }) => ({
          name,
          location: { ...location },
          layerName,
          locationBase,
        })),
        layers: Object.fromEntries(
          Object.entries(base.glyph.layers).map(([layerName, { glyph: layer }]) => [
            layerName,
            {
              glyph: {
                xAdvance: layer.xAdvance,
                path: { contours: mirroredContours(contoursOf(layer.path), drawn) },
                anchors: layer.anchors.map((a) => ({ ...a, x: mirror(a.x) })),
              },
            },
          ])
        ),
      };
    } else {
      const contours = weight && halvedContours(contoursOf(baseLayer.path), weight);
      if (!contours) {
        continue;
      }
      const half = boundsOf(contours.flatMap((c) => c.points));
      glyph = {
        name,
        sources: [source],
        layers: {
          [source.layerName]: {
            glyph: {
              xAdvance: Math.round(half.xMax + baseLayer.xAdvance - drawn.xMax),
              path: { contours },
            },
          },
        },
      };
    }
    await fontController.newGlyph(name, undefined, glyph, null, `New isotope "${name}"`);
  }
}

// A composition's components as Fontra components.
export function fontraComponents(composition) {
  return (composition?.components || []).map((c) => ({
    name: c.name,
    transformation: {
      translateX: c.x,
      translateY: c.y,
      rotation: c.rotation ?? 0,
      scaleX: c.scaleX ?? 1,
      scaleY: c.scaleY ?? 1,
      skewX: c.skewX ?? 0,
      skewY: c.skewY ?? 0,
      tCenterX: c.tCenterX ?? 0,
      tCenterY: c.tCenterY ?? 0,
    },
    location: { ...c.location },
    customData: {},
  }));
}

// Puts a composition into a glyph: creates the glyph if missing, or fills its empty
// layers. A null composition creates the glyph empty.
export async function writeComponents(fontController, sceneController, glyphName, character, composition) {
  const components = fontraComponents(composition);
  const xAdvance = composition?.xAdvance ?? 500;
  if (!fontController.glyphMap[glyphName]) {
    const source = defaultSource(fontController);
    await fontController.newGlyph(
      glyphName,
      character?.codePointAt(0),
      { name: glyphName, sources: [source], layers: { [source.layerName]: { glyph: { xAdvance, components } } } },
      null,
      `Compose new glyph "${glyphName}"`
    );
    return;
  }
  if (!components.length) {
    return;
  }
  await sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
    for (const { glyph: layerGlyph } of Object.values(glyph.layers)) {
      if (!layerGlyph.path.numPoints && !layerGlyph.components.length) {
        layerGlyph.components.splice(0, 0, ...components.map((c) => structuredClone(c)));
        layerGlyph.xAdvance = xAdvance;
      }
    }
    return `Compose "${glyphName}"`;
  });
}
