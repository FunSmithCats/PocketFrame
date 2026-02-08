import type { CropRegionNormalized, DitherMode } from '../../state/store';
import type { PaletteName } from '../../palettes';
import { getPaletteAsFloat } from '../../palettes';
import {
  createShader,
  createProgram,
  createTexture,
  createFramebuffer,
  createQuadBuffer,
  setupQuadAttributes,
} from './WebGLUtils';
import { quadVertexShader } from '../shaders/quad.vert';
import { passthroughFragmentShader } from '../shaders/passthrough.frag';
import { downsampleFragmentShader } from '../shaders/downsample.frag';
import { contrastFragmentShader } from '../shaders/contrast.frag';
import { bayer2x2FragmentShader } from '../shaders/dither/bayer2x2.frag';
import { bayer4x4FragmentShader } from '../shaders/dither/bayer4x4.frag';
import { gameBoyCamera4x4FragmentShader } from '../shaders/dither/gameBoyCamera4x4.frag';
import { noDitherFragmentShader } from '../shaders/dither/noDither.frag';
import { upscaleFragmentShader } from '../shaders/upscale.frag';
import { splitFragmentShader } from '../shaders/split.frag';
import { DEFAULT_DISPLAY, PROCESSING_DEFAULTS } from '../../constants';
import { calculateProcessingResolution, calculateLetterboxViewport } from '../../utils';
import type { Viewport } from '../../utils';

export interface SourceVideoInfo {
  width: number;
  height: number;
  aspectRatio: number;
}

interface PassResources {
  program: WebGLProgram;
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export class RenderPipeline {
  private gl: WebGL2RenderingContext;
  private quadBuffer: WebGLBuffer;
  private vertexShader: WebGLShader;

  // Fragment shaders (stored for cleanup)
  private fragmentShaders: WebGLShader[] = [];

  // Video texture
  private videoTexture: WebGLTexture;

  // Pass resources
  private downsamplePass!: PassResources;
  private contrastPass!: PassResources;
  private ditherPass!: PassResources;
  private upscalePass!: PassResources;
  private exportPass!: PassResources;

  // Dither programs
  private noDitherProgram!: WebGLProgram;
  private bayer2x2Program!: WebGLProgram;
  private bayer4x4Program!: WebGLProgram;
  private gameBoyCameraProgram!: WebGLProgram;

  // Split compositor
  private splitProgram!: WebGLProgram;
  private passthroughProgram!: WebGLProgram;

  // Display size (container dimensions)
  private displayWidth = DEFAULT_DISPLAY.WIDTH;
  private displayHeight = DEFAULT_DISPLAY.HEIGHT;

  // Letterbox/pillarbox viewport (where the video actually renders)
  private viewport: Viewport = { x: 0, y: 0, width: DEFAULT_DISPLAY.WIDTH, height: DEFAULT_DISPLAY.HEIGHT };

  // Source video info for aspect ratio preservation
  private sourceVideoInfo: SourceVideoInfo = {
    width: PROCESSING_DEFAULTS.WIDTH,
    height: PROCESSING_DEFAULTS.HEIGHT,
    aspectRatio: PROCESSING_DEFAULTS.ASPECT_RATIO,
  };

  // Dynamic processing resolution (preserves source aspect ratio)
  private processWidth = PROCESSING_DEFAULTS.WIDTH;
  private processHeight = PROCESSING_DEFAULTS.HEIGHT;

  // Current settings
  private currentPalette: PaletteName = '1989Green';
  private currentInvertPalette = false;
  private currentContrast = 1.0;
  private currentCameraResponse = 0.8;
  private currentCropRegion: CropRegionNormalized = { x: 0, y: 0, width: 1, height: 1 };
  private currentDitherMode: DitherMode = 'bayer4x4';

  // LCD effect settings
  private gridIntensity = 0.7;
  private shadowOpacity = 0.35;
  private ghostingStrength = 0.3;
  private baselineAlpha = 0.05;
  private lcdEffectsEnabled = true;

  // Previous frame texture for ghosting effect
  private previousFrameTexture!: WebGLTexture;
  private previousFrameFramebuffer!: WebGLFramebuffer;
  private cpuInputTexture!: WebGLTexture;
  private cpuInputFramebuffer!: WebGLFramebuffer;
  private lastExportFramebuffer!: WebGLFramebuffer;
  private exportPassWidth = this.processWidth;
  private exportPassHeight = this.processHeight;
  private lastOutputWidth = this.processWidth;
  private lastOutputHeight = this.processHeight;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.quadBuffer = createQuadBuffer(gl);
    this.vertexShader = createShader(gl, gl.VERTEX_SHADER, quadVertexShader);
    this.videoTexture = createTexture(gl, 1, 1);
    this.initializePasses();
  }

