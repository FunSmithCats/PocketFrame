// Contrast adjustment shader
export const contrastFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_contrast;
uniform float u_cameraMode;
uniform float u_cameraResponse;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 color = texture(u_texture, v_texCoord);

  float luma = color.r;

  if (u_cameraMode > 0.5) {
    float windowed = clamp((luma - 0.08) / 0.78, 0.0, 1.0);
    float shaped = smoothstep(0.0, 1.0, windowed);
    shaped = pow(shaped, 1.25);
    luma = mix(luma, shaped, clamp(u_cameraResponse, 0.0, 1.0));
  }

  // Apply contrast centered at 0.5
  vec3 adjusted = (vec3(luma) - 0.5) * u_contrast + 0.5;
  adjusted = clamp(adjusted, 0.0, 1.0);

  fragColor = vec4(adjusted, color.a);
}
`;
