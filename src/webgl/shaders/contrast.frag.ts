// Contrast adjustment shader
export const contrastFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_contrast;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_texture, v_texCoord);

  // Apply contrast centered at 0.5
  vec3 adjusted = (color.rgb - 0.5) * u_contrast + 0.5;
  adjusted = clamp(adjusted, 0.0, 1.0);

  fragColor = vec4(adjusted, color.a);
}
`;