  private initializePasses(): void {
    const gl = this.gl;

    // Create all fragment shaders and store for cleanup
    const downsampleFS = createShader(gl, gl.FRAGMENT_SHADER, downsampleFragmentShader);
    const contrastFS = createShader(gl, gl.FRAGMENT_SHADER, contrastFragmentShader);
    const noDitherFS = createShader(gl, gl.FRAGMENT_SHADER, noDitherFragmentShader);
    const bayer2x2FS = createShader(gl, gl.FRAGMENT_SHADER, bayer2x2FragmentShader);
    const bayer4x4FS = createShader(gl, gl.FRAGMENT_SHADER, bayer4x4FragmentShader);
    const gameBoyCameraFS = createShader(gl, gl.FRAGMENT_SHADER, gameBoyCamera4x4FragmentShader);
    const upscaleFS = createShader(gl, gl.FRAGMENT_SHADER, upscaleFragmentShader);
    const splitFS = createShader(gl, gl.FRAGMENT_SHADER, splitFragmentShader);
    const passthroughFS = createShader(gl, gl.FRAGMENT_SHADER, passthroughFragmentShader);

    // Store all fragment shaders for cleanup
    this.fragmentShaders = [
      downsampleFS, contrastFS, noDitherFS, bayer2x2FS,
      bayer4x4FS, gameBoyCameraFS, upscaleFS, splitFS, passthroughFS
    ];

    // Create programs
    const downsampleProgram = createProgram(gl, this.vertexShader, downsampleFS);
    const contrastProgram = createProgram(gl, this.vertexShader, contrastFS);
    this.noDitherProgram = createProgram(gl, this.vertexShader, noDitherFS);
    this.bayer2x2Program = createProgram(gl, this.vertexShader, bayer2x2FS);
    this.bayer4x4Program = createProgram(gl, this.vertexShader, bayer4x4FS);
    this.gameBoyCameraProgram = createProgram(gl, this.vertexShader, gameBoyCameraFS);
    const upscaleProgram = createProgram(gl, this.vertexShader, upscaleFS);
    this.splitProgram = createProgram(gl, this.vertexShader, splitFS);
    this.passthroughProgram = createProgram(gl, this.vertexShader, passthroughFS);

    // Create pass resources using initial processing dimensions
    // These will be recreated when setSourceVideoInfo is called

    // Pass 1: Downsample (initial size, will be recreated)
    const downsampleTex = createTexture(gl, this.processWidth, this.processHeight);
    const downsampleFB = createFramebuffer(gl, downsampleTex);
    this.downsamplePass = {
      program: downsampleProgram,
      texture: downsampleTex,
      framebuffer: downsampleFB,
    };

    // Pass 2: Contrast adjustment
    const contrastTex = createTexture(gl, this.processWidth, this.processHeight);
    const contrastFB = createFramebuffer(gl, contrastTex);
    this.contrastPass = {
      program: contrastProgram,
      texture: contrastTex,
      framebuffer: contrastFB,
    };

    // Pass 3: Dither + quantize
    const ditherTex = createTexture(gl, this.processWidth, this.processHeight);
    const ditherFB = createFramebuffer(gl, ditherTex);
    this.ditherPass = {
      program: this.bayer4x4Program,
      texture: ditherTex,
      framebuffer: ditherFB,
    };

    // Pass 4: Upscale for display
    const upscaleTex = createTexture(gl, this.displayWidth, this.displayHeight);
    const upscaleFB = createFramebuffer(gl, upscaleTex);
    this.upscalePass = {
      program: upscaleProgram,
      texture: upscaleTex,
      framebuffer: upscaleFB,
    };

    // Export pass texture (processing resolution, used when LCD effects are applied on export)
    const exportTex = createTexture(gl, this.processWidth, this.processHeight);
    const exportFB = createFramebuffer(gl, exportTex);
    this.exportPass = {
      program: upscaleProgram,
      texture: exportTex,
      framebuffer: exportFB,
    };
    this.exportPassWidth = this.processWidth;
    this.exportPassHeight = this.processHeight;

    // Previous frame texture for ghosting effect (same size as dither output)
    this.previousFrameTexture = createTexture(gl, this.processWidth, this.processHeight);
    this.previousFrameFramebuffer = createFramebuffer(gl, this.previousFrameTexture);
    this.cpuInputTexture = createTexture(gl, this.processWidth, this.processHeight);
    this.cpuInputFramebuffer = createFramebuffer(gl, this.cpuInputTexture);
    this.lastExportFramebuffer = this.ditherPass.framebuffer;
  }

