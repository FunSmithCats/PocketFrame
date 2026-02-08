// Split compositor - shows original on left, processed on right
// Properly handles aspect ratio correction for the original video
export const splitFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_original;
uniform sampler2D u_processed;
uniform float u_splitPosition;
uniform vec2 u_resolution;
uniform float u_sourceAspectRatio;  // Source video width / height
uniform float u_viewportAspectRatio; // Viewport width / height
uniform float u_useOriginalCrop;
uniform vec2 u_originalCropOrigin;
uniform vec2 u_originalCropSize;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  // Draw divider line (2px wide)
  float pixelX = v_texCoord.x * u_resolution.x;
  float splitPixelX = u_splitPosition * u_resolution.x;

  if (abs(pixelX - splitPixelX) < 1.0) {
    fragColor = vec4(0.6, 0.6, 0.6, 1.0);
    return;
  }

  if (v_texCoord.x < u_splitPosition) {
    // For the original side, map viewport UV into comparison UV (0..1)
    // while preserving aspect ratio with letterbox/pillarbox bars.
    vec2 comparisonUv = v_texCoord;

    // Calculate the relationship between viewport and source aspect ratios
    float viewportAspect = u_viewportAspectRatio;
    float sourceAspect = u_sourceAspectRatio;

    // Fit content within viewport while maintaining aspect ratio.
    // If pixel lands in a bar region, output black.
    if (sourceAspect > viewportAspect) {
      // Source is wider than viewport - letterbox (black bars top/bottom)
      float scale = viewportAspect / sourceAspect;
      float offset = (1.0 - scale) * 0.5;
      if (comparisonUv.y < offset || comparisonUv.y > (offset + scale)) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      comparisonUv.y = (comparisonUv.y - offset) / scale;
    } else if (sourceAspect < viewportAspect) {
      // Source is taller than viewport - pillarbox (black bars left/right)
      float scale = sourceAspect / viewportAspect;
      float offset = (1.0 - scale) * 0.5;
      if (comparisonUv.x < offset || comparisonUv.x > (offset + scale)) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      comparisonUv.x = (comparisonUv.x - offset) / scale;
    }

    vec2 sampleUv = comparisonUv;
    if (u_useOriginalCrop > 0.5) {
      sampleUv = u_originalCropOrigin + (comparisonUv * u_originalCropSize);
    }
    sampleUv = clamp(sampleUv, vec2(0.0), vec2(1.0));

    fragColor = texture(u_original, sampleUv);
  } else {
    fragColor = texture(u_processed, v_texCoord);
  }
}
`;
