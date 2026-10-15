import assert from "node:assert/strict";
import test from "node:test";
import { adaptPdfColors } from "./pdf-colors.ts";

const palette = { base: [30, 30, 46], text: [205, 214, 244] };
const image = (colors) => ({ data: new Uint8ClampedArray(colors.flatMap((color) => color.length === 4 ? color : [...color, 255])) });
const rgb = (pixels, index = 0) => [...pixels.data.slice(index * 4, index * 4 + 3)];

test("Catppuccin maps black and white to the chosen text and paper colors", () => {
  const pixels = image([[0, 0, 0], [255, 255, 255]]);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(rgb(pixels), palette.text);
  assert.deepEqual(rgb(pixels, 1), palette.base);
});

test("every gray level follows a continuous ramp, including antialiased edges", () => {
  const pixels = image(Array.from({ length: 256 }, (_, value) => [value, value, value]));
  adaptPdfColors(pixels, palette);
  for (let gray = 0; gray < 256; gray++) {
    const color = rgb(pixels, gray);
    const expected = palette.text.map((channel, index) =>
      Math.trunc(channel + (palette.base[index] - channel) * gray / 255));
    assert.deepEqual(color, expected);
    if (gray) color.forEach((channel, index) => {
      assert.ok(channel <= rgb(pixels, gray - 1)[index]);
      assert.ok(rgb(pixels, gray - 1)[index] - channel <= 1);
    });
  }
});

test("colored pixels use Qt qGray weights rather than guessed accent colors", () => {
  const pixels = image([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  adaptPdfColors(pixels, palette);
  // qGray is floor((11R + 16G + 5B) / 32).
  [87, 127, 39].forEach((gray, index) => {
    assert.deepEqual(rgb(pixels, index), palette.text.map((channel, c) =>
      Math.trunc(channel + (palette.base[c] - channel) * gray / 255)));
  });
});

test("equal colors render identically inside text, panels, and large solid regions", () => {
  const colors = [[0, 0, 0], [60, 60, 60], [200, 200, 200], [170, 0, 0]];
  const small = image(colors);
  const large = image(Array.from({ length: 4096 }, (_, index) => colors[index % colors.length]));
  adaptPdfColors(small, palette);
  adaptPdfColors(large, palette);
  for (let index = 0; index < 4096; index++)
    assert.deepEqual(rgb(large, index), rgb(small, index % colors.length));
});

test("a light destination palette uses the same foreground and background mapping", () => {
  const light = { text: [20, 30, 40], base: [240, 245, 250] };
  const pixels = image([[0, 0, 0], [128, 128, 128], [255, 255, 255]]);
  adaptPdfColors(pixels, light);
  assert.deepEqual(rgb(pixels), light.text);
  assert.deepEqual(rgb(pixels, 1), [130, 137, 145]);
  assert.deepEqual(rgb(pixels, 2), light.base);
});

test("invert lightness swaps black and white without swapping red and cyan", () => {
  const pixels = image([[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 170, 0], [17, 83, 200]]);
  adaptPdfColors(pixels, palette, "invert-lightness");
  assert.deepEqual(rgb(pixels), [255, 255, 255]);
  assert.deepEqual(rgb(pixels, 1), [0, 0, 0]);
  assert.deepEqual(rgb(pixels, 2), [255, 0, 0]);
  assert.deepEqual(rgb(pixels, 3), [85, 255, 85]);
  assert.deepEqual(rgb(pixels, 4), [55, 121, 238]);
});

test("invert lightness preserves channel differences and reverses exactly", () => {
  const colors = Array.from({ length: 4096 }, (_, index) => [index % 256, (index * 17) % 256, (index * 43) % 256]);
  const pixels = image(colors);
  const source = pixels.data.slice();
  adaptPdfColors(pixels, palette, "invert-lightness");
  colors.forEach((color, index) => {
    const result = rgb(pixels, index);
    assert.equal(result[0] - result[1], color[0] - color[1]);
    assert.equal(result[1] - result[2], color[1] - color[2]);
    assert.equal(Math.max(...result) + Math.min(...result), 510 - Math.max(...color) - Math.min(...color));
  });
  adaptPdfColors(pixels, palette, "invert-lightness");
  assert.deepEqual(pixels.data, source);
});

test("all modes leave alpha intact, and original mode leaves every byte intact", () => {
  const colors = [[17, 83, 200, 0], [0, 0, 0, 128], [255, 255, 255, 255]];
  for (const mode of ["original", "catppuccin", "invert-lightness"]) {
    const pixels = image(colors);
    const source = pixels.data.slice();
    adaptPdfColors(pixels, palette, mode);
    colors.forEach((color, index) => assert.equal(pixels.data[index * 4 + 3], color[3]));
    if (mode === "original") assert.deepEqual(pixels.data, source);
  }
});