  private recreateProcessingTextures(): void {
    const gl = this.gl;

    // Delete old textures and framebuffers
    gl.deleteTexture(this.downsamplePass.texture);
    gl.deleteFramebuffer(this.downsamplePass.framebuffer);
    gl.deleteTexture(this.contrastPass.texture);
    gl.deleteFramebuffer(this.contrastPass.framebuffer);
    gl.deleteTexture(this.ditherPass.texture);
    gl.deleteFramebuffer(this.ditherPass.framebuffer);
    gl.deleteTexture(this.exportPass.texture);
    gl.deleteFramebuffer(this.exportPass.framebuffer);
    gl.deleteTexture(this.previousFrameTexture);
    gl.deleteFramebuffer(this.previousFrameFramebuffer);
    gl.deleteTexture(this.cpuInputTexture);
    gl.deleteFramebuffer(this.cpuInputFramebuffer);

    // Create new textures with dynamic resolution
    const downsampleTex = createTexture(gl, this.processWidth, this.processHeight);
    const downsampleFB = createFramebuffer(gl, downsampleTex);
    this.downsamplePass.texture = downsampleTex;
    this.downsamplePass.framebuffer = downsampleFB;

    const contrastTex = createTexture(gl, this.processWidth, this.processHeight);
    const contrastFB = createFramebuffer(gl, contrastTex);
    this.contrastPass.texture = contrastTex;
    this.contrastPass.framebuffer = contrastFB;

    const ditherTex = createTexture(gl, this.processWidth, this.processHeight);
    const ditherFB = createFramebuffer(gl, ditherTex);
    this.ditherPass.texture = ditherTex;
    this.ditherPass.framebuffer = ditherFB;

    const exportTex = createTexture(gl, this.processWidth, this.processHeight);
    const exportFB = createFramebuffer(gl, exportTex);
    this.exportPass.texture = exportTex;
    this.exportPass.framebuffer = exportFB;
    this.exportPassWidth = this.processWidth;
    this.exportPassHeight = this.processHeight;

    this.previousFrameTexture = createTexture(gl, this.processWidth, this.processHeight);
    this.previousFrameFramebuffer = createFramebuffer(gl, this.previousFrameTexture);
    this.cpuInputTexture = createTexture(gl, this.processWidth, this.processHeight);
    this.cpuInputFramebuffer = createFramebuffer(gl, this.cpuInputTexture);
    this.lastExportFramebuffer = this.ditherPass.framebuffer;
    this.lastOutputWidth = this.processWidth;
    this.lastOutputHeight = this.processHeight;
  }

