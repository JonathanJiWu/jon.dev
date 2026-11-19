/**
 * GLSL for the scene. Written for three.js ShaderMaterial (WebGL2): three prepends
 * the matrices, `cameraPosition`, and the tone-mapping / colour-space functions.
 *
 * Colours are linear; ACES filmic tone mapping happens at the end of each shader.
 */

/** Fixed sizes of the terrain shader's runway and pavement arrays. */
export const RUNWAY_SLOTS = 4;
export const PAVE_SLOTS = 16;

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

  // Runways: centre (x, z) and heading as (sin, cos); half length, half width, and the
  // designator atlas cells of the two ends.
  uniform vec4 uRwy[${RUNWAY_SLOTS}];
  uniform vec4 uRwySize[${RUNWAY_SLOTS}];
  uniform int uRwyCount;
  // Taxiways and aprons, the same way; size.z = 1 for an apron.
  uniform vec4 uPave[${PAVE_SLOTS}];
  uniform vec4 uPaveSize[${PAVE_SLOTS}];
  uniform int uPaveCount;
  uniform vec4 uAirports[2];     // centre (x, z), radius
  uniform sampler2D uAtlas;      // runway designators, one cell per runway end
  uniform float uAtlasCells;
  uniform vec3 uLandingLightPos; // the aircraft's landing lights: position, beam direction, on
  uniform vec3 uLandingLightDir;
  uniform float uLandingLight;
  ${SKY_CHUNK}

  // Anti-aliased lines at integer values of v, about w pixels wide.
  float lines(float v, float w) {
    float fw = max(fwidth(v), 1e-5);
    return 1.0 - smoothstep(0.0, fw * w, abs(fract(v - 0.5) - 0.5));
  }

  // 1 inside [lo, hi], anti-aliased over aa.
  float band(float x, float lo, float hi, float aa) {
    return smoothstep(lo - aa, lo + aa, x) * (1.0 - smoothstep(hi - aa, hi + aa, x));
  }

  // Markings for one runway end, in that end's frame: d from the threshold, s to the right.
  float endMarkings(float d, float s, float halfW, float cell, vec2 aa) {
    float a = abs(s);
    float m = 0.0;
    // Threshold bars ("piano keys")
    m = max(m, band(d, 6.0, 36.0, aa.x) * band(a, 3.0, halfW - 3.0, aa.y) * step(fract(a / 3.6), 0.5));
    // Aiming point markers
    m = max(m, band(d, 305.0, 350.0, aa.x) * band(a, 6.0, 15.0, aa.y));
    // Touchdown zone bars: 3, 2, 2, 1, 1 per side at 150 m intervals
    for (int k = 0; k < 5; k++) {
      float st = 150.0 * float(k == 0 ? 1 : k + 2);
      float bars = k == 0 ? 3.0 : (k < 3 ? 2.0 : 1.0);
      float inBar = step(fract((a - 6.0) / 3.0), 0.6) * band(a, 6.0, 6.0 + 3.0 * bars - 1.2, aa.y);
      m = max(m, band(d, st, st + 22.5, aa.x) * inBar);
    }
    // Designator from the atlas: 20 m box, 42 m past the threshold, upright for the pilot.
    if (d > 41.0 && d < 63.0 && a < 11.0) {
      vec2 uv = vec2((s / 22.0 + 0.5 + cell) / uAtlasCells, (d - 42.0) / 20.0);
      m = max(m, texture2D(uAtlas, uv).r * step(0.0, uv.y) * step(uv.y, 1.0));
    }
    return m;
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

    // Pavement: aprons, taxiways (yellow centrelines), runways (markings), near airports only.
    float paved = 0.0;
    vec2 p = vWorldPos.xz;
    bool nearAirport = false;
    for (int a = 0; a < 2; a++) {
      vec2 dc = p - uAirports[a].xy;
      if (dot(dc, dc) < uAirports[a].z * uAirports[a].z) nearAirport = true;
    }
    if (nearAirport) {
      for (int i = 0; i < ${PAVE_SLOTS}; i++) {
        if (i >= uPaveCount) break;
        vec2 rel = p - uPave[i].xy;
        vec2 f = vec2(uPave[i].z, -uPave[i].w);
        float u = dot(rel, f);
        float v = dot(rel, vec2(uPave[i].w, uPave[i].z));
        vec2 aa = max(fwidth(vec2(u, v)), vec2(1e-3));
        float inside = band(u, -uPaveSize[i].x, uPaveSize[i].x, aa.x) * band(v, -uPaveSize[i].y, uPaveSize[i].y, aa.y);
        if (inside <= 0.0) continue;
        bool apron = uPaveSize[i].z > 0.5;
        vec3 surface = apron ? vec3(0.075, 0.078, 0.082) : vec3(0.045, 0.048, 0.054);
        if (!apron) surface = mix(surface, vec3(0.5, 0.36, 0.05), band(v, -0.25, 0.25, aa.y) * step(abs(u), uPaveSize[i].x - 2.0));
        base = mix(base, surface, inside);
        paved = max(paved, inside);
      }
      for (int i = 0; i < ${RUNWAY_SLOTS}; i++) {
        if (i >= uRwyCount) break;
        vec2 rel = p - uRwy[i].xy;
        vec2 f = vec2(uRwy[i].z, -uRwy[i].w);
        float u = dot(rel, f);
        float v = dot(rel, vec2(uRwy[i].w, uRwy[i].z));
        vec2 aa = max(fwidth(vec2(u, v)), vec2(1e-3));
        float halfL = uRwySize[i].x;
        float halfW = uRwySize[i].y;
        float inside = band(u, -halfL, halfL, aa.x) * band(v, -halfW, halfW, aa.y);
        if (inside <= 0.0) continue;
        float m = 0.0;
        // Side stripes and the centreline (dashed: 36 m stripe, 24 m gap)
        m = max(m, band(abs(v), halfW - 1.0, halfW - 0.1, aa.y));
        m = max(m, band(abs(v), 0.0, 0.45, aa.y) * step(fract((u + halfL - 70.0) / 60.0), 0.6) * step(abs(u), halfL - 70.0));
        // Each end, in its own frame: end 0 lands along +u, end 1 along −u.
        m = max(m, endMarkings(u + halfL, v, halfW, uRwySize[i].z, aa));
        m = max(m, endMarkings(halfL - u, -v, halfW, uRwySize[i].w, aa));
        vec3 asphalt = vec3(0.030, 0.033, 0.040);
        base = mix(base, mix(asphalt, vec3(0.42, 0.43, 0.45), m), inside);
        paved = max(paved, inside);
      }
    }
    base = mix(base, base * 0.55 + vec3(0.02, 0.05, 0.07), uEngineering * 0.6);

    // Low warm sun, cool sky fill.
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 fill = mix(vec3(0.06, 0.07, 0.13), vec3(0.26, 0.25, 0.42), n.y * 0.5 + 0.5);
    vec3 col = base * (fill + vec3(1.0, 0.58, 0.36) * 2.1 * ndl);

    // The pool of the landing lights on the ground ahead.
    if (uLandingLight > 0.0) {
      vec3 toP = vWorldPos - uLandingLightPos;
      float dl = length(toP);
      float cone = smoothstep(0.93, 0.985, dot(toP / dl, uLandingLightDir));
      col += base * vec3(1.0, 0.95, 0.86) * (14.0 * uLandingLight * cone / (1.0 + dl * dl / 14400.0)) * max(n.y, 0.0);
    }

    // Contour lines from height, per pixel: minor every uContour, major every 5.
    float density = fwidth(h / uContour);
    float fade = (1.0 - smoothstep(0.3, 0.8, density)) * (1.0 - smoothstep(9000.0, 26000.0, dist)) * (1.0 - paved);
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

/**
 * Ground lights: round, additive, sized in metres with a pixel floor. `dir` packs how a
 * light behaves: xy = the direction it faces (x, z), z = the cosine of its beam's half
 * angle (0 = shines all round), w = kind (0 steady, 1 sequenced flasher, 2 PAPI unit,
 * 3 slow flash). For a PAPI unit, `phase` is its transition angle [rad].
 */
export const LIGHTS_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float phase;
  attribute vec4 dir;
  uniform float uScale;          // pixels per metre at 1 m distance
  uniform float uPixelRatio;
  uniform float uFogDensity;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 toCam = cameraPosition - wp.xyz;
    float dist = max(length(toCam), 1.0);
    // Depth bias: slide the light toward the camera along the view ray (so it lands on the
    // same pixel), far enough that the ground it sits on can't hide it at a distance.
    vec3 biased = wp.xyz + toCam / dist * min(dist * 0.004, 50.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(biased, 1.0);
    float horiz = max(length(toCam.xz), 1e-3);
    float k = 1.0;
    if (dir.z > 0.0) k *= smoothstep(dir.z - 0.25, dir.z, dot(toCam.xz / horiz, dir.xy));
    vec3 col = color;
    float kind = dir.w;
    if (kind > 0.5 && kind < 1.5) {
      // Sequenced flashers ("the rabbit"): twice a second, running toward the runway.
      k *= fract(uTime * 2.0 - phase) < 0.05 ? 3.0 : 0.0;
    } else if (kind > 1.5 && kind < 2.5) {
      // PAPI: white seen from above the unit's transition angle, red from below.
      float w = smoothstep(phase - 0.0012, phase + 0.0012, atan(toCam.y, horiz));
      col = mix(vec3(2.6, 0.12, 0.05), vec3(2.4, 2.2, 2.0), w);
    } else if (kind > 2.5) {
      k *= fract(uTime * 0.5 - phase) < 0.06 ? 2.5 : 0.0;
    } else {
      k *= 0.88 + 0.12 * sin(uTime * 2.3 + phase * 6.2831);
    }
    gl_PointSize = k > 0.001 ? clamp(size * uScale / dist, 1.6, 14.0) * uPixelRatio : 0.0;
    vColor = col * k;
    vAlpha = exp(-pow(dist * uFogDensity * 0.7, 2.0));
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
