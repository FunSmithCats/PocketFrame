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
  // Calculate pixel-aligned sampling (nearest neighbor base)
  vec2 sourcePixel = floor(v_texCoord * u_sourceResolution);
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
  // FIX: Use texture coordinates directly to get position within each source pixel
  // This works correctly regardless of aspect ratio or scale factors
  vec2 gridPos = fract(v_texCoord * u_sourceResolution);

  // Smooth edges for grid lines (8% border on each side)
  float gridX = smoothstep(0.0, 0.08, gridPos.x) * smoothstep(1.0, 0.92, gridPos.x);
  float gridY = smoothstep(0.0, 0.08, gridPos.y) * smoothstep(1.0, 0.92, gridPos.y);
  float gridMask = gridX * gridY;

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
