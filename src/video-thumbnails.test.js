import test from "node:test";
import assert from "node:assert/strict";
import { videoFrameBounds } from "./video-thumbnails.ts";

function frame(width, height, border = 0, color = 48) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= border && x < width - border && y >= border && y < height - border;
    const offset = (y * width + x) * 4;
    data.fill(inside ? color : 4, offset, offset + 3);
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

test("video thumbnails trim the black frame around lecture slides", () => {
  assert.deepEqual(videoFrameBounds(frame(160, 90, 6)), { x: 6, y: 6, width: 148, height: 78 });
});

test("video thumbnails preserve dark scenes, black frames and borderless images", () => {
  for (const color of [0, 16, 24, 48, 255]) {
    assert.deepEqual(videoFrameBounds(frame(160, 90, 0, color)), { x: 0, y: 0, width: 160, height: 90 });
  }
});

test("video thumbnails retain content that reaches an opposing edge", () => {
  const image = frame(160, 90, 6);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 160; x++) image.data.fill(48, (y * 160 + x) * 4, (y * 160 + x) * 4 + 3);
  assert.deepEqual(videoFrameBounds(image), { x: 0, y: 0, width: 160, height: 90 });
});
