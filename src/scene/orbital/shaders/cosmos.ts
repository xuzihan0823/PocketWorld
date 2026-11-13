/** All lighting vectors are in world space; the Sun direction is shared with the habitat key light. */
// Simplex noise adapted from Ashima Arts / Stefan Gustavson (MIT License).
const noise = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    vec3 ns = 0.142857142857 * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float fbm(vec3 p, int octaves) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      sum += amplitude * snoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amplitude *= 0.5;
    }
    return sum;
  }
`;

export const skyVertex = /* glsl */ `
  varying vec3 vLocalDirection;
  varying vec3 vWorldDirection;
  void main() {
    vLocalDirection = position;
    vWorldDirection = mat3(modelMatrix) * position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;
  uniform vec3 uGalacticPole;
  uniform vec3 uEarthGlow;
  varying vec3 vLocalDirection;
  varying vec3 vWorldDirection;
  ${noise}
  void main() {
    vec3 d = normalize(vLocalDirection);
    float latitude = dot(d, uGalacticPole);
    vec3 core = normalize(cross(uGalacticPole, vec3(0.0, 0.0, 1.0)));
    float drift = uTime * 0.004;
    vec3 q = d * 1.7 + vec3(drift, -drift * 0.6, drift * 0.35);
    float warp = fbm(q, 3);
    float cloud = fbm(q * 1.9 + warp * 1.3 + vec3(0.0, drift, 0.0), 4);
    float band = exp(-latitude * latitude / 0.06);
    float lane = smoothstep(-0.05, 0.4, warp) * exp(-latitude * latitude / 0.007);
    float bulge = pow(max(dot(d, core), 0.0), 5.0) * exp(-latitude * latitude / 0.035);

    float rise = smoothstep(-0.75, 0.85, d.y);
    vec3 color = mix(vec3(0.004, 0.006, 0.018), vec3(0.010, 0.012, 0.034), rise);
    color = mix(color, vec3(0.014, 0.010, 0.034), smoothstep(-0.2, 0.9, warp) * 0.5);

    vec3 milky = mix(vec3(0.08, 0.10, 0.18), vec3(0.16, 0.15, 0.22), bulge);
    color += milky * band * (0.30 + 0.70 * smoothstep(-0.45, 0.6, cloud)) * 0.22 * (1.0 - lane * 0.8);
    color += vec3(0.30, 0.28, 0.40) * bulge * (0.35 + 0.65 * smoothstep(-0.2, 0.5, cloud)) * 0.08;

    float nebula = smoothstep(0.22, 0.72, cloud) * (0.30 + 0.70 * smoothstep(-0.3, 0.5, warp));
    vec3 hue = mix(vec3(0.14, 0.10, 0.40), vec3(0.04, 0.20, 0.34), smoothstep(-0.35, 0.35, warp));
    color += hue * nebula * 0.04;

    float halo = pow(max(dot(d, uEarthGlow), 0.0), 32.0);
    color += vec3(0.04, 0.10, 0.18) * halo * 0.4;
    color += vec3(0.08, 0.18, 0.28) * pow(halo, 2.0) * 0.35;

    float sun = max(dot(normalize(vWorldDirection), uSun), 0.0);
    color += vec3(1.0, 0.9, 0.72) * (smoothstep(0.99985, 0.99993, sun) * 9.0 + pow(sun, 260.0) * 0.5 + pow(sun, 18.0) * 0.03);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const starVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute vec2 aTwinkle;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    float pulse = sin(uTime * aTwinkle.y + aTwinkle.x) * 0.5 + 0.5;
    float flicker = sin(uTime * aTwinkle.y * 2.7 + aTwinkle.x * 3.1) * 0.5 + 0.5;
    float twinkle = mix(0.6, 1.1, pulse * 0.75 + flicker * 0.25);
    vColor = aColor * twinkle;
    gl_PointSize = aSize * uPixelRatio * (0.85 + 0.3 * pulse);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float glow = exp(-dot(c, c) * 4.5);
    float spikes = exp(-abs(c.x) * 18.0) * exp(-abs(c.y) * 2.6) + exp(-abs(c.y) * 18.0) * exp(-abs(c.x) * 2.6);
    gl_FragColor = vec4(vColor * (glow + spikes * 0.25), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const particleVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aSeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec3 drifted = position + vec3(
      sin(uTime * 0.10 + aSeed.x),
      sin(uTime * 0.07 + aSeed.y),
      cos(uTime * 0.08 + aSeed.z)) * 0.7;
    vec4 view = modelViewMatrix * vec4(drifted, 1.0);
    float pulse = 0.65 + 0.35 * sin(uTime * 0.5 + aSeed.x * 3.0);
    vColor = aColor * pulse;
    vFade = 1.0 - smoothstep(12.0, 30.0, -view.z);
    gl_PointSize = aSize * uPixelRatio * (18.0 / max(-view.z, 1.0));
    gl_Position = projectionMatrix * view;
  }
`;

export const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float glow = exp(-dot(c, c) * 4.0);
    gl_FragColor = vec4(vColor * glow, glow * vFade * 0.5);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const planetVertex = /* glsl */ `
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vObjectNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const clouds = /* glsl */ `
  float cloudDensity(vec3 p, float time) {
    float swirl = snoise(p * 1.3 + vec3(0.0, time * 0.004, 0.0)) * 0.6;
    vec3 q = p * 2.2 + vec3(time * 0.01, swirl, -time * 0.006);
    return smoothstep(0.0, 0.5, fbm(q, 4) + 0.16 * (1.0 - abs(p.y)));
  }
`;

export const earthFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTime;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  ${noise}
  ${clouds}
  void main() {
    vec3 p = normalize(vObjectNormal);
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float sunHeight = dot(n, uSun);
    float daylight = smoothstep(-0.10, 0.18, sunHeight);
    float diffuse = max(sunHeight, 0.0);

    float height = fbm(p * 1.35, 5) + 0.16 * snoise(p * 0.7);
    float land = smoothstep(0.02, 0.085, height);
    float coast = smoothstep(-0.02, 0.02, height) * (1.0 - land);
    float polar = smoothstep(0.82, 0.9, abs(p.y) + 0.04 * snoise(p * 6.0));
    float arid = smoothstep(0.15, 0.55, snoise(p * 2.1 + 4.0) * 0.5 + 0.5 - abs(abs(p.y) - 0.36) * 1.5);
    vec3 ocean = mix(vec3(0.010, 0.055, 0.16), vec3(0.030, 0.14, 0.30), smoothstep(-0.28, 0.02, height));
    ocean = mix(ocean, vec3(0.06, 0.28, 0.38), coast * 0.7);
    vec3 ground = mix(vec3(0.08, 0.20, 0.10), vec3(0.36, 0.30, 0.20), arid);
    ground = mix(ground, vec3(0.26, 0.26, 0.24), smoothstep(0.24, 0.42, height));
    vec3 albedo = mix(mix(ocean, ground, land), vec3(0.86, 0.91, 0.97), polar);

    float shadow = cloudDensity(p, uTime);
    vec3 day = albedo * (0.18 + diffuse * 1.05);
    vec3 night = albedo * vec3(0.08, 0.12, 0.28) * 0.5;
    vec3 color = mix(night, day, daylight);
    color *= 1.0 - shadow * daylight * 0.22;
    vec3 halfway = normalize(uSun + viewDirection);
    float specular = pow(max(dot(n, halfway), 0.0), 60.0);
    color += vec3(0.9, 0.95, 1.0) * specular * (1.0 - land) * (1.0 - polar) * daylight * 0.22;
    float limb = pow(1.0 - max(dot(n, viewDirection), 0.0), 3.0);
    color += vec3(0.08, 0.26, 0.55) * limb * (0.25 + daylight * 0.45);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const cloudFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTime;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  ${noise}
  ${clouds}
  void main() {
    float density = cloudDensity(normalize(vObjectNormal), uTime);
    float sunHeight = dot(normalize(vWorldNormal), uSun);
    float day = smoothstep(-0.12, 0.16, sunHeight);
    vec3 tint = mix(vec3(0.14, 0.20, 0.40), vec3(0.92, 0.95, 1.0), day);
    vec3 color = tint * (0.08 + day * (0.28 + max(sunHeight, 0.0) * 1.1));
    gl_FragColor = vec4(color, density * 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float facing = max(dot(n, viewDirection), 0.0);
    float sunHeight = dot(n, uSun);
    float day = smoothstep(-0.25, 0.35, sunHeight);
    float rim = pow(1.0 - facing, 3.2);
    float twilight = (1.0 - smoothstep(0.0, 0.3, abs(sunHeight))) * 0.25;
    vec3 blue = mix(vec3(0.10, 0.34, 0.86), vec3(0.36, 0.68, 1.0), facing);
    vec3 color = mix(blue, vec3(0.45, 0.55, 0.95), twilight);
    gl_FragColor = vec4(color, rim * (0.16 + day * 0.34));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
