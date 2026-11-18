/**
 * GLSL for the scene. Written for three.js ShaderMaterial (WebGL2): three prepends
 * the matrices, `cameraPosition`, and the tone-mapping / colour-space functions.
 *
 * Colours are linear; ACES filmic tone mapping happens at the end of each shader.
 */

/** The sky as a function of view direction. Shared by the sky dome and by the terrain's fog. */
export const SKY_CHUNK = /* glsl */ `
  uniform vec3 uSunDir;

  vec3 skyColor(vec3 d) {
    vec2 hz = normalize(d.xz + vec2(1e-5));
    vec2 sz = normalize(uSunDir.xz);
    float toward = dot(hz, sz) * 0.5 + 0.5;        // 1 facing the sun, 0 facing away

    vec3 horizonWarm = vec3(1.00, 0.50, 0.30);
    vec3 horizonCool = vec3(0.30, 0.28, 0.52);
    vec3 horizon = mix(horizonCool, horizonWarm, pow(toward, 1.8));
    vec3 mid = mix(vec3(0.10, 0.11, 0.30), vec3(0.30, 0.20, 0.38), pow(toward, 2.0));
    vec3 zenith = vec3(0.018, 0.026, 0.075);

    float h = max(d.y, 0.0);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.16, h));
    col = mix(col, zenith, smoothstep(0.10, 0.70, h));
    // Below the horizon: haze, darkening toward the ground.
    col = mix(col, horizon * 0.45, smoothstep(0.0, -0.15, d.y));

    float s = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.56, 0.28) * (0.25 * pow(s, 5.0) + 0.6 * pow(s, 40.0));
    col += vec3(1.0, 0.85, 0.62) * 8.0 * pow(s, 2400.0);
    return col;
  }
`;

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export const SKY_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const SKY_FRAG = /* glsl */ `
  varying vec3 vWorldPos;
  uniform float uStars;
  ${SKY_CHUNK}

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vWorldPos - cameraPosition);
    vec3 col = skyColor(d);
    if (uStars > 0.0 && d.y > 0.04) {
      vec3 q = d * 260.0;
      float h = hash13(floor(q));
      if (h > 0.9955) {
        float star = smoothstep(0.16, 0.0, length(fract(q) - 0.5));
        col += vec3(0.75, 0.82, 1.0) * star * smoothstep(0.06, 0.45, d.y) * (0.35 + 0.65 * fract(h * 97.0)) * uStars;
      }
    }
    gl_FragColor = vec4(col, 1.0);
    ${OUTPUT}
  }
`;

