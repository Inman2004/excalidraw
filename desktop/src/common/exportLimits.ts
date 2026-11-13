// Raster export size limits. Chromium refuses canvases wider or taller than
// 16 384 px, and very large ones take seconds to encode, so PNG/JPEG exports
// are scaled down to fit. SVG is vector and never limited.
export const MAX_EXPORT_SIDE = 16384;
export const MAX_EXPORT_PIXELS = 100_000_000;

/** The scale actually used for a `width` × `height` (scale 1) export. */
export const effectiveScale = (width: number, height: number, requested: number) =>
  Math.max(
    0.01,
    Math.min(
      requested,
      MAX_EXPORT_SIDE / Math.max(1, width, height),
      Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, width * height)),
    ),
  );
