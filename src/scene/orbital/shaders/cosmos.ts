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
  float ridgedFbm(vec3 p, int octaves) {
    float sum = 0.0;
    float amplitude = 0.5;
    float weight = 1.0;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      float n = 1.0 - abs(snoise(p));
      n = n * n * weight;
      weight = clamp(n * 1.75, 0.0, 1.0);
      sum += n * amplitude;
      p = p * 2.08 + vec3(3.1, 5.7, 1.9);
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
  uniform float uDaylight;
  uniform float uWarmth;
  uniform vec3 uGalacticPole;
  uniform vec3 uEarthGlow;
  varying vec3 vLocalDirection;
  varying vec3 vWorldDirection;
  ${noise}
  void main() {
    vec3 d = normalize(vLocalDirection);
    vec3 worldDir = normalize(vWorldDirection);
    float latitude = dot(d, uGalacticPole);
    vec3 core = normalize(cross(uGalacticPole, vec3(0.0, 0.0, 1.0)));
    vec3 galArm = cross(uGalacticPole, core);
    float coreAlign = dot(d, core);
    float drift = uTime * 0.0032;

    // Multi-scale domain-warped galactic coordinates
    vec3 q = d * 1.65 + vec3(drift, -drift * 0.55, drift * 0.30);
    float warp = fbm(q, 3);
    vec3 warpedPos = q * 1.95 + warp * 1.25 + vec3(0.0, drift * 0.8, -drift * 0.4);
    float cloud = fbm(warpedPos, 4);
    float fineCloud = fbm(warpedPos * 2.3 + vec3(4.2, -1.8, 2.7), 3);
    float filaments = ridgedFbm(d * 3.8 + warp * 0.85, 4);

    // Galactic plane profiles: wide diffuse halo, main stellar disc, and central bulge
    float wideHalo = exp(-latitude * latitude / 0.14);
    float band = exp(-latitude * latitude / 0.048);
    float thinDisc = exp(-latitude * latitude / 0.011);
    float bulge = pow(max(coreAlign, 0.0), 3.6) * exp(-latitude * latitude / 0.038);
    float spiralMod = 0.68 + 0.32 * sin(atan(dot(d, galArm), coreAlign) * 2.0 + warp * 1.8);

    // Dark molecular dust rifts (Great Rift & branching absorption tendrils)
    float riftNoise = fbm(d * 2.9 + vec3(warp * 0.7, -0.4, 1.1), 4);
    float primaryRift = smoothstep(-0.08, 0.36, riftNoise) * exp(-latitude * latitude / 0.0065);
    float dustTendrils = smoothstep(0.42, 0.78, filaments) * exp(-latitude * latitude / 0.022);
    float dustAbsorption = clamp(primaryRift * 0.82 + dustTendrils * 0.45, 0.0, 0.92);

    // Deep space background with subtle eye-adaptation between orbital noon and eclipse shadow
    float darkAdapt = mix(1.30, 0.88, uDaylight);
    float rise = smoothstep(-0.80, 0.88, worldDir.y);
    vec3 color = mix(vec3(0.0025, 0.0040, 0.013), vec3(0.0065, 0.0090, 0.026), rise);
    color = mix(color, vec3(0.011, 0.008, 0.028), smoothstep(-0.25, 0.85, warp) * 0.42);

    // Unresolved Milky Way star clouds: cool sapphire outer arms + warm amber-gold core bulge
    float starCloudDensity = (0.28 + 0.72 * smoothstep(-0.42, 0.62, cloud * 0.75 + fineCloud * 0.35)) * spiralMod;
    vec3 armColor = mix(vec3(0.065, 0.095, 0.19), vec3(0.11, 0.15, 0.26), smoothstep(-0.2, 0.5, fineCloud));
    vec3 coreColor = mix(vec3(0.22, 0.18, 0.24), vec3(0.35, 0.26, 0.19), pow(max(coreAlign, 0.0), 2.0));
    vec3 milky = mix(armColor, coreColor, clamp(bulge * 1.4, 0.0, 1.0));
    color += milky * band * starCloudDensity * 0.25 * (1.0 - dustAbsorption) * darkAdapt;

    // Bright inner galactic ridge and forward-scattered golden dust rims along dark lanes
    float dustRim = primaryRift * (1.0 - primaryRift) * 4.0 * thinDisc;
    color += vec3(0.28, 0.22, 0.17) * dustRim * (0.4 + 0.6 * bulge) * 0.11 * darkAdapt;
    color += vec3(0.36, 0.29, 0.24) * bulge * (0.35 + 0.65 * smoothstep(-0.18, 0.52, cloud)) * (1.0 - primaryRift * 0.65) * 0.10 * darkAdapt;

    // Emission nebulae (H-alpha rose-magenta knots & O-III teal-cyan veils)
    float nebulaMask = smoothstep(0.18, 0.70, cloud) * (0.30 + 0.70 * smoothstep(-0.25, 0.55, warp));
    float hAlpha = smoothstep(0.46, 0.78, filaments) * smoothstep(-0.1, 0.6, fineCloud) * (band * 0.85 + 0.15);
    vec3 reflectionHue = mix(vec3(0.11, 0.09, 0.36), vec3(0.03, 0.21, 0.34), smoothstep(-0.35, 0.35, warp));
    vec3 emissionHue = mix(vec3(0.38, 0.09, 0.20), vec3(0.44, 0.17, 0.14), smoothstep(-0.2, 0.5, cloud));
    color += reflectionHue * nebulaMask * wideHalo * 0.048 * darkAdapt;
    color += emissionHue * hAlpha * (1.0 - primaryRift * 0.5) * 0.058 * darkAdapt;

    // Dynamic Earthshine & atmospheric airglow halo locked to Earth's world direction
    float earthAlign = max(dot(worldDir, uEarthGlow), 0.0);
    float halo = pow(earthAlign, 28.0);
    float innerHalo = pow(earthAlign, 72.0);
    vec3 dayEarthGlow = vec3(0.045, 0.12, 0.24);
    vec3 duskEarthGlow = vec3(0.22, 0.10, 0.05);
    vec3 nightEarthGlow = vec3(0.025, 0.065, 0.14);
    vec3 earthHaloTint = mix(nightEarthGlow, dayEarthGlow, uDaylight);
    earthHaloTint = mix(earthHaloTint, duskEarthGlow, uWarmth * 0.6);
    color += earthHaloTint * halo * 0.44;
    color += mix(vec3(0.06, 0.15, 0.25), vec3(0.28, 0.14, 0.07), uWarmth * 0.65) * innerHalo * (0.20 + 0.22 * uDaylight);

    // Solar disc and radial coronal streamers (hidden behind Earth during eclipse)
    float sun = max(dot(worldDir, uSun), 0.0);
    vec3 sunRight = normalize(abs(uSun.y) < 0.9 ? cross(uSun, vec3(0.0, 1.0, 0.0)) : cross(uSun, vec3(1.0, 0.0, 0.0)));
    vec3 sunUp = cross(sunRight, uSun);
    float coronaAngle = atan(dot(worldDir, sunUp), dot(worldDir, sunRight));
    float rays = 0.72 + 0.28 * sin(coronaAngle * 8.0 + uTime * 0.08) * cos(coronaAngle * 13.0 - uTime * 0.05);
    float fineRays = 0.80 + 0.20 * sin(coronaAngle * 21.0 + warp * 2.5);
    float corona = pow(sun, 1350.0) * 1.45 * rays + pow(sun, 260.0) * 0.50 * fineRays + pow(sun, 22.0) * 0.028;
    vec3 sunTint = mix(vec3(1.0, 0.92, 0.75), vec3(1.0, 0.60, 0.28), uWarmth * 0.75);
    float solarDisc = smoothstep(0.99985, 0.99993, sun) * 9.0;
    color += sunTint * (solarDisc + corona * uDaylight);

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
  uniform float uDaylight;
  varying vec3 vColor;
  varying float vProminence;
  varying float vAngle;
  void main() {
    float pulse = sin(uTime * aTwinkle.y + aTwinkle.x) * 0.5 + 0.5;
    float flicker = sin(uTime * aTwinkle.y * 2.9 + aTwinkle.x * 3.7) * 0.5 + 0.5;
    float microScint = sin(uTime * (aTwinkle.y * 5.3 + 1.2) + aTwinkle.x * 1.9) * 0.5 + 0.5;
    float twinkle = mix(0.58, 1.16, pulse * 0.65 + flicker * 0.25 + microScint * 0.10);
    vProminence = clamp((aSize - 0.85) / 4.8, 0.0, 1.0);
    vAngle = aTwinkle.x;
    // Eyes adapt: stars read dimmer in sunlight and brighter inside Earth's shadow.
    float exposure = mix(1.38, 0.82, uDaylight);
    vColor = aColor * twinkle * exposure;
    gl_PointSize = aSize * uPixelRatio * (0.85 + 0.32 * pulse);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vProminence;
  varying float vAngle;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 5.8);
    float halo = exp(-r2 * 1.8) * 0.34;
    // Primary 4-point diffraction spikes + delicate rotated secondary rays on bright navigation stars
    float spikeWeight = smoothstep(0.16, 0.82, vProminence);
    float primarySpikes = exp(-abs(c.x) * 19.0) * exp(-abs(c.y) * 2.4) + exp(-abs(c.y) * 19.0) * exp(-abs(c.x) * 2.4);
    float s = sin(0.785398 + vAngle * 0.08);
    float cs = cos(0.785398 + vAngle * 0.08);
    vec2 diag = vec2(c.x * cs - c.y * s, c.x * s + c.y * cs);
    float secondarySpikes = (exp(-abs(diag.x) * 25.0) * exp(-abs(diag.y) * 3.6) + exp(-abs(diag.y) * 25.0) * exp(-abs(diag.x) * 3.6)) * 0.45;
    float totalIntensity = core + halo + (primarySpikes * 0.34 + secondarySpikes * 0.18) * spikeWeight;
    vec3 finalColor = vColor * totalIntensity + vec3(1.0, 0.98, 0.95) * smoothstep(0.70, 1.0, core * vProminence) * 0.45;
    gl_FragColor = vec4(finalColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const particleVertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aSeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uSun;
  uniform float uDaylight;
  uniform float uWarmth;
  varying vec3 vColor;
  varying float vFade;
  varying float vShape;
  varying float vGlint;
  varying float vRotation;
  void main() {
    float layerSpeed = mix(0.70, 1.25, aSeed.w);
    vec3 drifted = position + vec3(
      sin(uTime * 0.11 * layerSpeed + aSeed.x) + 0.32 * cos(uTime * 0.05 + aSeed.y),
      sin(uTime * 0.08 * layerSpeed + aSeed.y) + 0.24 * sin(uTime * 0.04 + aSeed.z),
      cos(uTime * 0.09 * layerSpeed + aSeed.z) + 0.32 * sin(uTime * 0.06 + aSeed.x)
    ) * mix(0.65, 1.15, aSeed.w);

    vec4 worldPos = modelMatrix * vec4(drifted, 1.0);
    vec4 view = viewMatrix * worldPos;
    float dist = max(-view.z, 1.0);

    // Mie forward-scattering when orbital ice crystals / dust motes align with the Sun
    vec3 viewDir = normalize(worldPos.xyz - cameraPosition);
    float sunAlign = max(dot(viewDir, uSun), 0.0);
    float forwardScatter = pow(sunAlign, 5.0) * 0.85 + pow(sunAlign, 1.6) * 0.28;

    // Crystalline tumble glint: periodic specular flash as ice facets catch sunlight
    float tumble = sin(uTime * (0.95 + aSeed.w * 1.5) + aSeed.x * 4.3) * cos(uTime * (0.65 + aSeed.y * 0.4) + aSeed.z * 2.7);
    float glint = pow(max(tumble, 0.0), 4.0);
    float pulse = 0.72 + 0.28 * sin(uTime * 0.55 + aSeed.x * 3.0) + glint * (0.55 + 0.45 * uDaylight);

    vec3 sunLitTint = mix(vec3(1.0, 0.96, 0.88), vec3(1.0, 0.66, 0.36), uWarmth * 0.85);
    vec3 shadowTint = aColor * vec3(0.88, 1.02, 1.25);
    vec3 baseTint = mix(shadowTint, mix(aColor, sunLitTint, 0.35 + forwardScatter * 0.48), uDaylight);
    vColor = baseTint * pulse * (1.1 + forwardScatter * (0.55 * uDaylight + 0.40 * uWarmth));

    // Smooth depth attenuation across near-cabin and deep-orbital layers
    float nearFade = smoothstep(1.5, 4.2, dist);
    float farFade = 1.0 - smoothstep(22.0, 62.0, dist);
    vFade = nearFade * farFade;
    vShape = aSeed.w;
    vGlint = glint;
    vRotation = uTime * (0.35 - 0.7 * aSeed.w) + aSeed.z;

    gl_PointSize = aSize * uPixelRatio * (21.0 / dist) * (0.94 + 0.30 * glint);
    gl_Position = projectionMatrix * view;
  }
`;

export const particleFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;
  varying float vShape;
  varying float vGlint;
  varying float vRotation;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float r = sqrt(r2);

    float s = sin(vRotation);
    float cs = cos(vRotation);
    vec2 rc = vec2(c.x * cs - c.y * s, c.x * s + c.y * cs);

    // Profile 1: soft out-of-focus camera bokeh disc with airy rim
    float bokehDisc = (1.0 - smoothstep(0.60, 0.95, r)) * (0.45 + 0.55 * smoothstep(0.20, 0.68, r));
    // Profile 2: warm gaussian cosmic dust mote
    float softMote = exp(-r2 * 3.8);
    // Profile 3: crystalline orbital ice mote with rotating diamond diffraction spikes
    float crystalCore = exp(-r2 * 6.5);
    float crystalSpikes = (exp(-abs(rc.x) * 15.0) * exp(-abs(rc.y) * 2.6) + exp(-abs(rc.y) * 15.0) * exp(-abs(rc.x) * 2.6)) * (0.50 + 0.50 * vGlint);
    float crystalMote = crystalCore + crystalSpikes * 0.65;

    float profile = vShape < 0.34
      ? mix(bokehDisc, softMote, vShape / 0.34)
      : (vShape > 0.66 ? mix(softMote, crystalMote, (vShape - 0.66) / 0.34) : softMote);

    vec3 finalColor = vColor * (profile + crystalCore * vGlint * 0.45);
    gl_FragColor = vec4(finalColor, profile * vFade * (0.62 + 0.28 * vGlint));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const planetVertex = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectSun;
  void main() {
    vObjectNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    mat3 rot = mat3(modelMatrix);
    vWorldNormal = normalize(rot * normal);
    vObjectSun = normalize(uSun * rot);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const clouds = /* glsl */ `
  float cloudDensity(vec3 p, float time) {
    // Trade-wind zonal flow + Coriolis cyclonic swirl; drier over polar highs
    float latBand = sin(p.y * 6.2);
    float swirl = snoise(p * 1.40 + vec3(time * 0.003, time * 0.004, -time * 0.002)) * 0.62;
    vec3 q = p * vec3(8.7, 12.5, 9.4) + vec3(time * 0.009 + latBand * 0.67, swirl * 2.25, -time * 0.0055);
    float baseCumulus = fbm(q, 5);
    float cirrusStreaks = (ridgedFbm(q * 1.65 + vec3(swirl * 0.75, 1.3, -0.7), 3) - 0.42) * 0.24;
    float equatBand = 0.15 * (1.0 - abs(p.y)) - 0.12 * smoothstep(0.68, 0.92, abs(p.y));
    return smoothstep(0.045, 0.39, baseCumulus + cirrusStreaks + equatBand);
  }
`;

export const earthFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTime;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectSun;
  ${noise}
  ${clouds}
  void main() {
    vec3 p = normalize(vObjectNormal);
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float sunHeight = dot(n, uSun);
    float daylight = smoothstep(-0.11, 0.19, sunHeight);
    float twilight = smoothstep(-0.14, 0.04, sunHeight) * (1.0 - smoothstep(0.02, 0.28, sunHeight));

    // Continental elevation + tectonic mountain ridges
    float continent = fbm(p * 2.75, 5) + 0.16 * snoise(p * 0.7);
    float ridges = ridgedFbm(p * 3.8 + vec3(2.1, -1.4, 0.8), 4);
    float height = continent + ridges * smoothstep(0.0, 0.22, continent) * 0.16;

    float land = smoothstep(0.02, 0.085, height);
    float coast = smoothstep(-0.03, 0.025, height) * (1.0 - land);
    float shallow = smoothstep(-0.16, 0.015, height) * (1.0 - land);
    float polar = smoothstep(0.86, 0.94, abs(p.y) + 0.04 * snoise(p * 6.0));
    float humedad = snoise(p * 2.1 + 4.0) * 0.5 + 0.5;
    float arid = smoothstep(0.15, 0.55, humedad - abs(abs(p.y) - 0.35) * 1.48);
    float alpine = smoothstep(0.23, 0.42, height);
    float snowPeak = smoothstep(0.36, 0.49, height + abs(p.y) * 0.10);

    // Fine relief normal perturbation for mountains and coastlines near the terminator
    float eps = 0.006;
    vec3 t1 = normalize(abs(p.y) < 0.9 ? cross(p, vec3(0.0, 1.0, 0.0)) : cross(p, vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(p, t1);
    float h1 = fbm((p + t1 * eps) * 2.6, 3);
    float h2 = fbm((p + t2 * eps) * 2.6, 3);
    float h0 = fbm(p * 2.6, 3);
    vec3 reliefOffset = (t1 * (h0 - h1) + t2 * (h0 - h2)) * (land * 2.2);
    float bumpedSun = dot(normalize(p + reliefOffset), vObjectSun);
    float diffuse = max(mix(sunHeight, bumpedSun, 0.62 * land), 0.0);

    // Bathymetry: abyssal ocean -> continental shelf -> turquoise coastal lagoons
    vec3 ocean = mix(vec3(0.008, 0.042, 0.135), vec3(0.026, 0.125, 0.28), shallow);
    ocean = mix(ocean, vec3(0.05, 0.28, 0.38), coast * 0.72);

    // Terrestrial biomes: tropical/temperate forest -> savannah -> desert -> alpine rock -> snow
    vec3 forest = mix(vec3(0.055, 0.165, 0.075), vec3(0.11, 0.22, 0.10), humedad);
    vec3 desert = mix(vec3(0.31, 0.24, 0.16), vec3(0.39, 0.31, 0.20), smoothstep(0.4, 0.85, humedad));
    vec3 ground = mix(forest, desert, arid);
    ground = mix(ground, vec3(0.24, 0.24, 0.23), alpine);
    ground = mix(ground, vec3(0.72, 0.80, 0.90), snowPeak * 0.62);
    vec3 albedo = mix(mix(ocean, ground, land), vec3(0.64, 0.76, 0.90), polar);

    // Parallax-projected cloud shadows cast along the incoming sunlight vector
    float shadowSlide = 0.0052 / max(sunHeight + 0.22, 0.09);
    vec3 shadowSamplePos = normalize(p + vObjectSun * shadowSlide);
    float cloudShadow = cloudDensity(shadowSamplePos, uTime);

    // Day/twilight/night surface illumination (controlled highlights to keep top-left brand text crisp)
    vec3 sunColor = mix(vec3(0.98, 0.96, 0.93), vec3(1.0, 0.52, 0.24), twilight * 0.82);
    vec3 day = albedo * (vec3(0.15, 0.17, 0.21) + diffuse * sunColor * 0.95);
    day += vec3(0.24, 0.09, 0.04) * albedo * twilight * (0.42 + 0.58 * diffuse);
    vec3 night = albedo * vec3(0.06, 0.10, 0.24) * 0.45;
    vec3 color = mix(night, day, daylight);
    color *= 1.0 - cloudShadow * daylight * 0.34;

    // Dual-lobe ocean solar glint (tight specular core + subtle wave scatter)
    vec3 halfway = normalize(uSun + viewDirection);
    float waveRipple = 0.88 + 0.12 * snoise(p * 42.0 + vec3(uTime * 0.02, 0.0, -uTime * 0.02));
    float specTight = pow(max(dot(n, halfway), 0.0), 95.0) * 0.26;
    float specBroad = pow(max(dot(n, halfway), 0.0), 28.0) * 0.07 * waveRipple;
    float waterMask = (1.0 - land) * (1.0 - polar * 0.9) * (1.0 - cloudShadow * 0.78);
    vec3 glintHue = mix(vec3(0.90, 0.95, 1.0), vec3(1.0, 0.66, 0.36), twilight * 0.8);
    color += glintHue * (specTight + specBroad) * waterMask * daylight;

    // Atmospheric Rayleigh limb scatter on surface
    float facing = max(dot(n, viewDirection), 0.0);
    float limb = pow(1.0 - facing, 3.2);
    vec3 limbHue = mix(vec3(0.07, 0.24, 0.54), vec3(0.52, 0.30, 0.22), twilight * 0.6);
    color += limbHue * limb * (0.22 + daylight * 0.42);

    // Night-side city networks: metropolitan cores + coastal/basin corridors
    float nightMask = 1.0 - smoothstep(-0.16, 0.03, sunHeight);
    float popBasin = smoothstep(0.34, 0.78, snoise(p * 4.8) * 0.5 + 0.5) + coast * 0.38;
    float metroHubs = smoothstep(0.63, 0.90, snoise(p * 26.0) * 0.5 + 0.5);
    float fineTowns = smoothstep(0.56, 0.84, snoise(p * 52.0) * 0.5 + 0.5) * 0.42;
    float cities = (metroHubs + fineTowns * smoothstep(0.45, 0.82, popBasin)) * clamp(popBasin, 0.0, 1.0);
    cities *= land * (1.0 - polar) * (1.0 - arid * 0.72) * (1.0 - alpine * 0.6) * nightMask;
    vec3 cityGlow = mix(vec3(1.0, 0.64, 0.28), vec3(1.0, 0.86, 0.64), metroHubs);
    color += cityGlow * cities * (0.50 - cloudShadow * 0.20);

    // High-latitude polar aurora oval (70°–76° magnetic latitude near the polar rim)
    float magLat = abs(p.y + 0.035 * sin(p.x * 2.5 - p.z * 2.0));
    float auroralOval = exp(-pow((magLat - 0.93) / 0.028, 2.0));
    float auroraCurtain = smoothstep(0.42, 0.85, snoise(vec3(p.x * 11.0 + uTime * 0.03, p.y * 4.0, p.z * 11.0 - uTime * 0.025)) * 0.5 + 0.5);
    float aurora = auroralOval * auroraCurtain * nightMask * (0.4 + 0.6 * limb);
    vec3 auroraColor = mix(vec3(0.18, 0.92, 0.58), vec3(0.52, 0.26, 0.86), smoothstep(0.92, 0.96, magLat));
    color += auroraColor * aurora * 0.24;

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
  varying vec3 vObjectSun;
  ${noise}
  ${clouds}
  void main() {
    vec3 p = normalize(vObjectNormal);
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float density = cloudDensity(p, uTime);
    if (density < 0.005) discard;

    // Directional cloud self-shadowing & top-edge silver lining toward the Sun
    float sunSample = cloudDensity(normalize(p + vObjectSun * 0.0065), uTime);
    float selfShadow = clamp((sunSample - density) * 2.5, 0.0, 1.0);
    float ridgeHighlight = clamp((density - sunSample) * 2.2, 0.0, 1.0);

    float sunHeight = dot(n, uSun);
    float day = smoothstep(-0.14, 0.18, sunHeight);
    float sunsetBand = smoothstep(-0.15, 0.02, sunHeight) * (1.0 - smoothstep(0.02, 0.26, sunHeight));

    vec3 dayTint = mix(vec3(0.68, 0.77, 0.90), vec3(0.91, 0.94, 0.99), 1.0 - selfShadow * 0.65);
    vec3 sunsetTint = mix(vec3(0.94, 0.36, 0.18), vec3(1.0, 0.70, 0.40), ridgeHighlight * 0.7 + 0.3);
    vec3 nightTint = vec3(0.10, 0.15, 0.32);

    vec3 tint = mix(nightTint, dayTint, day);
    tint = mix(tint, sunsetTint, sunsetBand * (0.62 + 0.38 * ridgeHighlight));

    float illumination = 0.07 + day * (0.24 + max(sunHeight, 0.0) * 0.92 * (1.0 - selfShadow * 0.42) + ridgeHighlight * 0.18);
    float forwardRim = pow(1.0 - max(dot(n, viewDirection), 0.0), 3.2) * day * 0.10;
    vec3 color = tint * illumination + sunsetTint * sunsetBand * ridgeHighlight * 0.22 + vec3(0.70, 0.82, 0.98) * forwardRim;

    gl_FragColor = vec4(color, density * 0.90);
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
    float outerRim = pow(1.0 - facing, 7.5);
    float twilight = (1.0 - smoothstep(0.0, 0.32, abs(sunHeight))) * 0.34;

    // Rayleigh day scatter + Chappuis ozone twilight violet-amber transition
    vec3 blue = mix(vec3(0.08, 0.30, 0.84), vec3(0.36, 0.68, 1.0), facing);
    vec3 duskBand = mix(vec3(0.88, 0.42, 0.20), vec3(0.38, 0.48, 0.92), smoothstep(-0.12, 0.18, sunHeight));
    vec3 color = mix(blue, duskBand, twilight);

    // High-altitude nightglow (airglow layer ~90 km) visible on the dark limb
    float nightSide = 1.0 - smoothstep(-0.20, 0.08, sunHeight);
    color += vec3(0.10, 0.34, 0.38) * outerRim * nightSide * 0.28;

    // Orbital sunrise / sunset: with the Sun behind Earth the limb lights up as a chromatic crescent
    float behind = pow(max(dot(-viewDirection, uSun), 0.0), 36.0);
    float ring = pow(1.0 - facing, 5.8) * behind;
    vec3 lowFlare = mix(vec3(1.0, 0.38, 0.12), vec3(1.0, 0.74, 0.34), outerRim);
    vec3 flare = mix(lowFlare, vec3(0.42, 0.68, 1.0), smoothstep(-0.04, 0.26, sunHeight));
    color = color * (1.0 - ring * 0.85) + flare * ring * 3.0;

    float alpha = min(1.0, rim * (0.16 + day * 0.32 + twilight * 0.18) + outerRim * nightSide * 0.10 + ring * 0.90);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