export const TERRAIN_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const TERRAIN_FRAG = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  uniform float uFogDensity;
  uniform float uContour;        // contour interval [m]
  uniform float uEngineering;    // 0..1
  uniform vec2 uRunway;          // runway centre (x, z)
  uniform vec2 uRunwayAxis;      // unit vector along the runway (x, z)
  uniform vec2 uRunwayHalf;      // half length, half width [m]
  ${SKY_CHUNK}

  // Anti-aliased lines at integer values of v, about w pixels wide.
  float lines(float v, float w) {
    float fw = max(fwidth(v), 1e-5);
    return 1.0 - smoothstep(0.0, fw * w, abs(fract(v - 0.5) - 0.5));
  }

  void main() {
    vec3 n = normalize(vNormal);
    float h = vWorldPos.y;
    vec3 toFrag = vWorldPos - cameraPosition;
    float dist = length(toFrag);
    vec3 vd = toFrag / dist;

    // Hypsometric tint, muted for dusk: valley teal → olive → rock → snow.
    vec3 base = mix(vec3(0.045, 0.085, 0.090), vec3(0.090, 0.115, 0.090), smoothstep(40.0, 300.0, h));
    base = mix(base, vec3(0.20, 0.17, 0.15), smoothstep(450.0, 1150.0, h));
    base = mix(base, vec3(0.62, 0.65, 0.74), smoothstep(1400.0, 1800.0, h) * smoothstep(0.55, 0.85, n.y));
    base = mix(base, base * 0.55 + vec3(0.02, 0.05, 0.07), uEngineering * 0.6);

    // Low warm sun, cool sky fill.
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 fill = mix(vec3(0.06, 0.07, 0.13), vec3(0.26, 0.25, 0.42), n.y * 0.5 + 0.5);
    vec3 col = base * (fill + vec3(1.0, 0.58, 0.36) * 2.1 * ndl);

    // Runway 09/27, painted here so it is crisp at any mesh resolution.
    vec2 rel = vWorldPos.xz - uRunway;
    float u = dot(rel, uRunwayAxis);
    float v = dot(rel, vec2(-uRunwayAxis.y, uRunwayAxis.x));
    vec2 aa = fwidth(vec2(u, v));
    float onRwy = (1.0 - smoothstep(uRunwayHalf.x - aa.x, uRunwayHalf.x + aa.x, abs(u)))
                * (1.0 - smoothstep(uRunwayHalf.y - aa.y, uRunwayHalf.y + aa.y, abs(v)));
    col = mix(col, vec3(0.022, 0.026, 0.034), onRwy);
    float dash = step(fract(u / 60.0), 0.55) * (1.0 - smoothstep(0.5, 0.5 + aa.y * 1.5, abs(v)));
    col += vec3(0.32) * dash * onRwy;

    // Contour lines from height, per pixel: minor every uContour, major every 5.
    float density = fwidth(h / uContour);
    float fade = (1.0 - smoothstep(0.3, 0.8, density)) * (1.0 - smoothstep(7000.0, 22000.0, dist));
    float contours = lines(h / uContour, 1.1) * 0.11 + lines(h / (uContour * 5.0), 1.5) * 0.24;
    vec3 lineCol = mix(vec3(0.32, 0.56, 0.64), vec3(0.45, 0.85, 0.95), uEngineering);
    col += lineCol * contours * fade * (1.0 + 1.6 * uEngineering);

    // Engineering view: a 1 km survey grid.
    float grid = max(lines(vWorldPos.x / 1000.0, 1.2), lines(vWorldPos.z / 1000.0, 1.2));
    col += vec3(0.40, 0.78, 0.90) * grid * uEngineering * 0.28 * (1.0 - smoothstep(4000.0, 16000.0, dist));

    // Atmospheric perspective: fade into the horizon colour of the sky in this direction.
    float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    vec3 fd = normalize(vec3(vd.x, max(vd.y, 0.0) * 0.25 + 0.01, vd.z));
    col = mix(col, skyColor(fd), fogF);

    gl_FragColor = vec4(col, 1.0);
    ${OUTPUT}
  }
`;

/** Ground lights (runway, towns): round, additive, sized in metres with a pixel floor. */
export const LIGHTS_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float phase;
  uniform float uScale;          // pixels per metre at 1 m distance
  uniform float uPixelRatio;
  uniform float uFogDensity;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uScale / dist, 1.6, 12.0) * uPixelRatio;
    float twinkle = 0.85 + 0.15 * sin(uTime * 2.3 + phase * 6.2831);
    vColor = color * twinkle;
    vAlpha = exp(-pow(dist * uFogDensity * 0.8, 2.0));
  }
`;

export const LIGHTS_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColor * a * a * vAlpha, 1.0);
    ${OUTPUT}
  }
`;

/** Waypoint beams: vertical columns of light that fade upward and into the haze. */
export const BEAM_VERT = /* glsl */ `
  varying float vY;
  varying float vDist;
  void main() {
    vY = uv.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDist = distance(wp.xyz, cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const BEAM_FRAG = /* glsl */ `
  varying float vY;
  varying float vDist;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFogDensity;
  void main() {
    float a = pow(1.0 - vY, 1.6) * uOpacity * exp(-pow(vDist * uFogDensity * 0.7, 2.0));
    gl_FragColor = vec4(uColor * a, 1.0);
    ${OUTPUT}
  }
`;
