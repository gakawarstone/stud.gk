import assert from "node:assert/strict";
import test from "node:test";
import { adaptPdfColors } from "./pdf-colors.ts";

const red = [243, 139, 168], green = [166, 227, 161], blue = [137, 180, 250];
const mauve = [203, 166, 247], pink = [245, 194, 231];
const palette = {
  base: [30, 30, 46], text: [205, 214, 244], subtext: [166, 173, 200], surface: [49, 50, 68],
  accents: [red, [250, 179, 135], [249, 226, 175], green, [148, 226, 213], [137, 220, 235], blue, mauve, pink],
};
const white = [255, 255, 255];
const black = [0, 0, 0];

function image(background, width = 160, height = 120) {
  const result = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  fill(result, 0, 0, width, height, background);
  return result;
}

function fill(pixels, x, y, width, height, color) {
  for (let row = y; row < y + height; row++)
    for (let column = x; column < x + width; column++)
      pixels.data.set([...color, 255], (row * pixels.width + column) * 4);
}

function at(pixels, x, y) {
  return [...pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3)];
}

function luminance(color) {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

test("light paper and black text use the theme with smooth neutral antialiasing", () => {
  const pixels = image(white);
  fill(pixels, 20, 20, 3, 12, black);
  fill(pixels, 23, 20, 1, 12, [128, 128, 128]);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(at(pixels, 0, 0), palette.base);
  assert.deepEqual(at(pixels, 21, 21), palette.text);
  const edge = at(pixels, 23, 21);
  edge.forEach((channel, index) => {
    assert.ok(channel > palette.base[index] && channel < palette.text[index]);
  });
  assert.equal(pixels.data[3], 255);
});

test("an already dark PDF uses Mocha without inverting its background or text", () => {
  const pixels = image([40, 42, 54]);
  fill(pixels, 20, 20, 3, 12, white);
  fill(pixels, 30, 20, 3, 12, [255, 85, 85]);
  fill(pixels, 40, 20, 3, 12, [80, 250, 123]);
  fill(pixels, 50, 20, 3, 12, [189, 147, 249]);
  fill(pixels, 53, 20, 1, 12, [115, 95, 152]);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(at(pixels, 0, 0), palette.base);
  assert.deepEqual(at(pixels, 21, 21), palette.text);
  assert.deepEqual(at(pixels, 31, 21), red);
  assert.deepEqual(at(pixels, 41, 21), green);
  assert.deepEqual(at(pixels, 51, 21), mauve);
  at(pixels, 53, 21).forEach((channel, index) => {
    assert.ok(Math.abs(channel - Math.round((palette.base[index] + mauve[index]) / 2)) <= 1);
  });
});

test("large solid letter strokes are foreground rather than small paper regions", () => {
  const light = image(white);
  fill(light, 20, 20, 14, 48, black);
  adaptPdfColors(light, palette);
  assert.deepEqual(at(light, 21, 21), palette.text);
  const dark = image([40, 42, 54]);
  fill(dark, 20, 20, 14, 48, white);
  adaptPdfColors(dark, palette);
  assert.deepEqual(at(dark, 0, 0), palette.base);
  assert.deepEqual(at(dark, 21, 21), palette.text);
});

test("a dark code block on light paper keeps light text and separate accent colors", () => {
  const pixels = image(white);
  fill(pixels, 20, 40, 120, 50, [30, 30, 46]);
  fill(pixels, 30, 55, 3, 12, white);
  fill(pixels, 40, 55, 3, 12, [203, 166, 247]);
  fill(pixels, 50, 55, 3, 12, [166, 227, 161]);
  fill(pixels, 30, 15, 3, 12, black);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(at(pixels, 0, 0), palette.base);
  assert.deepEqual(at(pixels, 31, 16), palette.text);
  assert.deepEqual(at(pixels, 21, 41), palette.surface);
  assert.deepEqual(at(pixels, 31, 56), palette.text);
  assert.deepEqual(at(pixels, 41, 56), [203, 166, 247]);
  assert.deepEqual(at(pixels, 51, 56), [166, 227, 161]);
});

test("colored syntax on light paper retains distinct hues with readable contrast", () => {
  const pixels = image(white);
  const colors = [[170, 0, 0], [0, 100, 0], [0, 0, 170], [128, 0, 128]];
  colors.forEach((color, index) => fill(pixels, 20 + index * 20, 20, 3, 12, color));
  adaptPdfColors(pixels, palette);
  const result = colors.map((_, index) => at(pixels, 21 + index * 20, 21));
  assert.equal(new Set(result.map(String)).size, colors.length);
  result.forEach((color) => {
    assert.ok((luminance(color) + 0.05) / (luminance(palette.base) + 0.05) >= 4.5);
  });
  assert.ok(result[0][0] > result[0][1] && result[0][0] > result[0][2]);
  assert.ok(result[1][1] > result[1][0] && result[1][1] > result[1][2]);
  assert.ok(result[2][2] > result[2][0] && result[2][2] > result[2][1]);
  assert.deepEqual(result[3], pink);
  assert.ok(result[3][0] > result[3][1]);
});

test("pale code panels on white paper remain separate from the page background", () => {
  const pixels = image(white);
  fill(pixels, 20, 40, 120, 50, [245, 245, 245]);
  fill(pixels, 30, 55, 3, 12, black);
  fill(pixels, 40, 55, 3, 12, [0, 100, 0]);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(at(pixels, 0, 0), palette.base);
  assert.deepEqual(at(pixels, 21, 41), palette.surface);
  assert.deepEqual(at(pixels, 31, 56), palette.text);
  assert.deepEqual(at(pixels, 41, 56), green);
});

test("colored antialiasing blends with the new background rather than leaving white halos", () => {
  const pixels = image(white);
  fill(pixels, 20, 20, 3, 12, [170, 0, 0]);
  fill(pixels, 23, 20, 1, 12, [213, 128, 128]);
  adaptPdfColors(pixels, palette);
  const solid = at(pixels, 21, 21);
  const edge = at(pixels, 23, 21);
  edge.forEach((channel, index) => {
    const expected = Math.round((palette.base[index] + solid[index]) / 2);
    assert.ok(Math.abs(channel - expected) <= 1);
  });
});

test("solid tokens with the same hue keep different shades and readable contrast", () => {
  const pixels = image(white);
  fill(pixels, 20, 20, 3, 12, [0, 50, 0]);
  fill(pixels, 40, 20, 3, 12, [0, 128, 0]);
  fill(pixels, 23, 20, 1, 12, [128, 153, 128]);
  adaptPdfColors(pixels, palette);
  const darker = at(pixels, 21, 21);
  const lighter = at(pixels, 41, 21);
  assert.notDeepEqual(darker, lighter);
  assert.ok(darker[1] < lighter[1]);
  for (const color of [darker, lighter])
    assert.ok((luminance(color) + 0.05) / (luminance(palette.base) + 0.05) >= 4.5);
  at(pixels, 23, 21).forEach((channel, index) => {
    const expected = Math.round((palette.base[index] + darker[index]) / 2);
    assert.ok(Math.abs(channel - expected) <= 1);
  });
});

test("background detection also works at high pixel density and zoom", () => {
  const pixels = image(white, 1800, 1200);
  fill(pixels, 240, 300, 1200, 450, [40, 42, 54]);
  fill(pixels, 280, 340, 6, 24, [255, 85, 85]);
  fill(pixels, 280, 120, 6, 24, black);
  adaptPdfColors(pixels, palette, 2);
  assert.deepEqual(at(pixels, 0, 0), palette.base);
  assert.deepEqual(at(pixels, 281, 121), palette.text);
  assert.deepEqual(at(pixels, 241, 301), palette.surface);
  assert.deepEqual(at(pixels, 281, 341), red);
});

test("panel edges between analysis samples keep their colors without bright antialiasing halos", () => {
  const pixels = image(white, 1800, 1200);
  fill(pixels, 241, 301, 1200, 450, [40, 42, 54]);
  fill(pixels, 241, 301, 1200, 1, [148, 149, 155]);
  adaptPdfColors(pixels, palette, 2);
  assert.deepEqual(at(pixels, 241, 302), palette.surface);
  assert.deepEqual(at(pixels, 240, 302), palette.base);
  assert.deepEqual(at(pixels, 1440, 302), palette.surface);
  assert.deepEqual(at(pixels, 1441, 302), palette.base);
  at(pixels, 400, 301).forEach((channel, index) => {
    const expected = Math.round((palette.base[index] + palette.surface[index]) / 2);
    assert.ok(Math.abs(channel - expected) <= 1);
  });
});

test("the Kotlin slides' Nord colors become distinct Mocha surfaces, tokens and readable comments", () => {
  const pixels = image([46, 52, 64]);
  fill(pixels, 20, 40, 120, 60, [67, 76, 94]);
  const tokens = [[216, 222, 233], [129, 161, 193], [163, 190, 140], [97, 110, 136], [180, 142, 173]];
  tokens.forEach((color, index) => fill(pixels, 30 + index * 20, 50, 3, 12, color));
  fill(pixels, 30, 75, 1, 12, [97, 110, 136]);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(at(pixels, 0, 0), palette.base);
  assert.deepEqual(at(pixels, 21, 41), palette.surface);
  const expected = [palette.text, blue, green, palette.subtext, pink];
  expected.forEach((color, index) => assert.deepEqual(at(pixels, 31 + index * 20, 51), color));
  assert.deepEqual(at(pixels, 30, 76), palette.subtext);
  assert.ok((luminance(palette.subtext) + 0.05) / (luminance(palette.surface) + 0.05) >= 4.5);
});

test("Mocha text edges keep the correct opacity when rounding moves their hue to another bucket", () => {
  const pixels = image(palette.base);
  fill(pixels, 20, 40, 120, 60, palette.surface);
  fill(pixels, 30, 50, 3, 12, palette.text);
  fill(pixels, 33, 50, 1, 12, [127, 132, 156]);
  fill(pixels, 50, 50, 3, 12, palette.subtext);
  adaptPdfColors(pixels, palette);
  assert.deepEqual(at(pixels, 21, 41), palette.surface);
  assert.deepEqual(at(pixels, 31, 51), palette.text);
  assert.deepEqual(at(pixels, 51, 51), palette.subtext);
  assert.deepEqual(at(pixels, 33, 51), [127, 132, 156]);
});
