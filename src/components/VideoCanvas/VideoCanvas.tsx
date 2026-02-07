import { useRef, useEffect, useCallback, useState } from 'react';
import {
  useAppStore,
  useVideoInfo,
  useSplitPosition,
  useContrast,
  useDitherMode,
  usePalette,
  useInvertPalette,
  useTargetFps,
  useAudioHighpass,
  useAudioLowpass,
  useAudioBitDepth,
  useAudioDistortion,
  useLcdGridIntensity,
  useLcdShadowOpacity,
  useLcdGhostingStrength,
  useLcdBaselineAlpha,
  useEnableLcdEffects,
  useTrimStart,
  useTrimEnd,
} from '../../state/store';
import { RenderPipeline } from '../../webgl/pipeline/RenderPipeline';
import { SplitSlider } from './SplitSlider';
import { GameBoyAudioProcessor } from '../../audio/GameBoyAudioProcessor';

interface ImportRequest {
  src: string;
  name: string;
  id: number;
}

interface VideoCanvasProps {
  importRequest: ImportRequest | null;
}

export function VideoCanvas({ importRequest }: VideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipelineRef = useRef<RenderPipeline | null>(null);
  const audioProcessorRef = useRef<GameBoyAudioProcessor | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const currentBlobUrlRef = useRef<string | null>(null);
  const targetFpsRef = useRef<number>(15);
  const splitPositionRef = useRef<number>(0.5);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Error and loading states
  const [webglError, setWebglError] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const videoInfo = useVideoInfo();
  const splitPosition = useSplitPosition();
  const contrast = useContrast();
  const ditherMode = useDitherMode();
  const palette = usePalette();
  const invertPalette = useInvertPalette();
  const targetFps = useTargetFps();

  // Audio settings
  const audioHighpass = useAudioHighpass();
  const audioLowpass = useAudioLowpass();
  const audioBitDepth = useAudioBitDepth();
  const audioDistortion = useAudioDistortion();
  const enableAudioBitcrush = useAppStore((s) => s.enableAudioBitcrush);

  // LCD effect settings
  const lcdGridIntensity = useLcdGridIntensity();
  const lcdShadowOpacity = useLcdShadowOpacity();
  const lcdGhostingStrength = useLcdGhostingStrength();
  const lcdBaselineAlpha = useLcdBaselineAlpha();
  const enableLcdEffects = useEnableLcdEffects();

  // Trim bounds
  const trimStart = useTrimStart();
  const trimEnd = useTrimEnd();
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);

  const setVideoInfo = useAppStore((s) => s.setVideoInfo);
  const setVideoElement = useAppStore((s) => s.setVideoElement);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const setCurrentTime = useAppStore((s) => s.setCurrentTime);

  // Register video element in store for access by other components
  useEffect(() => {
    if (videoRef.current) {
      setVideoElement(videoRef.current);
    }
    return () => {
      setVideoElement(null);
    };
  }, [setVideoElement]);

  // Initialize WebGL pipeline with context loss handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initWebGL = () => {
      const gl = canvas.getContext('webgl2', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });

      if (!gl) {
        console.error('WebGL2 not supported');
        setWebglError('WebGL2 is not supported by your browser. Please try a different browser or update your graphics drivers.');
        return false;
      }

      setWebglError(null);
      pipelineRef.current = new RenderPipeline(gl);
      return true;
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('WebGL context lost');
      setWebglError('Graphics context lost. Attempting to restore...');
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };

    const handleContextRestored = () => {
      console.log('WebGL context restored');
      if (initWebGL()) {
        setWebglError(null);
        // Re-apply current settings from store
        const state = useAppStore.getState();
        pipelineRef.current?.setContrast(state.contrast);
        pipelineRef.current?.setDitherMode(state.ditherMode);
        pipelineRef.current?.setPalette(state.palette);
        pipelineRef.current?.setInvertPalette(state.invertPalette);
        pipelineRef.current?.setLcdEffectsEnabled(state.enableLcdEffects);
        pipelineRef.current?.setGridIntensity(state.lcdGridIntensity);
        pipelineRef.current?.setShadowOpacity(state.lcdShadowOpacity);
        pipelineRef.current?.setGhostingStrength(state.lcdGhostingStrength);
        pipelineRef.current?.setBaselineAlpha(state.lcdBaselineAlpha);
        if (containerRef.current) {
          const { width, height } = containerRef.current.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          pipelineRef.current?.setDisplaySize(width * dpr, height * dpr);
        }
      }
    };

    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    initWebGL();

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, []);

  // Update pipeline settings
  useEffect(() => {
    pipelineRef.current?.setContrast(contrast);
  }, [contrast]);

  useEffect(() => {
    pipelineRef.current?.setDitherMode(ditherMode);
  }, [ditherMode]);

  useEffect(() => {
    pipelineRef.current?.setPalette(palette);
  }, [palette]);

  useEffect(() => {
    pipelineRef.current?.setInvertPalette(invertPalette);
  }, [invertPalette]);

  // Sync LCD effect settings with pipeline
  useEffect(() => {
    if (!pipelineRef.current) return;
    pipelineRef.current.setLcdEffectsEnabled(enableLcdEffects);
    if (enableLcdEffects) {
      pipelineRef.current.setGridIntensity(lcdGridIntensity);
      pipelineRef.current.setShadowOpacity(lcdShadowOpacity);
      pipelineRef.current.setGhostingStrength(lcdGhostingStrength);
      pipelineRef.current.setBaselineAlpha(lcdBaselineAlpha);
    } else {
      // Disable all effects
      pipelineRef.current.setGridIntensity(0);
      pipelineRef.current.setShadowOpacity(0);
      pipelineRef.current.setGhostingStrength(0);
      pipelineRef.current.setBaselineAlpha(0);
    }
  }, [lcdGridIntensity, lcdShadowOpacity, lcdGhostingStrength, lcdBaselineAlpha, enableLcdEffects]);

  // Keep refs in sync with state (prevents render loop restarts)
  useEffect(() => {
    targetFpsRef.current = targetFps;
  }, [targetFps]);

  useEffect(() => {
    splitPositionRef.current = splitPosition;
  }, [splitPosition]);

  useEffect(() => {
    trimStartRef.current = trimStart;
  }, [trimStart]);

  useEffect(() => {
    trimEndRef.current = trimEnd;
  }, [trimEnd]);

  // Keep playback state in sync with the real video element state.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncPlaybackState = () => {
      setIsPlaying(!video.paused && !video.ended);
    };

    video.addEventListener('play', syncPlaybackState);
    video.addEventListener('pause', syncPlaybackState);
    video.addEventListener('ended', syncPlaybackState);
    syncPlaybackState();

    return () => {
      video.removeEventListener('play', syncPlaybackState);
      video.removeEventListener('pause', syncPlaybackState);
      video.removeEventListener('ended', syncPlaybackState);
    };
  }, [setIsPlaying]);

  // Constrain video playback to trim bounds
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoInfo) return;

    const handleTimeUpdate = () => {
      // Don't interfere while user is scrubbing the timeline
      if (useAppStore.getState().isScrubbing) return;

      const duration = videoInfo.duration;
      const trimEndTime = trimEndRef.current * duration;
      const trimStartTime = trimStartRef.current * duration;

      // If video reaches or exceeds trim end, loop back to trim start
      if (video.currentTime >= trimEndTime) {
        video.currentTime = trimStartTime;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [videoInfo]);

  // Handle canvas resize with debouncing to prevent race conditions
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const handleResize = (width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      pipelineRef.current?.setDisplaySize(canvas.width, canvas.height);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;

      // Debounce resize to prevent race conditions during rapid resizing
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = setTimeout(() => {
        handleResize(width, height);
        resizeTimeoutRef.current = null;
      }, 16); // ~60fps debounce
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  // Render loop - runs at display refresh rate for smooth UI
  // Video frames are sampled at target FPS, but display updates every frame
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !pipelineRef.current || !videoInfo) return;

    let needsVideoUpdate = true; // Flag to track if video texture needs update

    const render = (timestamp: number) => {
      animationFrameRef.current = requestAnimationFrame(render);

      if (video.readyState < 2 || !pipelineRef.current) return;

      // Use ref for frame interval to avoid loop restart on FPS change
      const frameInterval = 1000 / targetFpsRef.current;

      // Check if it's time to sample a new video frame
      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed >= frameInterval) {
        // Align to frame interval for smoother timing
        lastFrameTimeRef.current = timestamp - (elapsed % frameInterval);
        needsVideoUpdate = true;
        setCurrentTime(video.currentTime);
      }

      // Always render at display refresh rate for smooth slider animation
      // Only update video texture when a new frame is due
      pipelineRef.current.render(video, splitPositionRef.current, needsVideoUpdate);
      needsVideoUpdate = false;
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [videoInfo, setCurrentTime]);

  // Initialize audio processor
  useEffect(() => {
    audioProcessorRef.current = new GameBoyAudioProcessor();
    return () => {
      audioProcessorRef.current?.dispose();
      audioProcessorRef.current = null;
    };
  }, []);

  // Connect audio processor to video when loaded
  useEffect(() => {
    const video = videoRef.current;
    const audioProcessor = audioProcessorRef.current;
    if (!video || !audioProcessor || !videoInfo) return;

    // Connect on first user interaction to comply with autoplay policies
    const connectAudio = async () => {
      try {
        await audioProcessor.connect(video);
        audioProcessor.setEnabled(enableAudioBitcrush);
        setAudioError(null);
      } catch (err) {
        console.error('Failed to connect audio processor:', err);
        setAudioError('Audio effects unavailable. Video will play without audio processing.');
      }
    };

    connectAudio();
  }, [videoInfo, enableAudioBitcrush]);

  // Sync audio enabled state
  useEffect(() => {
    audioProcessorRef.current?.setEnabled(enableAudioBitcrush);
  }, [enableAudioBitcrush]);

  // Sync audio settings
  useEffect(() => {
    audioProcessorRef.current?.setSettings({
      highpass: audioHighpass,
      lowpass: audioLowpass,
      bitDepth: audioBitDepth,
      distortion: audioDistortion,
    });
  }, [audioHighpass, audioLowpass, audioBitDepth, audioDistortion]);

  // Handle video load with blob URL cleanup
  const handleVideoLoad = useCallback((src: string, name: string) => {
    const video = videoRef.current;
    if (!video) return;

    // Revoke previous blob URL to prevent memory leak
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }

    // Track new blob URL (only if it's a blob URL)
    if (src.startsWith('blob:')) {
      currentBlobUrlRef.current = src;
    }

    setIsVideoLoading(true);
    video.src = src;
    video.load();

    video.onloadedmetadata = () => {
      setIsVideoLoading(false);

      // Update pipeline with source video dimensions for aspect ratio preservation
      if (pipelineRef.current) {
        pipelineRef.current.setSourceVideoInfo(video.videoWidth, video.videoHeight);
      }

      setVideoInfo({
        src,
        name,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        fps: 30, // Default, could be detected
      });

      video.play().catch(console.error);
    };

    video.onerror = () => {
      setIsVideoLoading(false);
    };
  }, [setVideoInfo]);

  // Handle import requests from the main UI.
  useEffect(() => {
    if (!importRequest) return;
    handleVideoLoad(importRequest.src, importRequest.name);
  }, [importRequest, handleVideoLoad]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }
    };
  }, []);

  // Play/pause control with trim bounds check
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoInfo) return;

    if (video.paused) {
      // If current position is outside trim range, jump to trim start
      const trimStartTime = trimStartRef.current * videoInfo.duration;
      const trimEndTime = trimEndRef.current * videoInfo.duration;
      if (video.currentTime < trimStartTime || video.currentTime >= trimEndTime) {
        video.currentTime = trimStartTime;
      }
      video.play().catch(console.error);
    } else {
      video.pause();
    }
  }, [videoInfo]);

  // Keyboard shortcut for play/pause
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Only handle spacebar when the canvas container is focused
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      togglePlay();
    }
  }, [togglePlay]);

  // Dismiss audio error
  const dismissAudioError = useCallback(() => {
    setAudioError(null);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full flex-1 bg-black focus:outline-none"
      tabIndex={videoInfo ? 0 : -1}
      onKeyDown={handleKeyDown}
      role={videoInfo ? 'application' : undefined}
      aria-label={videoInfo ? `Video player - ${isPlaying ? 'playing' : 'paused'}. Press space to ${isPlaying ? 'pause' : 'play'}.` : undefined}
    >
      {/* Video element with audio enabled */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        crossOrigin="anonymous"
      />

      {/* WebGL canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full canvas-container"
        onClick={togglePlay}
        aria-hidden="true"
      />

      {/* WebGL Error State */}
      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/95 z-30">
          <div className="max-w-md p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-red-400 mb-2">Graphics Error</h3>
            <p className="text-sm text-neutral-400">{webglError}</p>
          </div>
        </div>
      )}

      {/* Video Loading State */}
      {isVideoLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 border-2 border-gb-light border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-neutral-400">Loading video...</p>
          </div>
        </div>
      )}

      {/* Audio Error Toast */}
      {audioError && (
        <div
          role="alert"
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-amber-900/90 border border-amber-700 rounded-lg px-4 py-2 flex items-center gap-3 max-w-sm"
        >
          <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-200 flex-1">{audioError}</p>
          <button
            onClick={dismissAudioError}
            className="text-amber-400 hover:text-amber-200 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Split slider (shown when video loaded) */}
      {videoInfo && !webglError && <SplitSlider containerRef={containerRef} />}

      {/* Play/Pause indicator */}
      {videoInfo && !isPlaying && !webglError && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          <div className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      {/* Screen reader status announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {videoInfo && (isPlaying ? 'Video playing' : 'Video paused')}
      </div>
    </div>
  );
}