  private ensureExportPassSize(width: number, height: number): void {
    if (this.exportPassWidth === width && this.exportPassHeight === height) {
      return;
    }

    const gl = this.gl;
    gl.deleteTexture(this.exportPass.texture);
    gl.deleteFramebuffer(this.exportPass.framebuffer);

    this.exportPass.texture = createTexture(gl, width, height);
    this.exportPass.framebuffer = createFramebuffer(gl, this.exportPass.texture);
    this.exportPassWidth = width;
    this.exportPassHeight = height;
  }

  private refreshViewportAndUpscaleTexture(): void {
    this.viewport = calculateLetterboxViewport(
      this.displayWidth,
      this.displayHeight,
      this.processWidth / this.processHeight,
      {
        sourceWidth: this.processWidth,
        sourceHeight: this.processHeight,
        snapToIntegerScale: true,
      }
    );

    const gl = this.gl;
    gl.deleteTexture(this.upscalePass.texture);
    gl.deleteFramebuffer(this.upscalePass.framebuffer);

    const newTex = createTexture(gl, this.viewport.width, this.viewport.height);
    const newFB = createFramebuffer(gl, newTex);
    this.upscalePass.texture = newTex;
    this.upscalePass.framebuffer = newFB;
  }

  private updateProcessingResolutionForMode(): void {
    const { width: procWidth, height: procHeight } = calculateProcessingResolution(
      this.sourceVideoInfo.width,
      this.sourceVideoInfo.height,
      this.currentDitherMode
    );
    const dimensionsChanged = this.processWidth !== procWidth || this.processHeight !== procHeight;
    this.processWidth = procWidth;
    this.processHeight = procHeight;

    if (dimensionsChanged) {
      this.recreateProcessingTextures();
    }

    this.refreshViewportAndUpscaleTexture();
  }

  setSourceVideoInfo(width: number, height: number): void {
    const aspectRatio = width / height;
    this.sourceVideoInfo = { width, height, aspectRatio };
    this.updateProcessingResolutionForMode();
  }

  getSourceVideoInfo(): SourceVideoInfo {
    return { ...this.sourceVideoInfo };
  }

  setDisplaySize(width: number, height: number): void {
    this.displayWidth = width;
    this.displayHeight = height;
    this.refreshViewportAndUpscaleTexture();
  }

  getViewport(): Viewport {
    return { ...this.viewport };
  }

  setContrast(value: number): void {
    this.currentContrast = value;
  }

  setCameraResponse(value: number): void {
    this.currentCameraResponse = Math.max(0, Math.min(value, 1));
  }

  setCropRegion(region: CropRegionNormalized): void {
    this.currentCropRegion = {
      x: Math.max(0, Math.min(region.x, 1)),
      y: Math.max(0, Math.min(region.y, 1)),
      width: Math.max(0, Math.min(region.width, 1)),
      height: Math.max(0, Math.min(region.height, 1)),
    };
  }

  setDitherMode(mode: DitherMode): void {
    const wasGameBoyCamera = this.currentDitherMode === 'gameBoyCamera';
    const isGameBoyCamera = mode === 'gameBoyCamera';
    this.currentDitherMode = mode;

    if (wasGameBoyCamera !== isGameBoyCamera) {
      this.updateProcessingResolutionForMode();
    }

    switch (mode) {
      case 'none':
        this.ditherPass.program = this.noDitherProgram;
        break;
      case 'bayer2x2':
        this.ditherPass.program = this.bayer2x2Program;
        break;
      case 'bayer4x4':
        this.ditherPass.program = this.bayer4x4Program;
        break;
      case 'floydSteinberg':
        // For preview, fall back to bayer4x4 (CPU implementation for export)
        this.ditherPass.program = this.bayer4x4Program;
        break;
      case 'gameBoyCamera':
        this.ditherPass.program = this.gameBoyCameraProgram;
        break;
    }
  }

  setPalette(name: PaletteName): void {
    this.currentPalette = name;
  }

  setInvertPalette(invert: boolean): void {
    this.currentInvertPalette = invert;
  }

