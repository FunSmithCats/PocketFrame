// Bayer 4x4 dither + palette quantization
export const bayer4x4FragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec3 u_palette[4];

in vec2 v_texCoord;
out vec4 fragColor;

// Bayer 4x4 matrix (normalized)
const float bayerMatrix[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

float getBayerValue(ivec2 coord) {
  int index = (coord.x % 4) + (coord.y % 4) * 4;
  return bayerMatrix[index];
}

int quantizeToPaletteIndex(float luminance, float dither) {
  // Add dither offset and quantize to 4 levels
  float adjusted = luminance + (dither - 0.5) * 0.25;
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
