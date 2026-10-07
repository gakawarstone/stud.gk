type Color = readonly [number, number, number];
type Pixels = { width: number; height: number; data: Uint8ClampedArray };
type Palette = { base: Color; text: Color; subtext: Color; surface: Color; accents: readonly Color[] };
type Background = { color: Color; dark: boolean; count: number; output: Color };
type Ink = { strength: number; color: Color; output?: Color };

const tone = (color: Color) => (color[0] + color[1] + color[2]) / 3;
const chroma = (color: Color) => Math.max(...color) - Math.min(...color);
const unpack = (value: number): Color => [value >>> 16, (value >>> 8) & 255, value & 255];

function hue(color: Color) {
  const [red, green, blue] = color;
  const maximum = Math.max(red, green, blue);
  const range = maximum - Math.min(red, green, blue);
  if (!range) return 0;
  const value = maximum === red
    ? (green - blue) / range
    : maximum === green
      ? (blue - red) / range + 2
      : (red - green) / range + 4;
  return (value * 60 + 360) % 360;
}

function luminance(color: Color) {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// Keep a token's hue and saturation, lifting only colors that are too dark
// for the new paper color. This runs once per hue and background, not per pixel.
function readableInk(color: Color, background: Color): Color {
  const backgroundLuminance = luminance(background);
  if ((luminance(color) + 0.05) / (backgroundLuminance + 0.05) >= 4.5)
    return color;
  const maximum = Math.max(...color) / 255;
  const minimum = Math.min(...color) / 255;
  const lightness = (maximum + minimum) / 2;
  const saturation = (maximum - minimum) / (1 - Math.abs(2 * lightness - 1));
  const angle = hue(color);
  const atLightness = (value: number): Color => {
    const amplitude = saturation * Math.min(value, 1 - value);
    const channel = (offset: number) => {
      const position = (offset + angle / 30) % 12;
      return Math.round(255 * (value - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1))));
    };
    return [channel(0), channel(8), channel(4)];
  };
  let low = lightness;
  let high = 1;
  for (let iteration = 0; iteration < 12; iteration++) {
    const middle = (low + high) / 2;
    if ((luminance(atLightness(middle)) + 0.05) / (backgroundLuminance + 0.05) < 4.5)
      low = middle;
    else high = middle;
  }
  return atLightness(high + (1 - high) * lightness * 0.25);
}

function themeInk(ink: Ink, anchor: Ink, background: Background, palette: Palette, neutral: boolean): Color {
  if (neutral) {
    const paper = tone(background.color);
    const contrast = Math.abs(tone(ink.color) - paper) / Math.max(1, background.dark ? 255 - paper : paper);
    return contrast >= 0.7 ? palette.text : palette.subtext;
  }
  const angle = hue(ink.color);
  const distance = (color: Color) => {
    const difference = Math.abs(hue(color) - angle);
    return Math.min(difference, 360 - difference);
  };
  const accent = palette.accents.reduce((closest, candidate) => distance(candidate) < distance(closest) ? candidate : closest);
  // Keep shade differences between tokens of the same hue, anchored on the
  // strongest original ink so that a document's main colors use the palette.
  const shade = (tone(ink.color) - tone(anchor.color)) / 255 * 0.15;
  const shifted = accent.map((channel) => Math.round(Math.max(0, Math.min(255, channel + shade * 255)))) as unknown as Color;
  return readableInk(shifted, background.output);
}

