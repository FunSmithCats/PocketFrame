import { useCallback, useId, useRef, useEffect, useMemo } from 'react';
import FocusTrap from 'focus-trap-react';
import { useAppStore, useIsExporting, useExportProgress, useVideoInfo } from '../../state/store';
import type { ExportFormat } from '../../state/store';
import { Toggle } from '../common/Toggle';
import { calculateOutputDimensions } from '../../utils';
import { BASE_PIXEL_DENSITY, EXPORT_SCALE } from '../../constants';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat) => void;
  error?: string | null;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'mp4', label: 'MP4 Video', description: 'H.264 encoded, best compatibility' },
  { value: 'gif', label: 'GIF Animation', description: 'Animated GIF, larger file size' },
  { value: 'png', label: 'PNG Sequence', description: 'ZIP bundle of PNG frames' },
];

export function ExportDialog({ isOpen, onClose, onExport, error }: ExportDialogProps) {
  const videoInfo = useVideoInfo();
  const isExporting = useIsExporting();
  const exportProgress = useExportProgress();
  const exportFormat = useAppStore((s) => s.exportFormat);
  const setExportFormat = useAppStore((s) => s.setExportFormat);
  const enableAudioBitcrush = useAppStore((s) => s.enableAudioBitcrush);
  const setEnableAudioBitcrush = useAppStore((s) => s.setEnableAudioBitcrush);
  const ditherMode = useAppStore((s) => s.ditherMode);

  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Calculate output dimensions based on source video and format
  const outputDimensions = useMemo(() => {
    if (!videoInfo) return { width: BASE_PIXEL_DENSITY * EXPORT_SCALE.HIGH_QUALITY, height: BASE_PIXEL_DENSITY * EXPORT_SCALE.HIGH_QUALITY };
    return calculateOutputDimensions(videoInfo.width, videoInfo.height, exportFormat, ditherMode);
  }, [videoInfo, exportFormat, ditherMode]);

  const handleExport = useCallback(() => {
    onExport(exportFormat);
  }, [exportFormat, onExport]);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isOpen || isExporting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen}>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          ref={dialogRef}
          className="bg-neutral-900 rounded-lg border border-neutral-800 w-full max-w-md mx-4 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-neutral-800">
            <h2 id={titleId} className="text-lg font-semibold">Export</h2>
          {!isExporting && (
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {isExporting ? (
            <div className="py-8">
              <div className="text-center mb-4">
                <div className="text-sm text-neutral-400">Exporting...</div>
                <div className="text-2xl font-bold text-gb-light mt-1">
                  {Math.round(exportProgress * 100)}%
                </div>
              </div>
              <div
                role="progressbar"
                aria-valuenow={Math.round(exportProgress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Export progress"
                className="w-full bg-neutral-800 rounded-full h-2"
              >
                <div
                  className="bg-gb-light h-2 rounded-full transition-all duration-200"
                  style={{ width: `${exportProgress * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Format selection */}
              <div>
                <label className="block text-sm text-neutral-400 mb-2">Format</label>
                <div className="space-y-2">
                  {FORMAT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={`
                        flex items-start p-3 rounded-lg border cursor-pointer transition-colors
                        ${exportFormat === option.value
                          ? 'border-gb-light bg-gb-light/10'
                          : 'border-neutral-700 hover:border-neutral-600'
                        }
                      `}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={option.value}
                        checked={exportFormat === option.value}
                        onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                        className="sr-only"
                      />
                      <div className={`
                        w-4 h-4 rounded-full border-2 mr-3 mt-0.5 flex-shrink-0
                        ${exportFormat === option.value
                          ? 'border-gb-light bg-gb-light'
                          : 'border-neutral-500'
                        }
                      `}>
                        {exportFormat === option.value && (
                          <div className="w-full h-full rounded-full bg-neutral-900 scale-50" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-neutral-500">{option.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Audio options (for MP4) */}
              {exportFormat === 'mp4' && (
                <div className="pt-2">
                  <Toggle
                    checked={enableAudioBitcrush}
                    onChange={setEnableAudioBitcrush}
                    label="Audio bitcrush (8-bit, 22kHz mono)"
                  />
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm text-red-300">
                  <div className="font-medium mb-1">Export failed</div>
                  <div className="text-red-400 text-xs">{error}</div>
                </div>
              )}

              {/* Info */}
              <div className="bg-neutral-800/50 rounded-lg p-3 text-xs text-neutral-400">
                <div className="flex justify-between mb-1">
                  <span>Output resolution:</span>
                  <span className="text-neutral-200">{outputDimensions.width} × {outputDimensions.height}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span>Source:</span>
                  <span className="text-neutral-200">{videoInfo?.width} × {videoInfo?.height}</span>
                </div>
                <div className="flex justify-between">
                  <span>Duration:</span>
                  <span className="text-neutral-200">{videoInfo?.duration.toFixed(1)}s</span>
                </div>
              </div>
            </>
          )}
        </div>

          {/* Footer */}
          {!isExporting && (
            <div className="flex justify-end gap-3 p-4 border-t border-neutral-800">
              <button onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleExport} className="btn-primary">
                Export
              </button>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}
