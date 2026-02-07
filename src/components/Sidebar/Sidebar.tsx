import { useCallback, useId } from 'react';
import {
  useAppStore,
  useContrast,
  useDitherMode,
  usePalette,
  useInvertPalette,
  useVideoInfo,
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
} from '../../state/store';
import { PALETTE_NAMES, type PaletteName } from '../../palettes';
import type { DitherMode } from '../../state/store';
import { Toggle } from '../common/Toggle';
import { SliderControl } from '../common/SliderControl';
import { SLIDERS } from '../../constants/ui';

const DITHER_OPTIONS: { value: DitherMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bayer2x2', label: 'Bayer 2×2' },
  { value: 'bayer4x4', label: 'Bayer 4×4' },
  { value: 'floydSteinberg', label: 'Floyd-Steinberg' },
];

const PALETTE_LABELS: Record<PaletteName, string> = {
  '1989Green': '1989 Green',
  'PocketGrey': 'Pocket Grey',
  'MidnightBlue': 'Midnight Blue',
  'HighContrastBW': 'High Contrast B&W',
  'RedBlack': 'Red & Black',
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">
      {children}
    </h3>
  );
}

interface SidebarProps {
  onImportClick: () => void;
  onExportClick: () => void;
}

export function Sidebar({ onImportClick, onExportClick }: SidebarProps) {
  const videoInfo = useVideoInfo();
  const contrast = useContrast();
  const ditherMode = useDitherMode();
  const palette = usePalette();
  const invertPalette = useInvertPalette();
  const targetFps = useTargetFps();
  const enableAudioBitcrush = useAppStore((s) => s.enableAudioBitcrush);

  const audioHighpass = useAudioHighpass();
  const audioLowpass = useAudioLowpass();
  const audioBitDepth = useAudioBitDepth();
  const audioDistortion = useAudioDistortion();

  // LCD effect settings
  const lcdGridIntensity = useLcdGridIntensity();
  const lcdShadowOpacity = useLcdShadowOpacity();
  const lcdGhostingStrength = useLcdGhostingStrength();
  const lcdBaselineAlpha = useLcdBaselineAlpha();
  const enableLcdEffects = useEnableLcdEffects();

  const setContrast = useAppStore((s) => s.setContrast);
  const setDitherMode = useAppStore((s) => s.setDitherMode);
  const setPalette = useAppStore((s) => s.setPalette);
  const setInvertPalette = useAppStore((s) => s.setInvertPalette);
  const setTargetFps = useAppStore((s) => s.setTargetFps);
  const setEnableAudioBitcrush = useAppStore((s) => s.setEnableAudioBitcrush);
  const setAudioHighpass = useAppStore((s) => s.setAudioHighpass);
  const setAudioLowpass = useAppStore((s) => s.setAudioLowpass);
  const setAudioBitDepth = useAppStore((s) => s.setAudioBitDepth);
  const setAudioDistortion = useAppStore((s) => s.setAudioDistortion);
  const setLcdGridIntensity = useAppStore((s) => s.setLcdGridIntensity);
  const setLcdShadowOpacity = useAppStore((s) => s.setLcdShadowOpacity);
  const setLcdGhostingStrength = useAppStore((s) => s.setLcdGhostingStrength);
  const setLcdBaselineAlpha = useAppStore((s) => s.setLcdBaselineAlpha);
  const setEnableLcdEffects = useAppStore((s) => s.setEnableLcdEffects);

  const ditherId = useId();
  const paletteId = useId();

  const handleDitherChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setDitherMode(e.target.value as DitherMode);
  }, [setDitherMode]);

  const handlePaletteChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setPalette(e.target.value as PaletteName);
  }, [setPalette]);

  const maxFps = videoInfo ? Math.min(Math.round(videoInfo.fps), 60) : 60;

  return (
    <aside className="w-64 flex-shrink-0 bg-neutral-900 border-r border-neutral-800 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* File Info */}
        <section>
          <div className="text-xs text-neutral-500 truncate" title={videoInfo?.name ?? 'No video loaded'}>
            {videoInfo?.name ?? 'No video loaded'}
          </div>
        </section>

        {videoInfo ? (
          <>
            {/* Video Settings */}
            <section>
              <SectionHeader>Video</SectionHeader>
              <div className="space-y-4">
                <SliderControl
                  label="Contrast"
                  value={contrast}
                  min={SLIDERS.CONTRAST.MIN}
                  max={SLIDERS.CONTRAST.MAX}
                  step={SLIDERS.CONTRAST.STEP}
                  onChange={setContrast}
                  displayValue={contrast.toFixed(2)}
                />
                <SliderControl
                  label="Frame Rate"
                  value={targetFps}
                  min={SLIDERS.FRAME_RATE.MIN}
                  max={maxFps}
                  step={SLIDERS.FRAME_RATE.STEP}
                  onChange={(v) => setTargetFps(Math.round(v))}
                  displayValue={`${targetFps} FPS`}
                />
              </div>
            </section>

            {/* Style Settings */}
            <section>
              <SectionHeader>Style</SectionHeader>
              <div className="space-y-3">
                <div>
                  <label htmlFor={ditherId} className="block text-sm text-neutral-300 mb-1">
                    Dither Mode
                  </label>
                  <select
                    id={ditherId}
                    value={ditherMode}
                    onChange={handleDitherChange}
                    aria-label="Dither mode"
                    className="w-full bg-neutral-800 text-sm rounded px-2 py-1.5 border border-neutral-700 focus:border-gb-light focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900"
                  >
                    {DITHER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={paletteId} className="block text-sm text-neutral-300 mb-1">
                    Palette
                  </label>
                  <select
                    id={paletteId}
                    value={palette}
                    onChange={handlePaletteChange}
                    aria-label="Color palette"
                    className="w-full bg-neutral-800 text-sm rounded px-2 py-1.5 border border-neutral-700 focus:border-gb-light focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900"
                  >
                    {PALETTE_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {PALETTE_LABELS[name]}
                      </option>
                    ))}
                  </select>
                </div>

                <Toggle
                  checked={invertPalette}
                  onChange={setInvertPalette}
                  label="Invert Palette"
                />
              </div>
            </section>

            {/* LCD Effects */}
            <section>
              <SectionHeader>LCD Effects</SectionHeader>
              <div className="space-y-3">
                <Toggle
                  checked={enableLcdEffects}
                  onChange={setEnableLcdEffects}
                  label="Enable Effects"
                />

                {enableLcdEffects && (
                  <div className="space-y-4 mt-3 pt-3 border-t border-neutral-800">
                    <SliderControl
                      label="Pixel Grid"
                      value={lcdGridIntensity}
                      min={SLIDERS.LCD_GRID.MIN}
                      max={SLIDERS.LCD_GRID.MAX}
                      step={SLIDERS.LCD_GRID.STEP}
                      onChange={setLcdGridIntensity}
                      displayValue={`${Math.round(lcdGridIntensity * 100)}%`}
                    />
                    <SliderControl
                      label="Shadow"
                      value={lcdShadowOpacity}
                      min={SLIDERS.LCD_SHADOW.MIN}
                      max={SLIDERS.LCD_SHADOW.MAX}
                      step={SLIDERS.LCD_SHADOW.STEP}
                      onChange={setLcdShadowOpacity}
                      displayValue={`${Math.round(lcdShadowOpacity * 100)}%`}
                    />
                    <SliderControl
                      label="Ghosting"
                      value={lcdGhostingStrength}
                      min={SLIDERS.LCD_GHOSTING.MIN}
                      max={SLIDERS.LCD_GHOSTING.MAX}
                      step={SLIDERS.LCD_GHOSTING.STEP}
                      onChange={setLcdGhostingStrength}
                      displayValue={`${Math.round(lcdGhostingStrength * 100)}%`}
                    />
                    <SliderControl
                      label="Black Level"
                      value={lcdBaselineAlpha}
                      min={SLIDERS.LCD_BLACK_LEVEL.MIN}
                      max={SLIDERS.LCD_BLACK_LEVEL.MAX}
                      step={SLIDERS.LCD_BLACK_LEVEL.STEP}
                      onChange={setLcdBaselineAlpha}
                      displayValue={`${Math.round(lcdBaselineAlpha * 100)}%`}
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Audio Settings */}
            <section>
              <SectionHeader>Audio</SectionHeader>
              <div className="space-y-3">
                <Toggle
                  checked={enableAudioBitcrush}
                  onChange={setEnableAudioBitcrush}
                  label="8-bit Mode"
                />

                {enableAudioBitcrush && (
                  <div className="space-y-4 mt-3 pt-3 border-t border-neutral-800">
                    <SliderControl
                      label="Low Cut"
                      value={audioHighpass}
                      min={SLIDERS.AUDIO_HIGHPASS.MIN}
                      max={SLIDERS.AUDIO_HIGHPASS.MAX}
                      step={SLIDERS.AUDIO_HIGHPASS.STEP}
                      onChange={(v) => setAudioHighpass(Math.round(v))}
                      displayValue={`${audioHighpass} Hz`}
                    />
                    <SliderControl
                      label="Brightness"
                      value={audioLowpass}
                      min={SLIDERS.AUDIO_LOWPASS.MIN}
                      max={SLIDERS.AUDIO_LOWPASS.MAX}
                      step={SLIDERS.AUDIO_LOWPASS.STEP}
                      onChange={(v) => setAudioLowpass(Math.round(v))}
                      displayValue={`${audioLowpass} Hz`}
                    />
                    <SliderControl
                      label="Crunch"
                      value={audioBitDepth}
                      min={SLIDERS.AUDIO_BIT_DEPTH.MIN}
                      max={SLIDERS.AUDIO_BIT_DEPTH.MAX}
                      step={SLIDERS.AUDIO_BIT_DEPTH.STEP}
                      onChange={(v) => setAudioBitDepth(Math.round(v))}
                      displayValue={`${audioBitDepth}-bit`}
                    />
                    <SliderControl
                      label="Distort"
                      value={audioDistortion}
                      min={SLIDERS.AUDIO_DISTORTION.MIN}
                      max={SLIDERS.AUDIO_DISTORTION.MAX}
                      step={SLIDERS.AUDIO_DISTORTION.STEP}
                      onChange={(v) => setAudioDistortion(Math.round(v))}
                      displayValue={`${audioDistortion}%`}
                    />
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="rounded border border-neutral-800 bg-neutral-950/70 p-3">
            <SectionHeader>Project</SectionHeader>
            <p className="text-sm text-neutral-500">Import a video to start editing.</p>
          </section>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-neutral-800 space-y-2">
        <button
          onClick={onImportClick}
          className="btn-secondary w-full py-2"
        >
          Import Video
        </button>
        <button
          onClick={onExportClick}
          disabled={!videoInfo}
          className="btn-primary w-full py-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gb-light"
        >
          Export
        </button>
      </div>
    </aside>
  );
}
