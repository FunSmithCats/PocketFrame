import { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore, useVideoInfo, useTrimStart, useTrimEnd } from '../../state/store';
import { TIMELINE } from '../../constants/ui';

const { THUMBNAIL_HEIGHT, THUMBNAIL_COUNT, HANDLE_WIDTH, SEEK_THROTTLE_MS } = TIMELINE;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TimelineSlider() {
  const containerRef = useRef<HTMLDivElement>(null);
  const startHandleRef = useRef<HTMLDivElement>(null);
  const endHandleRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const thumbnailUrlsRef = useRef<string[]>([]);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'playhead' | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Refs for throttling
  const lastSeekTimeRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingDragXRef = useRef<number | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const wasPlayingBeforeDragRef = useRef(false);

  const videoInfo = useVideoInfo();
  const videoElement = useAppStore((s) => s.videoElement);
  const currentTime = useAppStore((s) => s.currentTime);
  const trimStart = useTrimStart();
  const trimEnd = useTrimEnd();
  const setTrimStart = useAppStore((s) => s.setTrimStart);
  const setTrimEnd = useAppStore((s) => s.setTrimEnd);
  const setCurrentTime = useAppStore((s) => s.setCurrentTime);
  const setIsScrubbing = useAppStore((s) => s.setIsScrubbing);

  const revokeThumbnailUrls = useCallback((urls: string[]) => {
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const canvasToThumbnailUrl = useCallback((canvas: HTMLCanvasElement) => {
    return new Promise<string>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          // Fallback to data URL when blob encoding fails.
          resolve(canvas.toDataURL('image/jpeg', 0.85));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, 'image/jpeg', 0.85);
    });
  }, []);

  // Track container width
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Extract thumbnails from video
  useEffect(() => {
    if (!videoElement || !videoInfo || videoInfo.duration <= 0) return;
    let cancelled = false;

    const extractThumbnails = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const aspectRatio = videoInfo.width / videoInfo.height;
      const previewHeight = containerRef.current?.clientHeight || THUMBNAIL_HEIGHT;
      const renderScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const thumbHeight = Math.max(THUMBNAIL_HEIGHT, Math.round(previewHeight * renderScale));
      const thumbWidth = Math.max(1, Math.round(thumbHeight * aspectRatio));
      canvas.width = thumbWidth;
      canvas.height = thumbHeight;

      const thumbs: string[] = [];
      const tempVideo = document.createElement('video');
      tempVideo.src = videoInfo.src;
      tempVideo.crossOrigin = 'anonymous';
      tempVideo.muted = true;
      tempVideo.playsInline = true;
      tempVideo.preload = 'auto';

      await new Promise<void>((resolve) => {
        tempVideo.onloadeddata = () => resolve();
        tempVideo.load();
      });

      for (let i = 0; i < THUMBNAIL_COUNT; i++) {
        if (cancelled) return;
        const time = (i / (THUMBNAIL_COUNT - 1)) * videoInfo.duration;
        tempVideo.currentTime = time;

        await new Promise<void>((resolve) => {
          tempVideo.onseeked = () => {
            ctx.drawImage(tempVideo, 0, 0, thumbWidth, thumbHeight);
            canvasToThumbnailUrl(canvas).then((url) => {
              thumbs.push(url);
              resolve();
            });
          };
        });
      }

      if (!cancelled) {
        revokeThumbnailUrls(thumbnailUrlsRef.current);
        thumbnailUrlsRef.current = thumbs;
        setThumbnails(thumbs);
      } else {
        revokeThumbnailUrls(thumbs);
      }
    };

    extractThumbnails();

    return () => {
      cancelled = true;
    };
  }, [videoElement, videoInfo, canvasToThumbnailUrl, revokeThumbnailUrls]);

  // Revoke generated thumbnail URLs on unmount.
  useEffect(() => {
    return () => {
      revokeThumbnailUrls(thumbnailUrlsRef.current);
      thumbnailUrlsRef.current = [];
    };
  }, [revokeThumbnailUrls]);

  // Calculate positions
  const trackWidth = Math.max(0, containerWidth - HANDLE_WIDTH * 2);
  const startPos = trimStart * trackWidth;
  const endPos = trimEnd * trackWidth;

  // Calculate playhead position (relative to full track)
  const duration = videoInfo?.duration || 1;
  const playheadPercent = currentTime / duration;
  const playheadPos = playheadPercent * trackWidth + HANDLE_WIDTH;

  // Throttled seek - prevents overwhelming the video element
  const throttledSeekTo = useCallback((percent: number) => {
    if (!videoElement || !videoInfo) return;

    const now = performance.now();
    const timeSinceLastSeek = now - lastSeekTimeRef.current;

    // Store the pending seek position
    const targetTime = percent * videoInfo.duration;
    pendingSeekRef.current = targetTime;
    setCurrentTime(targetTime);

    // If we can seek now, do it
    if (timeSinceLastSeek >= SEEK_THROTTLE_MS) {
      lastSeekTimeRef.current = now;
      if (typeof videoElement.fastSeek === 'function') {
        videoElement.fastSeek(targetTime);
      } else {
        videoElement.currentTime = targetTime;
      }
      pendingSeekRef.current = null;
    } else {
      // Schedule a seek for later using RAF
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (pendingSeekRef.current !== null && videoElement) {
            lastSeekTimeRef.current = performance.now();
            if (typeof videoElement.fastSeek === 'function') {
              videoElement.fastSeek(pendingSeekRef.current);
            } else {
              videoElement.currentTime = pendingSeekRef.current;
            }
            pendingSeekRef.current = null;
          }
        });
      }
    }
  }, [videoElement, videoInfo, setCurrentTime]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
      }
    };
  }, []);

  const finalizeScrub = useCallback(() => {
    setIsDragging(null);
    setIsScrubbing(false);

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (pendingSeekRef.current !== null && videoElement) {
      if (typeof videoElement.fastSeek === 'function') {
        videoElement.fastSeek(pendingSeekRef.current);
      } else {
        videoElement.currentTime = pendingSeekRef.current;
      }
      setCurrentTime(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }

    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    pendingDragXRef.current = null;

    if (videoElement && wasPlayingBeforeDragRef.current) {
      videoElement.play().catch(() => {
        // Ignore gesture-related play rejections during scrub resume.
      });
    }
    wasPlayingBeforeDragRef.current = false;
  }, [setCurrentTime, setIsScrubbing, videoElement]);

  // Handle dragging start
  const handleMouseDown = useCallback((type: 'start' | 'end' | 'playhead') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(type);
    setIsScrubbing(true);
    wasPlayingBeforeDragRef.current = !!videoElement && !videoElement.paused;

    // Pause video when starting to drag
    if (wasPlayingBeforeDragRef.current && videoElement) {
      videoElement.pause();
    }
  }, [videoElement, setIsScrubbing]);

  // Handle click on track to seek
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !videoElement || !videoInfo || trackWidth <= 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - HANDLE_WIDTH;
    const percent = Math.max(0, Math.min(1, x / trackWidth));

    // Only seek if clicking within the selected range
    if (percent >= trimStart && percent <= trimEnd) {
      throttledSeekTo(percent);
    }
  }, [trackWidth, trimStart, trimEnd, throttledSeekTo, videoElement, videoInfo]);

  const applyDragAt = useCallback((clientX: number) => {
    if (!isDragging || !containerRef.current || !videoInfo || trackWidth <= 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left - HANDLE_WIDTH;
    const percent = Math.max(0, Math.min(1, x / trackWidth));

    if (isDragging === 'start') {
      const newStart = Math.min(percent, trimEnd - TIMELINE.MIN_TRIM_DISTANCE);
      setTrimStart(newStart);
      setCurrentTime(newStart * videoInfo.duration);
      throttledSeekTo(newStart);
    } else if (isDragging === 'end') {
      const newEnd = Math.max(percent, trimStart + TIMELINE.MIN_TRIM_DISTANCE);
      setTrimEnd(newEnd);
      setCurrentTime(newEnd * videoInfo.duration);
      throttledSeekTo(newEnd);
    } else if (isDragging === 'playhead') {
      // Constrain playhead to trim bounds
      const clampedPercent = Math.max(trimStart, Math.min(trimEnd, percent));
      setCurrentTime(clampedPercent * videoInfo.duration);
      throttledSeekTo(clampedPercent);
    }
  }, [isDragging, trackWidth, trimStart, trimEnd, setTrimStart, setTrimEnd, setCurrentTime, throttledSeekTo, videoInfo]);

  const queueDragUpdate = useCallback((clientX: number) => {
    pendingDragXRef.current = clientX;
    if (dragRafRef.current !== null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      if (pendingDragXRef.current !== null) {
        applyDragAt(pendingDragXRef.current);
      }
    });
  }, [applyDragAt]);

  // Handle mouse move during drag
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    queueDragUpdate(e.clientX);
  }, [isDragging, queueDragUpdate]);

  // Handle mouse up - end dragging
  const handleMouseUp = useCallback(() => {
    finalizeScrub();
  }, [finalizeScrub]);

  // Keyboard navigation for handles
  const handleKeyDown = useCallback((type: 'start' | 'end' | 'playhead') => (e: React.KeyboardEvent) => {
    if (!videoInfo) return;

    const step = e.shiftKey ? TIMELINE.KEYBOARD_LARGE_STEP : TIMELINE.KEYBOARD_STEP;
    let handled = true;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        if (type === 'start') {
          const newStart = Math.max(0, trimStart - step);
          setTrimStart(newStart);
          throttledSeekTo(newStart);
        } else if (type === 'end') {
          const newEnd = Math.max(trimStart + TIMELINE.MIN_TRIM_DISTANCE, trimEnd - step);
          setTrimEnd(newEnd);
          throttledSeekTo(newEnd);
        } else if (type === 'playhead' && videoElement) {
          const newPercent = Math.max(trimStart, (videoElement.currentTime / videoInfo.duration) - step);
          throttledSeekTo(newPercent);
        }
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        if (type === 'start') {
          const newStart = Math.min(trimEnd - TIMELINE.MIN_TRIM_DISTANCE, trimStart + step);
          setTrimStart(newStart);
          throttledSeekTo(newStart);
        } else if (type === 'end') {
          const newEnd = Math.min(1, trimEnd + step);
          setTrimEnd(newEnd);
          throttledSeekTo(newEnd);
        } else if (type === 'playhead' && videoElement) {
          const newPercent = Math.min(trimEnd, (videoElement.currentTime / videoInfo.duration) + step);
          throttledSeekTo(newPercent);
        }
        break;
      case 'Home':
        if (type === 'playhead' && videoElement) {
          throttledSeekTo(trimStart);
        }
        break;
      case 'End':
        if (type === 'playhead' && videoElement) {
          throttledSeekTo(trimEnd);
        }
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [videoInfo, videoElement, trimStart, trimEnd, setTrimStart, setTrimEnd, throttledSeekTo]);

  // Touch event handlers
  const handleTouchStart = useCallback((type: 'start' | 'end' | 'playhead') => (e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(type);
    setIsScrubbing(true);
    wasPlayingBeforeDragRef.current = !!videoElement && !videoElement.paused;

    if (wasPlayingBeforeDragRef.current && videoElement) {
      videoElement.pause();
    }
  }, [videoElement, setIsScrubbing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    if (!touch) return;
    queueDragUpdate(touch.clientX);
  }, [isDragging, queueDragUpdate]);

  const handleTouchEnd = useCallback(() => {
    finalizeScrub();
  }, [finalizeScrub]);

  // Add/remove global mouse/touch listeners during drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  if (!videoInfo) return null;

  const startTime = trimStart * duration;
  const endTime = trimEnd * duration;
  const clipDuration = endTime - startTime;

  // Check if playhead is within visible range
  const isPlayheadInRange = playheadPercent >= trimStart && playheadPercent <= trimEnd;

  return (
    <div className="space-y-2">
      {/* Time display */}
      <div className="flex justify-between text-xs text-neutral-500">
        <span>{formatTime(startTime)}</span>
        <span className="text-neutral-400">{formatTime(clipDuration)}</span>
        <span>{formatTime(endTime)}</span>
      </div>

      {/* Timeline track */}
      <div
        ref={containerRef}
        className="relative h-12 bg-neutral-800 rounded overflow-hidden select-none"
        style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
        onClick={handleTrackClick}
      >
        {/* Filmstrip background */}
        <div className="absolute inset-0 flex">
          {thumbnails.map((thumb, i) => (
            <div
              key={i}
              className="h-full flex-1 bg-cover bg-center"
              style={{ backgroundImage: `url(${thumb})` }}
            />
          ))}
          {thumbnails.length === 0 && (
            <div className="w-full h-full bg-neutral-700 animate-pulse" />
          )}
        </div>

        {/* Left dimmed area */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/70 pointer-events-none"
          style={{ width: startPos + HANDLE_WIDTH }}
        />

        {/* Right dimmed area */}
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/70 pointer-events-none"
          style={{ width: trackWidth - endPos + HANDLE_WIDTH }}
        />

        {/* Selection border (top and bottom only) */}
        <div
          className="absolute top-0 bottom-0 border-y-2 border-gb-light pointer-events-none"
          style={{
            left: startPos + HANDLE_WIDTH,
            width: Math.max(0, endPos - startPos),
          }}
        />

        {/* Start handle */}
        <div
          ref={startHandleRef}
          role="slider"
          aria-label="Trim start position"
          aria-valuenow={Math.round(trimStart * 100)}
          aria-valuemin={0}
          aria-valuemax={Math.round((trimEnd - TIMELINE.MIN_TRIM_DISTANCE) * 100)}
          aria-valuetext={`Trim start: ${formatTime(startTime)}`}
          tabIndex={0}
          className={`absolute top-0 bottom-0 cursor-ew-resize flex items-center justify-center z-10 rounded-l focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-inset ${
            isDragging === 'start' ? 'bg-gb-light' : 'bg-neutral-500 hover:bg-neutral-400'
          }`}
          style={{
            left: startPos,
            width: HANDLE_WIDTH,
          }}
          onMouseDown={handleMouseDown('start')}
          onTouchStart={handleTouchStart('start')}
          onKeyDown={handleKeyDown('start')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-0.5 h-5 bg-white/70 rounded-full" />
        </div>

        {/* End handle */}
        <div
          ref={endHandleRef}
          role="slider"
          aria-label="Trim end position"
          aria-valuenow={Math.round(trimEnd * 100)}
          aria-valuemin={Math.round((trimStart + TIMELINE.MIN_TRIM_DISTANCE) * 100)}
          aria-valuemax={100}
          aria-valuetext={`Trim end: ${formatTime(endTime)}`}
          tabIndex={0}
          className={`absolute top-0 bottom-0 cursor-ew-resize flex items-center justify-center z-10 rounded-r focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-inset ${
            isDragging === 'end' ? 'bg-gb-light' : 'bg-neutral-500 hover:bg-neutral-400'
          }`}
          style={{
            left: endPos + HANDLE_WIDTH,
            width: HANDLE_WIDTH,
          }}
          onMouseDown={handleMouseDown('end')}
          onTouchStart={handleTouchStart('end')}
          onKeyDown={handleKeyDown('end')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-0.5 h-5 bg-white/70 rounded-full" />
        </div>

        {/* Playhead */}
        {isPlayheadInRange && (
          <div
            ref={playheadRef}
            role="slider"
            aria-label="Playhead position"
            aria-valuenow={Math.round(playheadPercent * 100)}
            aria-valuemin={Math.round(trimStart * 100)}
            aria-valuemax={Math.round(trimEnd * 100)}
            aria-valuetext={`Current time: ${formatTime(currentTime)}`}
            tabIndex={0}
            className={`absolute top-0 bottom-0 w-1 z-20 cursor-ew-resize focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-light ${
              isDragging === 'playhead' ? 'bg-white' : 'bg-white/90'
            }`}
            style={{
              left: playheadPos - 2,
              boxShadow: '0 0 4px rgba(0,0,0,0.5)',
            }}
            onMouseDown={handleMouseDown('playhead')}
            onTouchStart={handleTouchStart('playhead')}
            onKeyDown={handleKeyDown('playhead')}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Playhead top marker */}
            <div
              className="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0"
              style={{
                borderLeft: '5px solid transparent',
                borderRight: '5px solid transparent',
                borderTop: '6px solid white',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
