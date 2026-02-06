// Bayer 2x2 dither + palette quantization
export const bayer2x2FragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec3 u_palette[4];

in vec2 v_texCoord;
out vec4 fragColor;

// Bayer 2x2 matrix (normalized)
const float bayerMatrix[4] = float[4](
  0.0 / 4.0, 2.0 / 4.0,
  3.0 / 4.0, 1.0 / 4.0
);

float getBayerValue(ivec2 coord) {
  int index = (coord.x % 2) + (coord.y % 2) * 2;
  return bayerMatrix[index];
}

int quantizeToPaletteIndex(float luminance, float dither) {
  // Add dither offset and quantize to 4 levels
  float adjusted = luminance + (dither - 0.5) * 0.33;
  adjusted = clamp(adjusted, 0.0, 1.0);

  // Quantize to 4 levels (0, 1, 2, 3)
  return int(adjusted * 3.99);
}

void main() {
  vec4 color = texture(u_texture, v_texCoord);

  // Get pixel coordinate
  ivec2 pixelCoord = ivec2(v_texCoord * u_resolution);

  // Get dither value
  float dither = getBayerValue(pixelCoord);

  // Quantize luminance to palette index
  int paletteIndex = quantizeToPaletteIndex(color.r, dither);

  // Output palette color
  fragColor = vec4(u_palette[paletteIndex], 1.0);
}
`;
