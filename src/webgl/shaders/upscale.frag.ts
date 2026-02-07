// LCD effect upscale shader with grid, shadows, ghosting, and baseline alpha
export const upscaleFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_previousFrame;
uniform vec2 u_sourceResolution;      // 160x144
uniform vec2 u_targetResolution;      // viewport size

// LCD effect uniforms
uniform float u_gridIntensity;        // 0.0-1.0
uniform float u_shadowOpacity;        // 0.0-1.0
uniform float u_ghostingStrength;     // 0.0-0.5
uniform float u_baselineAlpha;        // 0.0-0.15

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  // Derive source pixel mapping from actual target pixel position so grid aligns with
  // the displayed Game Boy pixel blocks during resize.
  vec2 sourcePixelSize = u_targetResolution / u_sourceResolution;
  // gl_FragCoord is bottom-origin; convert to top-origin to match the rest of the pipeline.
  vec2 targetPixel = vec2(
    gl_FragCoord.x - 0.5,
    u_targetResolution.y - gl_FragCoord.y - 0.5
  );
  vec2 sourcePixel = floor(targetPixel / sourcePixelSize);
  sourcePixel = clamp(sourcePixel, vec2(0.0), u_sourceResolution - vec2(1.0));
  vec2 sampleCoord = (sourcePixel + 0.5) / u_sourceResolution;

  // Sample current frame
  vec4 color = texture(u_texture, sampleCoord);

  // === LCD GHOSTING ===
  // FIX: Flip Y coordinate when sampling previous frame to correct for
  // WebGL framebuffer Y-axis inversion during copyTexture operation
  vec2 prevSampleCoord = vec2(sampleCoord.x, 1.0 - sampleCoord.y);
  vec4 prevColor = texture(u_previousFrame, prevSampleCoord);
  color = mix(color, prevColor, u_ghostingStrength);

  // === PIXEL GRID (DOT MATRIX) ===
  // Build grid in target pixel space so one grid cell always matches one processed pixel.
  // Draw 1-target-pixel grid lines when upscaling is at least 2x; otherwise skip.
  float gridMask = 1.0;
  if (sourcePixelSize.x >= 2.0 && sourcePixelSize.y >= 2.0) {
    vec2 gridPos = mod(targetPixel, sourcePixelSize) / sourcePixelSize;
    vec2 lineWidth = clamp(vec2(1.0) / sourcePixelSize, vec2(0.0), vec2(0.35));
    float lineX = 1.0 - step(lineWidth.x, gridPos.x);
    float lineY = 1.0 - step(lineWidth.y, gridPos.y);
    float lineMask = max(lineX, lineY);
    gridMask = 1.0 - lineMask;
  }

  // Apply grid darkening
  float gridDarkness = 0.15;  // How dark the grid lines are
  color.rgb = mix(color.rgb * gridDarkness, color.rgb, mix(1.0, gridMask, u_gridIntensity));

  // === SHADOW EFFECT ===
  vec2 shadowOffset = vec2(1.0, 1.0);  // Offset in source pixels
  vec2 shadowSampleCoord = (sourcePixel + 0.5 - shadowOffset) / u_sourceResolution;
  vec4 shadowColor = texture(u_texture, shadowSampleCoord);
  float shadowMask = shadowColor.r * u_shadowOpacity * gridMask;
  color.rgb = color.rgb - vec3(shadowMask * 0.15);

  // === BASELINE ALPHA (lift blacks) ===
  color.rgb = max(color.rgb, vec3(u_baselineAlpha));

  fragColor = color;
}
`;
