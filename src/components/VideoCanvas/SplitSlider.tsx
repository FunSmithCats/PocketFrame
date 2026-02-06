import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore, useSplitPosition, useVideoInfo } from '../../state/store';
import { SPLIT_SLIDER } from '../../constants/ui';

interface SplitSliderProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function calculateViewport(
  containerWidth: number,
  containerHeight: number,
  sourceAspect: number
) {
  const containerAspect = containerWidth / containerHeight;

  if (containerAspect > sourceAspect) {
    // Pillarbox (black bars on sides)
    const height = containerHeight;
    const width = Math.round(height * sourceAspect);
    const x = Math.round((containerWidth - width) / 2);
    return { x, y: 0, width, height };
  } else {
    // Letterbox (black bars top/bottom)
    const width = containerWidth;
    const height = Math.round(width / sourceAspect);
    const y = Math.round((containerHeight - height) / 2);
    return { x: 0, y, width, height };
  }
}

export function SplitSlider({ containerRef }: SplitSliderProps) {
  const splitPosition = useSplitPosition();
  const setSplitPosition = useAppStore((s) => s.setSplitPosition);
  const videoInfo = useVideoInfo();
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const sliderRef = useRef<HTMLDivElement>(null);

  // Calculate source video aspect ratio (default to 16:9 if no video)
  const sourceAspect = useMemo(() => {
    if (!videoInfo) return 16 / 9;
    return videoInfo.width / videoInfo.height;
  }, [videoInfo]);

  // Track container size for viewport calculation
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
    () => calculateViewport(containerSize.width, containerSize.height, sourceAspect),
    [containerSize.width, containerSize.height, sourceAspect]
  );

  // Clamp position to valid range
  const clampPosition = useCallback((value: number) => {
    return Math.max(SPLIT_SLIDER.MIN, Math.min(SPLIT_SLIDER.MAX, value));
  }, []);

  // Calculate position from client X coordinate
  const getPositionFromClientX = useCallback((clientX: number) => {
    if (!containerRef.current || viewport.width === 0) return splitPosition;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const relativeX = (mouseX - viewport.x) / viewport.width;
    return clampPosition(relativeX);
  }, [containerRef, viewport, splitPosition, clampPosition]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    sliderRef.current?.focus();
  }, []);

  // Touch event handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    sliderRef.current?.focus();
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setSplitPosition(getPositionFromClientX(touch.clientX));
  }, [isDragging, setSplitPosition, getPositionFromClientX]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let newPosition = splitPosition;
    const step = e.shiftKey ? SPLIT_SLIDER.KEYBOARD_LARGE_STEP : SPLIT_SLIDER.KEYBOARD_STEP;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newPosition = clampPosition(splitPosition - step);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newPosition = clampPosition(splitPosition + step);
        break;
      case 'Home':
        e.preventDefault();
        newPosition = SPLIT_SLIDER.MIN;
        break;
      case 'End':
        e.preventDefault();
        newPosition = SPLIT_SLIDER.MAX;
        break;
      default:
        return;
    }

    setSplitPosition(newPosition);
  }, [splitPosition, setSplitPosition, clampPosition]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setSplitPosition(getPositionFromClientX(e.clientX));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, setSplitPosition, getPositionFromClientX, handleTouchMove, handleTouchEnd]);

  // Position slider within viewport bounds
  const sliderLeft = viewport.x + splitPosition * viewport.width;

  // Hide labels when slider is near edges to prevent overflow
  const showOriginalLabel = splitPosition > 0.15;
  const showProcessedLabel = splitPosition < 0.85;

  // Convert position to percentage for ARIA
  const percentValue = Math.round(splitPosition * 100);

  return (
    <div
      ref={sliderRef}
      role="slider"
      aria-label="Split comparison position"
      aria-valuenow={percentValue}
      aria-valuemin={Math.round(SPLIT_SLIDER.MIN * 100)}
      aria-valuemax={Math.round(SPLIT_SLIDER.MAX * 100)}
      aria-valuetext={`${percentValue}% - Original on left, Processed on right`}
      tabIndex={0}
      className="absolute w-1 cursor-ew-resize z-10 group focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      style={{
        left: `${sliderLeft}px`,
        top: `${viewport.y}px`,
        height: `${viewport.height}px`,
        transform: 'translateX(-50%)',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onKeyDown={handleKeyDown}
    >
      {/* Line */}
      <div className={`
        absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2
        ${isDragging ? 'bg-gb-light' : 'bg-neutral-400 group-hover:bg-gb-light'}
        transition-colors
      `} />

      {/* Handle */}
      <div className={`
        absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
        w-4 h-12 rounded-full flex items-center justify-center
        ${isDragging ? 'bg-gb-light' : 'bg-neutral-600 group-hover:bg-gb-light'}
        transition-colors
      `}>
        <div className="flex flex-col gap-0.5">
          <div className="w-0.5 h-1 bg-neutral-900 rounded" />
          <div className="w-0.5 h-1 bg-neutral-900 rounded" />
          <div className="w-0.5 h-1 bg-neutral-900 rounded" />
        </div>
      </div>

      {/* Labels - hidden when slider is near edges to prevent overflow */}
      {showOriginalLabel && (
        <div className="absolute top-2 left-0 -translate-x-full pr-2 text-xs text-neutral-500 font-medium whitespace-nowrap transition-opacity">
          Original
        </div>
      )}
      {showProcessedLabel && (
        <div className="absolute top-2 right-0 translate-x-full pl-2 text-xs text-neutral-500 font-medium whitespace-nowrap transition-opacity">
          Processed
        </div>
      )}
    </div>
  );
}
