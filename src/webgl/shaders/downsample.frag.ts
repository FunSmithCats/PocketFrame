// Downsample with nearest neighbor + desaturate
// Processing resolution now matches source aspect ratio, so no correction needed
export const downsampleFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_targetResolution;
uniform vec2 u_sourceResolution;
uniform vec2 u_cropOrigin;
uniform vec2 u_cropSize;
uniform float u_useCustomCrop;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  // Calculate pixel-aligned sampling for nearest neighbor
  vec2 pixelCoord = floor(v_texCoord * u_targetResolution);
  vec2 uv = (pixelCoord + 0.5) / u_targetResolution;

  vec2 sampleUv = uv;
  if (u_useCustomCrop > 0.5) {
    sampleUv = u_cropOrigin + uv * u_cropSize;
  } else {
    // Center-crop source to fill target aspect ratio without stretching.
    float sourceAspect = u_sourceResolution.x / u_sourceResolution.y;
    float targetAspect = u_targetResolution.x / u_targetResolution.y;

    if (sourceAspect > targetAspect) {
      float scale = targetAspect / sourceAspect;
      float offset = (1.0 - scale) * 0.5;
      sampleUv.x = offset + uv.x * scale;
    } else if (sourceAspect < targetAspect) {
      float scale = sourceAspect / targetAspect;
      float offset = (1.0 - scale) * 0.5;
      sampleUv.y = offset + uv.y * scale;
    }
  }
  sampleUv = clamp(sampleUv, vec2(0.0), vec2(1.0));

  vec4 color = texture(u_texture, sampleUv);

  // Convert to luminance (desaturate)
  // Using standard luminance coefficients
  float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  fragColor = vec4(vec3(luminance), color.a);
}
`;
