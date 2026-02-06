// No dither - simple palette quantization
export const noDitherFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec3 u_palette[4];

in vec2 v_texCoord;
out vec4 fragColor;

int quantizeToPaletteIndex(float luminance) {
  // Quantize to 4 levels (0, 1, 2, 3)
  luminance = clamp(luminance, 0.0, 1.0);
  return int(luminance * 3.99);
}

void main() {
  vec4 color = texture(u_texture, v_texCoord);

  // Quantize luminance to palette index
  int paletteIndex = quantizeToPaletteIndex(color.r);

  // Output palette color
  fragColor = vec4(u_palette[paletteIndex], 1.0);
}
`;