  setLcdEffectsEnabled(enabled: boolean): void {
    this.lcdEffectsEnabled = enabled;
  }

  // LCD effect setters
  setGridIntensity(value: number): void {
    this.gridIntensity = value;
  }

  setShadowOpacity(value: number): void {
    this.shadowOpacity = value;
  }

  setGhostingStrength(value: number): void {
    this.ghostingStrength = value;
  }

  setBaselineAlpha(value: number): void {
    this.baselineAlpha = value;
  }

  updateVideoTexture(video: HTMLVideoElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  private renderPass(
    program: WebGLProgram,
    inputTexture: WebGLTexture,
    framebuffer: WebGLFramebuffer | null,
    width: number,
    height: number,
    setupUniforms?: (gl: WebGL2RenderingContext, program: WebGLProgram) => void
  ): void {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);

    gl.useProgram(program);
    setupQuadAttributes(gl, program, this.quadBuffer);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);

    const texLoc = gl.getUniformLocation(program, 'u_texture');
    if (texLoc) gl.uniform1i(texLoc, 0);

    if (setupUniforms) {
      setupUniforms(gl, program);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private copyTexture(source: WebGLTexture, targetFramebuffer: WebGLFramebuffer, width: number, height: number): void {
    this.renderPass(
      this.passthroughProgram,
      source,
      targetFramebuffer,
      width,
      height
    );
  }

  private applyLcdUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    effectsEnabled: boolean = this.lcdEffectsEnabled
  ): void {
    const sourceLoc = gl.getUniformLocation(program, 'u_sourceResolution');
    const targetLoc = gl.getUniformLocation(program, 'u_targetResolution');
    if (sourceLoc) gl.uniform2f(sourceLoc, sourceWidth, sourceHeight);
    if (targetLoc) gl.uniform2f(targetLoc, targetWidth, targetHeight);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.previousFrameTexture);
    const prevFrameLoc = gl.getUniformLocation(program, 'u_previousFrame');
    if (prevFrameLoc) gl.uniform1i(prevFrameLoc, 1);

    const gridLoc = gl.getUniformLocation(program, 'u_gridIntensity');
    const shadowLoc = gl.getUniformLocation(program, 'u_shadowOpacity');
    const ghostLoc = gl.getUniformLocation(program, 'u_ghostingStrength');
    const baselineLoc = gl.getUniformLocation(program, 'u_baselineAlpha');

    const gridIntensity = effectsEnabled ? this.gridIntensity : 0;
    const shadowOpacity = effectsEnabled ? this.shadowOpacity : 0;
    const ghostingStrength = effectsEnabled ? this.ghostingStrength : 0;
    const baselineAlpha = effectsEnabled ? this.baselineAlpha : 0;

