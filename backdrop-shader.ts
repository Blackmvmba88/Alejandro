
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
const vs = `precision highp float;

in vec3 position;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

const fs = `precision highp float;

out vec4 fragmentColor;

uniform vec2 resolution;
uniform float rand;

void main() {
  float aspectRatio = resolution.x / resolution.y; 
  vec2 vUv = gl_FragCoord.xy / resolution;
  float noise = (fract(sin(dot(vUv, vec2(12.9898 + rand,78.233)*2.0)) * 43758.5453));

  vUv -= .5;
  vUv.x *= aspectRatio;

  float factor = 3.5;
  float d = factor * length(vUv);
  
  // Colores más cálidos: un azul profundo hacia un morado/vino cálido
  vec3 from = vec3(15., 10., 30.) / 255.;
  vec3 to = vec3(5., 5., 10.) / 2550.;

  fragmentColor = vec4(mix(from, to, d) + .003 * noise, 1.);
}
`;

export {fs, vs};
