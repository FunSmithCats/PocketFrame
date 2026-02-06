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
    // For the original video, apply aspect ratio correction
    vec2 uv = v_texCoord;

    // Calculate the relationship between viewport and source aspect ratios
    float viewportAspect = u_viewportAspectRatio;
    float sourceAspect = u_sourceAspectRatio;

    // Fit the source video within the viewport while maintaining aspect ratio
    if (sourceAspect > viewportAspect) {
      // Source is wider than viewport - letterbox (black bars top/bottom)
      float scale = viewportAspect / sourceAspect;
      float offset = (1.0 - scale) * 0.5;
      uv.y = uv.y * scale + offset;

      // Check bounds
      if (uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
    } else if (sourceAspect < viewportAspect) {
      // Source is taller than viewport - pillarbox (black bars left/right)
      float scale = sourceAspect / viewportAspect;
      float offset = (1.0 - scale) * 0.5;
      uv.x = uv.x * scale + offset;

      // Check bounds
      if (uv.x < 0.0 || uv.x > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
    }

    fragColor = texture(u_original, uv);
  } else {
    fragColor = texture(u_processed, v_texCoord);
  }
}
`;
