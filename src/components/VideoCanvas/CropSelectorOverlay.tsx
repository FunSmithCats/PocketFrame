import { useEffect, useMemo, useRef, useState } from 'react';
import { GBCAM_CROP_ASPECT, GBCAM_MIN_CROP_WIDTH_NORM } from '../../constants';
import type { CropRegionNormalized } from '../../state/store';
import {
  calculateLetterboxViewport,
  clampAndNormalizeCrop,
  fromSourcePixels,
  toSourcePixels,
  type CropRegionPixels,
} from '../../utils';

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';
type InteractionMode = 'drag' | 'resize';

interface InteractionState {
  mode: InteractionMode;
  handle?: ResizeHandle;
  startPointer: { x: number; y: number };
  startCrop: CropRegionPixels;
  anchor?: { x: number; y: number };
}

interface CropSelectorOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sourceWidth: number;
  sourceHeight: number;
  cropRegion: CropRegionNormalized;
  onChange: (region: CropRegionNormalized) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getAnchor(startCrop: CropRegionPixels, handle: ResizeHandle): { x: number; y: number } {
  switch (handle) {
    case 'nw':
      return { x: startCrop.x + startCrop.width, y: startCrop.y + startCrop.height };
    case 'ne':
      return { x: startCrop.x, y: startCrop.y + startCrop.height };
    case 'se':
      return { x: startCrop.x, y: startCrop.y };
    case 'sw':
      return { x: startCrop.x + startCrop.width, y: startCrop.y };
  }
}

function getMaxWidthFromAnchor(
  anchor: { x: number; y: number },
  handle: ResizeHandle,
  sourceWidth: number,
  sourceHeight: number
): number {
  switch (handle) {
    case 'nw':
      return Math.min(anchor.x, anchor.y * GBCAM_CROP_ASPECT);
    case 'ne':
      return Math.min(sourceWidth - anchor.x, anchor.y * GBCAM_CROP_ASPECT);
    case 'se':
      return Math.min(sourceWidth - anchor.x, (sourceHeight - anchor.y) * GBCAM_CROP_ASPECT);
    case 'sw':
      return Math.min(anchor.x, (sourceHeight - anchor.y) * GBCAM_CROP_ASPECT);
  }
}

