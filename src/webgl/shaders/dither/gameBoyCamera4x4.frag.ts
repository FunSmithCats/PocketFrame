// Game Boy Camera-style 4x4 ordered Bayer dither + palette quantization
export const gameBoyCamera4x4FragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec3 u_palette[4];

in vec2 v_texCoord;
out vec4 fragColor;

// Canonical Bayer 4x4 matrix values [0..15]
const float bayerMatrix[16] = float[16](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

float getBayerValue(ivec2 coord) {
  int index = (coord.x % 4) + (coord.y % 4) * 4;
  return bayerMatrix[index];
}

int quantizeToPaletteIndex(float luma, float matrixValue) {
  float v = clamp(luma, 0.0, 1.0) * 4.0;
  int base = min(int(floor(v)), 3);
  float frac = fract(v);
  float threshold = (matrixValue + 0.5) / 16.0;
  int index = min(base + (frac > threshold ? 1 : 0), 3);
  return index;
}

void main() {
  vec4 color = texture(u_texture, v_texCoord);
  ivec2 pixelCoord = ivec2(v_texCoord * u_resolution);
  float matrixValue = getBayerValue(pixelCoord);
  int paletteIndex = quantizeToPaletteIndex(color.r, matrixValue);
  fragColor = vec4(u_palette[paletteIndex], 1.0);
}
`;
