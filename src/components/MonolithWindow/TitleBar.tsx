import { useCallback } from 'react';
import { useVideoInfo } from '../../state/store';
import { PROCESSING_DEFAULTS } from '../../constants';

export function TitleBar() {
  const isMac = window.electronAPI?.platform === 'darwin';
  const videoInfo = useVideoInfo();

  const handleMinimize = useCallback(() => {
    window.electronAPI?.minimize();
  }, []);

  const handleMaximize = useCallback(() => {
    window.electronAPI?.maximize();
  }, []);

  const handleClose = useCallback(() => {
    window.electronAPI?.close();
  }, []);

  return (
    <div className="drag-region h-10 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-3 select-none">
      {/* macOS traffic lights space */}
      {isMac && <div className="w-16" />}

      {/* Title */}
      <div className="flex items-center gap-2 flex-1 justify-center">
        <span className="text-gb-light font-semibold text-sm tracking-wide">
          PocketFrame
        </span>
        <span className="text-neutral-500 text-xs">
          {videoInfo
            ? `${videoInfo.width}×${videoInfo.height}`
            : `${PROCESSING_DEFAULTS.WIDTH}×${PROCESSING_DEFAULTS.HEIGHT}`}
        </span>
      </div>

      {/* Windows/Linux controls */}
      {!isMac && (
        <div className="no-drag flex items-center gap-1">
          <button
            onClick={handleMinimize}
            className="w-10 h-8 flex items-center justify-center hover:bg-neutral-700 rounded transition-colors"
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </button>
          <button
            onClick={handleMaximize}
            className="w-10 h-8 flex items-center justify-center hover:bg-neutral-700 rounded transition-colors"
            aria-label="Maximize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
              <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1" />
            </svg>
          </button>
          <button
            onClick={handleClose}
            className="w-10 h-8 flex items-center justify-center hover:bg-red-600 rounded transition-colors"
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
              <line x1="0" y1="0" x2="10" y2="10" />
              <line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        </div>
      )}

      {isMac && <div className="w-16" />}
    </div>
  );
}