function findBackgrounds(pixels: Pixels, pixelScale: number, base: Color, surface: Color) {
  // Bound the analysis to about a million samples even at maximum PDF zoom.
  const step = Math.max(1, Math.ceil(Math.max(pixels.width, pixels.height) / 1024));
  const width = Math.ceil(pixels.width / step);
  const height = Math.ceil(pixels.height / step);
  const size = width * height;
  const colors = new Uint32Array(size);
  const kinds = new Uint8Array(size);
  const references = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  const backgrounds: Background[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (Math.min(y * step, pixels.height - 1) * pixels.width + Math.min(x * step, pixels.width - 1)) * 4;
      const color: Color = [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
      const index = y * width + x;
      colors[index] = (color[0] << 16) | (color[1] << 8) | color[2];
      if (chroma(color) <= 24 || Math.max(...color) <= 96)
        kinds[index] = 1 + Math.floor(tone(color) / 8);
    }
  }
  const minimumSide = Math.max(3, Math.ceil(8 * pixelScale / step));
  const minimumWidth = Math.max(minimumSide, Math.ceil(32 * pixelScale / step));
  for (let start = 0; start < size; start++) {
    const kind = kinds[start];
    if (!kind || kind > 32) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    kinds[start] += 32;
    let left = width, right = 0, top = height, bottom = 0;
    const counts = new Uint32Array(32);
    const sums = new Uint32Array(96);
    const visit = (index: number) => {
      if (kinds[index] !== kind) return;
      kinds[index] += 32;
      queue[tail++] = index;
    };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      const color = unpack(colors[index]);
      const bucket = Math.min(31, Math.floor(tone(color) / 8));
      counts[bucket]++;
      for (let channel = 0; channel < 3; channel++) sums[bucket * 3 + channel] += color[channel];
      if (x > 0) visit(index - 1);
      if (x + 1 < width) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y + 1 < height) visit(index + width);
    }
    // Thin letters and outlines aren't paper. Broad, mostly solid regions are.
    if (right - left + 1 < minimumWidth || bottom - top + 1 < minimumSide ||
        tail < (right - left + 1) * (bottom - top + 1) * 0.5) continue;
    let bucket = 0;
    for (let index = 1; index < counts.length; index++)
      if (counts[index] > counts[bucket]) bucket = index;
    const color: Color = [
      Math.round(sums[bucket * 3] / counts[bucket]),
      Math.round(sums[bucket * 3 + 1] / counts[bucket]),
      Math.round(sums[bucket * 3 + 2] / counts[bucket]),
    ];
    const reference = backgrounds.length;
    backgrounds.push({ color, dark: tone(color) < 128, count: tail, output: base });
    for (let index = 0; index < tail; index++) references[queue[index]] = reference;
  }
  if (!backgrounds.length) {
    const color = unpack(colors[0]);
    backgrounds.push({ color, dark: tone(color) < 128, count: size, output: base });
    references.fill(0);
  } else {
    const paper = backgrounds.reduce((largest, candidate) => candidate.count > largest.count ? candidate : largest);
    for (const background of backgrounds)
      if (background.dark !== paper.dark || Math.abs(tone(background.color) - tone(paper.color)) > 6)
        background.output = surface;
    // Carry the closest paper color into the small gaps occupied by text.
    let head = 0, tail = 0;
    for (let index = 0; index < size; index++)
      if (references[index] >= 0) queue[tail++] = index;
    const visit = (index: number, reference: number) => {
      if (references[index] >= 0) return;
      references[index] = reference;
      queue[tail++] = index;
    };
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = Math.floor(index / width);
      const reference = references[index];
      if (x > 0) visit(index - 1, reference);
      if (x + 1 < width) visit(index + 1, reference);
      if (y > 0) visit(index - width, reference);
      if (y + 1 < height) visit(index + width, reference);
    }
  }
  return { step, width, colors, references, backgrounds };
}

