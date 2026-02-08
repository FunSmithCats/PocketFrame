import { GBCAM_CROP_ASPECT, GBCAM_MIN_CROP_WIDTH_NORM } from '../constants';

export interface CropRegionNormalizedLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropRegionPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function getDefaultCenteredCrop(
  sourceW: number,
  sourceH: number,
  aspect: number = GBCAM_CROP_ASPECT
): CropRegionNormalizedLike {
  if (!isFinitePositive(sourceW) || !isFinitePositive(sourceH) || !isFinitePositive(aspect)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const sourceAspect = sourceW / sourceH;
  let widthPx: number;
  let heightPx: number;

  if (sourceAspect > aspect) {
    heightPx = sourceH;
    widthPx = heightPx * aspect;
  } else {
    widthPx = sourceW;
    heightPx = widthPx / aspect;
  }

  const xPx = (sourceW - widthPx) * 0.5;
  const yPx = (sourceH - heightPx) * 0.5;

  return {
    x: xPx / sourceW,
    y: yPx / sourceH,
    width: widthPx / sourceW,
    height: heightPx / sourceH,
  };
}

export function toSourcePixels(
  regionNorm: CropRegionNormalizedLike,
  sourceW: number,
  sourceH: number
): CropRegionPixels {
  return {
    x: regionNorm.x * sourceW,
    y: regionNorm.y * sourceH,
    width: regionNorm.width * sourceW,
    height: regionNorm.height * sourceH,
  };
}

export function fromSourcePixels(
  regionPx: CropRegionPixels,
  sourceW: number,
  sourceH: number
): CropRegionNormalizedLike {
  if (!isFinitePositive(sourceW) || !isFinitePositive(sourceH)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  return {
    x: regionPx.x / sourceW,
    y: regionPx.y / sourceH,
    width: regionPx.width / sourceW,
    height: regionPx.height / sourceH,
  };
}

export function clampAndNormalizeCrop(
  region: CropRegionNormalizedLike,
  sourceW: number,
  sourceH: number,
  minWidthNorm: number = GBCAM_MIN_CROP_WIDTH_NORM,
  aspect: number = GBCAM_CROP_ASPECT
): CropRegionNormalizedLike {
  if (!isFinitePositive(sourceW) || !isFinitePositive(sourceH) || !isFinitePositive(aspect)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const defaultCrop = getDefaultCenteredCrop(sourceW, sourceH, aspect);
  const input = {
    x: Number.isFinite(region.x) ? region.x : defaultCrop.x,
    y: Number.isFinite(region.y) ? region.y : defaultCrop.y,
    width: Number.isFinite(region.width) ? region.width : defaultCrop.width,
    height: Number.isFinite(region.height) ? region.height : defaultCrop.height,
  };

  const minWidthPx = Math.max(sourceW * minWidthNorm, 1);
  const maxWidthPx = Math.min(sourceW, sourceH * aspect);
  const inputPx = toSourcePixels(input, sourceW, sourceH);
  const widthFromInput = Math.max(inputPx.width, inputPx.height * aspect);
  const clampedWidthPx = clamp(widthFromInput, Math.min(minWidthPx, maxWidthPx), maxWidthPx);
  const clampedHeightPx = clampedWidthPx / aspect;

  const maxXPx = Math.max(0, sourceW - clampedWidthPx);
  const maxYPx = Math.max(0, sourceH - clampedHeightPx);
  const clampedXPx = clamp(inputPx.x, 0, maxXPx);
  const clampedYPx = clamp(inputPx.y, 0, maxYPx);

  return fromSourcePixels(
    {
      x: clampedXPx,
      y: clampedYPx,
      width: clampedWidthPx,
      height: clampedHeightPx,
    },
    sourceW,
    sourceH
  );
}
