type Color = readonly [number, number, number];
type Pixels = { data: Uint8ClampedArray };
type Palette = { base: Color; text: Color };
export type PdfColorMode = "catppuccin" | "invert-lightness" | "original";

// Okular's Change Dark & Light Colors uses Qt qGray, then interpolates
// between the selected foreground and background. Invert Lightness uses HSL.
// https://github.com/KDE/okular/blob/31cdd44495af358eb201b05622c92dfb634ce6ad/gui/pagepainter.cpp#L667-L770
export function adaptPdfColors(
  { data }: Pixels,
  palette: Palette,
  mode: PdfColorMode = "catppuccin",
) {
  if (mode === "original") return;
  if (mode === "invert-lightness") {
    for (let offset = 0; offset < data.length; offset += 4) {
      const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
      // L = (max + min) / 2. This shifts L to 1 - L while retaining hue
      // and saturation, without converting to and from HSL for every pixel.
      const shift = 255 - Math.max(red, green, blue) - Math.min(red, green, blue);
      data[offset] = red + shift;
      data[offset + 1] = green + shift;
      data[offset + 2] = blue + shift;
    }
    return;
  }

  const ramp = new Uint8Array(256 * 3);
  for (let gray = 0; gray < 256; gray++)
    for (let channel = 0; channel < 3; channel++)
      ramp[gray * 3 + channel] = Math.trunc(
        palette.text[channel] + (palette.base[channel] - palette.text[channel]) * gray / 255,
      );
  for (let offset = 0; offset < data.length; offset += 4) {
    // Qt qGray's integer weights. This is brightness, without gamma correction.
    const gray = (data[offset] * 11 + data[offset + 1] * 16 + data[offset + 2] * 5) >> 5;
    data[offset] = ramp[gray * 3];
    data[offset + 1] = ramp[gray * 3 + 1];
    data[offset + 2] = ramp[gray * 3 + 2];
  }
}