    if (gridLoc) gl.uniform1f(gridLoc, gridIntensity);
    if (shadowLoc) gl.uniform1f(shadowLoc, shadowOpacity);
    if (ghostLoc) gl.uniform1f(ghostLoc, ghostingStrength);
    if (baselineLoc) gl.uniform1f(baselineLoc, baselineAlpha);
  }

  private runSharedBasePasses(video: HTMLVideoElement): void {
    const videoWidth = video.videoWidth || 1;
    const videoHeight = video.videoHeight || 1;

    this.updateVideoTexture(video);

    this.renderPass(
      this.downsamplePass.program,
      this.videoTexture,
      this.downsamplePass.framebuffer,
      this.processWidth,
      this.processHeight,
      (gl, program) => {
        const targetResLoc = gl.getUniformLocation(program, 'u_targetResolution');
        const sourceResLoc = gl.getUniformLocation(program, 'u_sourceResolution');
        const cropOriginLoc = gl.getUniformLocation(program, 'u_cropOrigin');
        const cropSizeLoc = gl.getUniformLocation(program, 'u_cropSize');
        const useCustomCropLoc = gl.getUniformLocation(program, 'u_useCustomCrop');
        if (targetResLoc !== null) gl.uniform2f(targetResLoc, this.processWidth, this.processHeight);
        if (sourceResLoc !== null) gl.uniform2f(sourceResLoc, videoWidth, videoHeight);
        if (cropOriginLoc !== null) gl.uniform2f(cropOriginLoc, this.currentCropRegion.x, this.currentCropRegion.y);
        if (cropSizeLoc !== null) gl.uniform2f(cropSizeLoc, this.currentCropRegion.width, this.currentCropRegion.height);
        if (useCustomCropLoc !== null) gl.uniform1f(useCustomCropLoc, this.currentDitherMode === 'gameBoyCamera' ? 1.0 : 0.0);
      }
    );

    this.renderPass(
      this.contrastPass.program,
      this.downsamplePass.texture,
      this.contrastPass.framebuffer,
      this.processWidth,
      this.processHeight,
      (gl, program) => {
        const contrastLoc = gl.getUniformLocation(program, 'u_contrast');
        const cameraModeLoc = gl.getUniformLocation(program, 'u_cameraMode');
        const cameraResponseLoc = gl.getUniformLocation(program, 'u_cameraResponse');
        if (contrastLoc) gl.uniform1f(contrastLoc, this.currentContrast);
        if (cameraModeLoc) gl.uniform1f(cameraModeLoc, this.currentDitherMode === 'gameBoyCamera' ? 1.0 : 0.0);
        if (cameraResponseLoc) gl.uniform1f(cameraResponseLoc, this.currentCameraResponse);
      }
    );

    const paletteData = getPaletteAsFloat(this.currentPalette, this.currentInvertPalette);
    this.renderPass(
      this.ditherPass.program,
      this.contrastPass.texture,
      this.ditherPass.framebuffer,
      this.processWidth,
      this.processHeight,
      (gl, program) => {
        const resLoc = gl.getUniformLocation(program, 'u_resolution');
        const paletteLoc = gl.getUniformLocation(program, 'u_palette');
        if (resLoc) gl.uniform2f(resLoc, this.processWidth, this.processHeight);
        if (paletteLoc) gl.uniform3fv(paletteLoc, paletteData);
      }
    );

    this.lastExportFramebuffer = this.ditherPass.framebuffer;
  }

  render(video: HTMLVideoElement, splitPosition: number = 0.5, updateVideo: boolean = true): void {
    const gl = this.gl;

    // Validate video dimensions to prevent NaN in shaders
    const videoWidth = video.videoWidth || 1;
    const videoHeight = video.videoHeight || 1;
    const aspectRatio = videoWidth / videoHeight;
    const useOriginalCrop = this.currentDitherMode === 'gameBoyCamera';
    const cropWidthNorm = Math.max(this.currentCropRegion.width, 0);
    const cropHeightNorm = Math.max(this.currentCropRegion.height, 0);
    const croppedWidth = videoWidth * cropWidthNorm;
    const croppedHeight = videoHeight * cropHeightNorm;
    const croppedAspect = croppedWidth / Math.max(croppedHeight, 1e-6);
    const originalAspect = useOriginalCrop && Number.isFinite(croppedAspect) && croppedAspect > 0
      ? croppedAspect
      : aspectRatio;

    // Clamp split position to valid range
    const clampedSplit = Math.max(0.0, Math.min(1.0, splitPosition));

    // Only process video frames when updateVideo is true (throttled to target FPS)
    // This allows the split slider to update at display refresh rate
    if (updateVideo) {
      this.runSharedBasePasses(video);

      // Pass 4: Upscale for display with LCD effects (render to viewport-sized texture)
      this.renderPass(
        this.upscalePass.program,
        this.ditherPass.texture,
        this.upscalePass.framebuffer,
        this.viewport.width,
        this.viewport.height,
        (gl, program) => this.applyLcdUniforms(
          gl,
          program,
          this.processWidth,
          this.processHeight,
          this.viewport.width,
          this.viewport.height
        )
      );

      // Copy current frame to previous frame texture (for next frame's ghosting)
      this.copyTexture(this.ditherPass.texture, this.previousFrameFramebuffer, this.processWidth, this.processHeight);
    }

    // Final pass: Split compositor to screen with letterbox/pillarbox
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Clear entire canvas to black (for letterbox/pillarbox bars)
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Set viewport to letterbox/pillarbox area
    gl.viewport(this.viewport.x, this.viewport.y, this.viewport.width, this.viewport.height);

    gl.useProgram(this.splitProgram);
    setupQuadAttributes(gl, this.splitProgram, this.quadBuffer);

    // Bind original (upscaled video) to texture unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);

    // Bind processed to texture unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.upscalePass.texture);

    const origLoc = gl.getUniformLocation(this.splitProgram, 'u_original');
    const procLoc = gl.getUniformLocation(this.splitProgram, 'u_processed');
    const splitLoc = gl.getUniformLocation(this.splitProgram, 'u_splitPosition');
    const resLoc = gl.getUniformLocation(this.splitProgram, 'u_resolution');
    const sourceAspectLoc = gl.getUniformLocation(this.splitProgram, 'u_sourceAspectRatio');
    const viewportAspectLoc = gl.getUniformLocation(this.splitProgram, 'u_viewportAspectRatio');
    const useOriginalCropLoc = gl.getUniformLocation(this.splitProgram, 'u_useOriginalCrop');
    const originalCropOriginLoc = gl.getUniformLocation(this.splitProgram, 'u_originalCropOrigin');
    const originalCropSizeLoc = gl.getUniformLocation(this.splitProgram, 'u_originalCropSize');

    if (origLoc !== null) gl.uniform1i(origLoc, 0);
    if (procLoc !== null) gl.uniform1i(procLoc, 1);
    if (splitLoc !== null) gl.uniform1f(splitLoc, clampedSplit);
    if (resLoc !== null) gl.uniform2f(resLoc, this.viewport.width, this.viewport.height);
    if (sourceAspectLoc !== null) gl.uniform1f(sourceAspectLoc, originalAspect);
    if (viewportAspectLoc !== null) gl.uniform1f(viewportAspectLoc, this.viewport.width / this.viewport.height);
    if (useOriginalCropLoc !== null) gl.uniform1f(useOriginalCropLoc, useOriginalCrop ? 1.0 : 0.0);
    if (originalCropOriginLoc !== null) {
      gl.uniform2f(originalCropOriginLoc, this.currentCropRegion.x, this.currentCropRegion.y);
    }
    if (originalCropSizeLoc !== null) {
      gl.uniform2f(originalCropSizeLoc, this.currentCropRegion.width, this.currentCropRegion.height);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Render without split (for export)
  renderProcessed(video: HTMLVideoElement, exportScale: number = 1): void {
    this.runSharedBasePasses(video);

    const safeScale = Math.max(1, Math.round(exportScale));
    const targetWidth = this.processWidth * safeScale;
    const targetHeight = this.processHeight * safeScale;
    this.ensureExportPassSize(targetWidth, targetHeight);

    this.renderPass(
      this.exportPass.program,
      this.ditherPass.texture,
      this.exportPass.framebuffer,
      targetWidth,
      targetHeight,
      (gl, program) => this.applyLcdUniforms(
        gl,
        program,
        this.processWidth,
        this.processHeight,
        targetWidth,
        targetHeight
      )
    );
    this.lastExportFramebuffer = this.exportPass.framebuffer;
    this.lastOutputWidth = targetWidth;
    this.lastOutputHeight = targetHeight;

    this.copyTexture(this.ditherPass.texture, this.previousFrameFramebuffer, this.processWidth, this.processHeight);
  }

  renderExportFromPixels(
    pixels: Uint8Array,
    applyLcdEffects: boolean = this.lcdEffectsEnabled,
    exportScale: number = 1
  ): void {
    this.uploadPixelsToCpuTexture(pixels);

    const safeScale = Math.max(1, Math.round(exportScale));
    const targetWidth = this.processWidth * safeScale;
    const targetHeight = this.processHeight * safeScale;
    this.ensureExportPassSize(targetWidth, targetHeight);

    this.renderPass(
      this.exportPass.program,
      this.cpuInputTexture,
      this.exportPass.framebuffer,
      targetWidth,
      targetHeight,
      (gl, program) => this.applyLcdUniforms(
        gl,
        program,
        this.processWidth,
        this.processHeight,
        targetWidth,
        targetHeight,
        applyLcdEffects
      )
    );
    this.lastExportFramebuffer = this.exportPass.framebuffer;
    this.lastOutputWidth = targetWidth;
    this.lastOutputHeight = targetHeight;

    this.copyTexture(this.cpuInputTexture, this.previousFrameFramebuffer, this.processWidth, this.processHeight);
  }

  getContrastPixels(): Uint8Array {
    return this.readPixelsFromFramebuffer(
      this.contrastPass.framebuffer,
      this.processWidth,
      this.processHeight,
      true
    );
  }

  getProcessedPixels(): Uint8Array {
    return this.readPixelsFromFramebuffer(
      this.lastExportFramebuffer,
      this.lastOutputWidth,
      this.lastOutputHeight,
      false
    );
  }

  private uploadPixelsToCpuTexture(pixels: Uint8Array): void {
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.cpuInputTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.processWidth,
      this.processHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
  }

  private readPixelsFromFramebuffer(
    framebuffer: WebGLFramebuffer,
    width: number,
    height: number,
    flipRows: boolean = true
  ): Uint8Array {
    const gl = this.gl;
    const pixels = new Uint8Array(width * height * 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (flipRows) {
      // Flip pixels from bottom-to-top (WebGL) to top-to-bottom (standard image format)
      const rowBytes = width * 4;
      const halfHeight = Math.floor(height / 2);
      const tempRow = new Uint8Array(rowBytes);
      for (let y = 0; y < halfHeight; y++) {
        const topOffset = y * rowBytes;
        const bottomOffset = (height - 1 - y) * rowBytes;
        // Swap rows
        tempRow.set(pixels.subarray(topOffset, topOffset + rowBytes));
        pixels.set(pixels.subarray(bottomOffset, bottomOffset + rowBytes), topOffset);
        pixels.set(tempRow, bottomOffset);
      }
    }

    return pixels;
  }

  getProcessingDimensions(): { width: number; height: number } {
    return { width: this.processWidth, height: this.processHeight };
  }

  getOutputDimensions(): { width: number; height: number } {
    return { width: this.lastOutputWidth, height: this.lastOutputHeight };
  }

  dispose(): void {
    const gl = this.gl;

    gl.deleteBuffer(this.quadBuffer);
    gl.deleteShader(this.vertexShader);
    gl.deleteTexture(this.videoTexture);

    // Delete all fragment shaders
    for (const shader of this.fragmentShaders) {
      gl.deleteShader(shader);
    }
    this.fragmentShaders = [];

    // Delete pass resources
    const passes = [this.downsamplePass, this.contrastPass, this.ditherPass, this.upscalePass];
    for (const pass of passes) {
      gl.deleteProgram(pass.program);
      gl.deleteTexture(pass.texture);
      gl.deleteFramebuffer(pass.framebuffer);
    }
    gl.deleteTexture(this.exportPass.texture);
    gl.deleteFramebuffer(this.exportPass.framebuffer);
    gl.deleteTexture(this.cpuInputTexture);
    gl.deleteFramebuffer(this.cpuInputFramebuffer);

    // Delete previous frame resources for ghosting
    gl.deleteTexture(this.previousFrameTexture);
    gl.deleteFramebuffer(this.previousFrameFramebuffer);

    gl.deleteProgram(this.noDitherProgram);
    gl.deleteProgram(this.bayer2x2Program);
    gl.deleteProgram(this.bayer4x4Program);
    gl.deleteProgram(this.gameBoyCameraProgram);
    gl.deleteProgram(this.splitProgram);
    gl.deleteProgram(this.passthroughProgram);
  }
}
