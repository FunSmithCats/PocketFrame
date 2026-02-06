import { useState, useCallback, useEffect } from 'react';
import { MonolithWindow } from './components/MonolithWindow';
import { VideoCanvas } from './components/VideoCanvas';
import { Sidebar } from './components/Sidebar';
import { TimelineSlider } from './components/TimelineSlider';
import { ExportDialog } from './components/ExportDialog';
import { useAppStore, useVideoInfo } from './state/store';
import { exportVideo, getExportFilename, getExportFilters } from './processing/ExportManager';
import type { ExportFormat } from './state/store';

function App() {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const videoInfo = useVideoInfo();
  const videoElement = useAppStore((s) => s.videoElement);
  const contrast = useAppStore((s) => s.contrast);
  const ditherMode = useAppStore((s) => s.ditherMode);
  const palette = useAppStore((s) => s.palette);
  const enableAudioBitcrush = useAppStore((s) => s.enableAudioBitcrush);
  const audioHighpass = useAppStore((s) => s.audioHighpass);
  const audioLowpass = useAppStore((s) => s.audioLowpass);
  const trimStart = useAppStore((s) => s.trimStart);
  const trimEnd = useAppStore((s) => s.trimEnd);
  const targetFps = useAppStore((s) => s.targetFps);
  const setIsExporting = useAppStore((s) => s.setIsExporting);
  const setExportProgress = useAppStore((s) => s.setExportProgress);

  const handleExportClick = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const handleExport = useCallback(async (format: ExportFormat) => {
    console.log('handleExport called with format:', format);
    console.log('videoInfo:', videoInfo);
    console.log('videoElement:', videoElement);
    console.log('electronAPI available:', !!window.electronAPI);

    setExportError(null);

    if (!videoInfo || !videoElement) {
      const errorMsg = 'No video loaded';
      console.error('Missing videoInfo or videoElement');
      setExportError(errorMsg);
      return;
    }

    // Ask user where to save FIRST
    const filename = getExportFilename(videoInfo.name, format);
    const filters = getExportFilters(format);

    console.log('Requesting save dialog with filename:', filename);

    const savePath = await window.electronAPI?.saveFile({
      defaultPath: filename,
      filters,
    });

    console.log('Save path selected:', savePath);

    // If user cancelled, don't proceed
    if (!savePath) {
      console.log('User cancelled save dialog');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      console.log('Starting export...');
      const blob = await exportVideo(videoElement, {
        format,
        fps: targetFps,
        settings: {
          contrast,
          ditherMode,
          palette,
        },
        enableAudioBitcrush,
        audioSettings: {
          highpass: audioHighpass,
          lowpass: audioLowpass,
        },
        sourceVideoDimensions: {
          width: videoInfo.width,
          height: videoInfo.height,
        },
        trimRange: {
          start: trimStart,
          end: trimEnd,
        },
        onProgress: (p) => {
          console.log('Export progress:', p);
          setExportProgress(p);
        },
      });

      console.log('Export complete, blob size:', blob.size);

      // Write file to selected path
      const arrayBuffer = await blob.arrayBuffer();
      console.log('Writing file to:', savePath);
      const result = await window.electronAPI?.writeFile(savePath, arrayBuffer);

      if (result && !result.success) {
        const errorMsg = `Failed to write file: ${result.error}`;
        console.error(errorMsg);
        setExportError(errorMsg);
      } else {
        console.log('File written successfully!');
        setShowExportDialog(false);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown export error';
      console.error('Export failed:', error);
      setExportError(errorMsg);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [videoInfo, videoElement, contrast, ditherMode, palette, enableAudioBitcrush, audioHighpass, audioLowpass, trimStart, trimEnd, targetFps, setIsExporting, setExportProgress]);

  const handleCloseExportDialog = useCallback(() => {
    setShowExportDialog(false);
    setExportError(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Space to play/pause
      if (e.code === 'Space' && videoElement) {
        e.preventDefault();
        if (videoElement.paused) {
          videoElement.play();
        } else {
          videoElement.pause();
        }
      }

      // E to export
      if (e.code === 'KeyE' && (e.metaKey || e.ctrlKey) && videoInfo) {
        e.preventDefault();
        setShowExportDialog(true);
      }

      // 1-4 to switch palettes
      if (e.code === 'Digit1') {
        useAppStore.getState().setPalette('1989Green');
      } else if (e.code === 'Digit2') {
        useAppStore.getState().setPalette('PocketGrey');
      } else if (e.code === 'Digit3') {
        useAppStore.getState().setPalette('MidnightBlue');
      } else if (e.code === 'Digit4') {
        useAppStore.getState().setPalette('HighContrastBW');
      }

      // D to cycle dither modes
      if (e.code === 'KeyD' && !e.metaKey && !e.ctrlKey) {
        const modes: Array<'none' | 'bayer2x2' | 'bayer4x4' | 'floydSteinberg'> = [
          'none', 'bayer2x2', 'bayer4x4', 'floydSteinberg'
        ];
        const currentMode = useAppStore.getState().ditherMode;
        const currentIndex = modes.indexOf(currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        useAppStore.getState().setDitherMode(modes[nextIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoInfo, videoElement]);

  return (
    <MonolithWindow>
      <Sidebar onExportClick={handleExportClick} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <VideoCanvas />
        {videoInfo && (
          <div className="flex-shrink-0 bg-neutral-900 border-t border-neutral-800 px-4 py-3">
            <TimelineSlider />
          </div>
        )}
      </div>
      <ExportDialog
        isOpen={showExportDialog}
        onClose={handleCloseExportDialog}
        onExport={handleExport}
        error={exportError}
      />
    </MonolithWindow>
  );
}

export default App;