function calculateViewport(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number
) {
  if (containerWidth <= 0 || containerHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return calculateLetterboxViewport(
    containerWidth,
    containerHeight,
    sourceWidth / sourceHeight
  );
}

export function CropSelectorOverlay({
  containerRef,
  sourceWidth,
  sourceHeight,
  cropRegion,
  onChange,
}: CropSelectorOverlayProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const interactionRef = useRef<InteractionState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      setContainerSize({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [containerRef]);

  const viewport = useMemo(
    () => calculateViewport(containerSize.width, containerSize.height, sourceWidth, sourceHeight),
    [containerSize.width, containerSize.height, sourceWidth, sourceHeight]
  );

  const cropPixels = useMemo(
    () => toSourcePixels(cropRegion, sourceWidth, sourceHeight),
    [cropRegion, sourceWidth, sourceHeight]
  );

  const cropLeft = viewport.x + (cropPixels.x / sourceWidth) * viewport.width;
  const cropTop = viewport.y + (cropPixels.y / sourceHeight) * viewport.height;
  const cropWidth = (cropPixels.width / sourceWidth) * viewport.width;
  const cropHeight = (cropPixels.height / sourceHeight) * viewport.height;
  const topMaskHeight = Math.max(0, cropTop - viewport.y);
  const leftMaskWidth = Math.max(0, cropLeft - viewport.x);
  const rightMaskWidth = Math.max(0, viewport.x + viewport.width - (cropLeft + cropWidth));
  const bottomMaskHeight = Math.max(0, viewport.y + viewport.height - (cropTop + cropHeight));

  const previewRectClient = () => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      left: rect.left + viewport.x,
      top: rect.top + viewport.y,
      width: viewport.width,
      height: viewport.height,
    };
  };

  const pointerToSource = (clientX: number, clientY: number) => {
    const preview = previewRectClient();
    if (!preview || preview.width <= 0 || preview.height <= 0) {
      return { x: 0, y: 0 };
    }
    const normX = clamp((clientX - preview.left) / preview.width, 0, 1);
    const normY = clamp((clientY - preview.top) / preview.height, 0, 1);
    return {
      x: normX * sourceWidth,
      y: normY * sourceHeight,
    };
  };

  const commitRegion = (nextRegionPx: CropRegionPixels) => {
    const normalized = fromSourcePixels(nextRegionPx, sourceWidth, sourceHeight);
    onChange(
      clampAndNormalizeCrop(
        normalized,
        sourceWidth,
        sourceHeight,
        GBCAM_MIN_CROP_WIDTH_NORM,
        GBCAM_CROP_ASPECT
      ) as CropRegionNormalized
    );
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startPointer = pointerToSource(e.clientX, e.clientY);
    interactionRef.current = {
      mode: 'drag',
      startPointer,
      startCrop: cropPixels,
    };
    setIsInteracting(true);
  };

  const startResize = (handle: ResizeHandle, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startPointer = pointerToSource(e.clientX, e.clientY);
    interactionRef.current = {
      mode: 'resize',
      handle,
      startPointer,
      startCrop: cropPixels,
      anchor: getAnchor(cropPixels, handle),
    };
    setIsInteracting(true);
  };

  useEffect(() => {
    if (!isInteracting) return;

    const handlePointerMove = (e: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;

      const pointer = pointerToSource(e.clientX, e.clientY);

      if (interaction.mode === 'drag') {
        const dx = pointer.x - interaction.startPointer.x;
        const dy = pointer.y - interaction.startPointer.y;
        const nextX = clamp(interaction.startCrop.x + dx, 0, sourceWidth - interaction.startCrop.width);
        const nextY = clamp(interaction.startCrop.y + dy, 0, sourceHeight - interaction.startCrop.height);
        commitRegion({
          x: nextX,
          y: nextY,
          width: interaction.startCrop.width,
          height: interaction.startCrop.height,
        });
        return;
      }

      if (!interaction.handle || !interaction.anchor) return;
      const anchor = interaction.anchor;
      const widthFromX = Math.abs(pointer.x - anchor.x);
      const widthFromY = Math.abs(pointer.y - anchor.y) * GBCAM_CROP_ASPECT;
      const maxWidth = getMaxWidthFromAnchor(anchor, interaction.handle, sourceWidth, sourceHeight);
      const minWidth = sourceWidth * GBCAM_MIN_CROP_WIDTH_NORM;
      const width = clamp(
        Math.max(widthFromX, widthFromY),
        Math.min(minWidth, maxWidth),
        maxWidth
      );
      const height = width / GBCAM_CROP_ASPECT;

      let nextX = interaction.startCrop.x;
      let nextY = interaction.startCrop.y;

      switch (interaction.handle) {
        case 'nw':
          nextX = anchor.x - width;
          nextY = anchor.y - height;
          break;
        case 'ne':
          nextX = anchor.x;
          nextY = anchor.y - height;
          break;
        case 'se':
          nextX = anchor.x;
          nextY = anchor.y;
          break;
        case 'sw':
          nextX = anchor.x - width;
          nextY = anchor.y;
          break;
      }

      commitRegion({
        x: nextX,
        y: nextY,
        width,
        height,
      });
    };

    const finishInteraction = () => {
      interactionRef.current = null;
      setIsInteracting(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishInteraction);
    window.addEventListener('pointercancel', finishInteraction);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishInteraction);
      window.removeEventListener('pointercancel', finishInteraction);
    };
  }, [isInteracting, sourceWidth, sourceHeight]);

  const handleSize = 12;
  const handleHalf = handleSize / 2;

  if (!viewport.width || !viewport.height) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-20" style={{ touchAction: 'none' }}>
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{ left: viewport.x, top: viewport.y, width: viewport.width, height: topMaskHeight }}
      />
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{ left: viewport.x, top: cropTop, width: leftMaskWidth, height: cropHeight }}
      />
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{
          left: cropLeft + cropWidth,
          top: cropTop,
          width: rightMaskWidth,
          height: cropHeight,
        }}
      />
      <div
        className="absolute bg-black/60 pointer-events-none"
        style={{
          left: viewport.x,
          top: cropTop + cropHeight,
          width: viewport.width,
          height: bottomMaskHeight,
        }}
      />

      <div
        className="absolute border-2 border-gb-light shadow-[0_0_0_1px_rgba(0,0,0,0.6)] cursor-move"
        style={{
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight,
        }}
        onPointerDown={startDrag}
      >
        <div
          className="absolute w-3 h-3 bg-gb-light border border-black cursor-nwse-resize"
          style={{ left: -handleHalf, top: -handleHalf, width: handleSize, height: handleSize }}
          onPointerDown={(e) => startResize('nw', e)}
        />
        <div
          className="absolute w-3 h-3 bg-gb-light border border-black cursor-nesw-resize"
          style={{ right: -handleHalf, top: -handleHalf, width: handleSize, height: handleSize }}
          onPointerDown={(e) => startResize('ne', e)}
        />
        <div
          className="absolute w-3 h-3 bg-gb-light border border-black cursor-nwse-resize"
          style={{ right: -handleHalf, bottom: -handleHalf, width: handleSize, height: handleSize }}
          onPointerDown={(e) => startResize('se', e)}
        />
        <div
          className="absolute w-3 h-3 bg-gb-light border border-black cursor-nesw-resize"
          style={{ left: -handleHalf, bottom: -handleHalf, width: handleSize, height: handleSize }}
          onPointerDown={(e) => startResize('sw', e)}
        />
      </div>
    </div>
  );
}