export function adaptPdfColors(
  pixels: Pixels,
  palette: Palette,
  pixelScale = 1,
) {
  const { step, width, colors, references, backgrounds } = findBackgrounds(pixels, pixelScale, palette.base, palette.surface);
  const boundaries = new Int32Array(references.length).fill(-1);
  for (let index = 0; index < references.length; index++) {
    const x = index % width, y = Math.floor(index / width);
    for (let dy = -1; dy <= 1 && boundaries[index] < 0; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbor = (y + dy) * width + x + dx;
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || neighbor >= references.length) continue;
        const reference = references[neighbor];
        if (backgrounds[reference].output !== backgrounds[references[index]].output) {
          boundaries[index] = reference;
          break;
        }
      }
    }
  }
  const peaks: Array<Array<Ink | undefined>> = backgrounds.map(() => new Array(73));
  const inks: Array<Array<Ink[] | undefined>> = backgrounds.map(() => new Array(73));
  const solidColors = backgrounds.map(() => new Map<number, Ink>());
  const mappedColors = backgrounds.map(() => new Map<number, Color>());
  const inkDetails = (color: Color, background: Color) => {
    const difference: Color = [color[0] - background[0], color[1] - background[1], color[2] - background[2]];
    const range = chroma(color);
    const saturation = range / Math.max(1, Math.max(...color));
    const neutral = range <= 24 || chroma(difference) <= 12 ||
      (tone(color) > 150 && saturation < 0.18) || (range < 32 && saturation < 0.25);
    const strength = Math.max(...difference.map(Math.abs));
    // Group by the direction away from paper, which stays constant as opacity
    // changes. Decide whether ink is neutral from its solid color, not its edge.
    return { strength, neutral, bucket: chroma(difference) <= strength * 0.04 ? 72 : Math.floor(hue(difference) / 5) };
  };
  for (let index = 0; index < colors.length; index++) {
    const reference = references[index];
    const background = backgrounds[reference];
    const color = unpack(colors[index]);
    const details = inkDetails(color, background.color);
    if (details.strength <= 12) continue;
    const ink: Ink = { strength: details.strength, color };
    if (details.strength > (peaks[reference][details.bucket]?.strength ?? 0))
      peaks[reference][details.bucket] = ink;
    // A repeated 2×2 color is solid ink. Keep separate token colors even when
    // they have the same hue; edge colors are mixtures with the original paper.
    if (index % width + 1 < width && index + width + 1 < colors.length &&
        colors[index] === colors[index + 1] && colors[index] === colors[index + width] &&
        colors[index] === colors[index + width + 1] && !solidColors[reference].has(colors[index]) &&
        solidColors[reference].size < 8192) {
      solidColors[reference].set(colors[index], ink);
      const group = inks[reference][details.bucket] ??= [];
      if (group.length < 8) group.push(ink);
    }
  }
  for (let y = 0; y < pixels.height; y++) {
    const row = Math.floor(y / step) * width;
    for (let x = 0; x < pixels.width; x++) {
      const index = row + Math.floor(x / step);
      const reference = references[index];
      const background = backgrounds[reference];
      const offset = (y * pixels.width + x) * 4;
      const boundary = boundaries[index];
      if (boundary >= 0) {
        // At panel edges, preserve the blend between the two papers instead of
        // turning a grey antialiased border into a bright text-colored line.
        const neighbor = backgrounds[boundary];
        const delta = neighbor.color.map((channel, index) => channel - background.color[index]);
        const difference = background.color.map((channel, index) => pixels.data[offset + index] - channel);
        const length = delta.reduce((sum, channel) => sum + channel * channel, 0);
        const alpha = delta.reduce((sum, channel, index) => sum + channel * difference[index], 0) / length;
        if (alpha >= 0 && alpha <= 1 && delta.every((channel, index) => Math.abs(channel * alpha - difference[index]) <= 4)) {
          const from = background.output;
          const to = neighbor.output;
          for (let channel = 0; channel < 3; channel++)
            pixels.data[offset + channel] = Math.round(from[channel] + (to[channel] - from[channel]) * alpha);
          continue;
        }
      }
      const key = (pixels.data[offset] << 16) | (pixels.data[offset + 1] << 8) | pixels.data[offset + 2];
      const cache = mappedColors[reference];
      const cached = cache.get(key);
      if (cached) {
        for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = cached[channel];
        continue;
      }
      const color: Color = [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
      const details = inkDetails(color, background.color);
      let output = palette.text;
      let coverage = Math.max(0, Math.min(1, background.dark
        ? (tone(color) - tone(background.color)) / Math.max(1, 255 - tone(background.color))
        : 1 - tone(color) / Math.max(1, tone(background.color))));
      if (details.strength > 6) {
        let ink = solidColors[reference].get(key);
        coverage = 1;
        if (!ink) {
          // Rounding an edge pixel can shift its hue into a neighboring bucket.
          const buckets = details.bucket === 72 ? [72] :
            [(details.bucket + 71) % 72, details.bucket, (details.bucket + 1) % 72];
          const solid = buckets.flatMap((bucket) => inks[reference][bucket] ?? []);
          const candidates = solid.length ? solid :
            [peaks[reference][details.bucket] ?? { strength: details.strength, color }];
          let closest = Infinity;
          for (const candidate of candidates) {
            const delta = candidate.color.map((channel, index) => channel - background.color[index]);
            const difference = color.map((channel, index) => channel - background.color[index]);
            const length = delta.reduce((sum, channel) => sum + channel * channel, 0);
            const alpha = Math.max(0, Math.min(1, delta.reduce((sum, channel, index) => sum + channel * difference[index], 0) / length));
            const error = delta.reduce((sum, channel, index) => sum + (channel * alpha - difference[index]) ** 2, 0);
            if (error < closest) {
              closest = error;
              ink = candidate;
              coverage = alpha;
            }
          }
          if (closest > 48) {
            // A thin token may never have a solid 2×2 sample. Don't mistake a
            // different ink direction for an edge of the document's main text.
            ink = { strength: details.strength, color };
            coverage = 1;
          }
        }
        ink ??= { strength: details.strength, color };
        const source = inkDetails(ink.color, background.color);
        ink.output ??= themeInk(ink, peaks[reference][source.bucket] ?? ink, background, palette, source.neutral);
        output = ink.output;
      } else {
        coverage = 0;
      }
      for (let channel = 0; channel < 3; channel++)
        pixels.data[offset + channel] = Math.round(background.output[channel] + (output[channel] - background.output[channel]) * coverage);
      if (cache.size < 8192)
        cache.set(key, [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]]);
    }
  }
}
