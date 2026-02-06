// Downsample with nearest neighbor + desaturate
// Processing resolution now matches source aspect ratio, so no correction needed
export const downsampleFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_targetResolution;
uniform vec2 u_sourceResolution;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  // Calculate pixel-aligned sampling for nearest neighbor
  vec2 pixelCoord = floor(v_texCoord * u_targetResolution);
  vec2 uv = (pixelCoord + 0.5) / u_targetResolution;

  vec4 color = texture(u_texture, uv);

  // Convert to luminance (desaturate)
  // Using standard luminance coefficients
  float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  fragColor = vec4(vec3(luminance), color.a);
}
`;
