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
  uniform float uOrbit;
  uniform vec3 uGalacticPole;
  uniform vec3 uEarthGlow;
  varying vec3 vLocalDirection;
  varying vec3 vWorldDirection;
  ${noise}

  float starburstBlade(vec2 p, float angleRad, float shoulderWidth, float needleSharpness, float reach) {
    float c = cos(angleRad);
    float s = sin(angleRad);
    float along = abs(p.x * c + p.y * s);
    float perp = abs(-p.x * s + p.y * c);
    float radialMask = smoothstep(0.185, 0.012, along);
    float shoulder = exp(-perp * shoulderWidth * (1.0 + along * 8.0)) * exp(-along * (reach * 1.45)) * 0.92;
    float needle = exp(-perp * needleSharpness * (1.0 + along * 11.0)) * exp(-along * reach) * 0.88;
    return (shoulder + needle) * radialMask;
  }

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

    // Unified crisp obsidian film-black deep space across both orbit and cabin
    float darkAdapt = mix(1.30, 0.92, uDaylight);
    float rise = smoothstep(-0.80, 0.88, worldDir.y);
    vec3 color = mix(vec3(0.0014, 0.0020, 0.0046), vec3(0.0026, 0.0038, 0.0078), rise);
    color += vec3(0.0022, 0.0032, 0.0052) * smoothstep(0.05, 0.88, warp) * 0.35;

    // Subtle Milky Way dust band without muddy purple wash
    float starCloudDensity = (0.28 + 0.72 * smoothstep(-0.42, 0.62, cloud * 0.75 + fineCloud * 0.35)) * spiralMod;
    vec3 armColor = mix(vec3(0.042, 0.056, 0.088), vec3(0.075, 0.088, 0.125), smoothstep(-0.2, 0.5, fineCloud));
    vec3 coreColor = vec3(0.24, 0.19, 0.15);
    vec3 milky = mix(armColor, coreColor, clamp(bulge * 1.4, 0.0, 1.0));
    color += milky * band * starCloudDensity * 0.115 * (1.0 - dustAbsorption) * darkAdapt;

    float dustRim = primaryRift * (1.0 - primaryRift) * 4.0 * thinDisc;
    color += vec3(0.32, 0.24, 0.17) * dustRim * (0.4 + 0.6 * bulge) * 0.04 * darkAdapt;
    color += vec3(0.42, 0.32, 0.24) * bulge * (0.35 + 0.65 * smoothstep(-0.18, 0.52, cloud)) * (1.0 - primaryRift * 0.65) * 0.036 * darkAdapt;

    float nebulaMask = smoothstep(0.18, 0.70, cloud) * (0.30 + 0.70 * smoothstep(-0.25, 0.55, warp));
    float hAlpha = smoothstep(0.46, 0.78, filaments) * smoothstep(-0.1, 0.6, fineCloud) * (band * 0.85 + 0.15);
    vec3 reflectionHue = mix(vec3(0.08, 0.12, 0.28), vec3(0.06, 0.16, 0.28), smoothstep(-0.35, 0.35, warp));
    vec3 emissionHue = mix(vec3(0.32, 0.11, 0.18), vec3(0.38, 0.18, 0.14), smoothstep(-0.2, 0.5, cloud));
    color += reflectionHue * nebulaMask * wideHalo * 0.015 * darkAdapt;
    color += emissionHue * hAlpha * (1.0 - primaryRift * 0.5) * 0.018 * darkAdapt;

    // Dynamic Earthshine & atmospheric airglow halo locked to Earth's world direction
    float earthAlign = max(dot(worldDir, uEarthGlow), 0.0);
    float halo = pow(earthAlign, 11.5);
    float innerHalo = pow(earthAlign, 26.0);
    vec3 dayEarthGlow = vec3(0.045, 0.105, 0.22);
    vec3 duskEarthGlow = vec3(0.26, 0.13, 0.06);
    vec3 nightEarthGlow = vec3(0.020, 0.042, 0.10);
    vec3 earthHaloTint = mix(nightEarthGlow, dayEarthGlow, uDaylight);
    earthHaloTint = mix(earthHaloTint, duskEarthGlow, uWarmth * 0.65);
    color += earthHaloTint * halo * 0.28;
    color += mix(vec3(0.06, 0.13, 0.25), vec3(0.30, 0.15, 0.08), uWarmth * 0.65) * innerHalo * (0.14 + 0.16 * uDaylight);

    // Solar disc, compact golden aureole, and 8-blade optical aperture starburst (shared across orbit & cabin)
    float sunDot = dot(worldDir, uSun);
    float sun = max(sunDot, 0.0);
    vec3 sunRight = normalize(abs(uSun.y) < 0.9 ? cross(uSun, vec3(0.0, 1.0, 0.0)) : cross(uSun, vec3(1.0, 0.0, 0.0)));
    vec3 sunUp = cross(sunRight, uSun);
    float coronaAngle = atan(dot(worldDir, sunUp), dot(worldDir, sunRight));
    float rays = 0.72 + 0.28 * sin(coronaAngle * 8.0 + uTime * 0.08) * cos(coronaAngle * 13.0 - uTime * 0.05);
    float fineRays = 0.80 + 0.20 * sin(coronaAngle * 21.0 + warp * 2.5);
    float corona = pow(sun, 1350.0) * 1.45 * rays + pow(sun, 260.0) * 0.50 * fineRays + pow(sun, 22.0) * 0.028;

    float starburst = 0.0;
    float photoAureole = 0.0;
    if (sunDot > 0.72) {
      vec2 sp = vec2(dot(worldDir, sunRight), dot(worldDir, sunUp)) / sunDot;
      float r = length(sp);
      float shimmer = 0.95 + 0.05 * sin(uTime * 0.7 + r * 24.0);
      float localMask = smoothstep(0.19, 0.015, r);
      float bladeH = starburstBlade(sp, -0.03, 48.0, 165.0, 19.5) * 1.40;
      float bladeV = starburstBlade(sp, 1.54, 58.0, 185.0, 25.0) * 0.86;
      float bladeD1 = starburstBlade(sp, 0.68, 52.0, 175.0, 22.0) * 1.05;
      float bladeD2 = starburstBlade(sp, -0.74, 52.0, 175.0, 22.0) * 1.05;
      starburst = (bladeH + bladeV + bladeD1 + bladeD2) * shimmer;
      photoAureole = (exp(-r * 78.0) * 4.5 + exp(-r * 34.0) * 1.35 + exp(-r * 17.5) * 0.22) * localMask;
    }

    vec3 coreTint = mix(vec3(1.0, 0.96, 0.86), vec3(1.0, 0.74, 0.44), uWarmth * 0.65);
    vec3 sunTint = mix(vec3(1.0, 0.78, 0.44), vec3(1.0, 0.52, 0.20), uWarmth * 0.82);
    float solarDisc = smoothstep(0.99955, 0.99985, sun) * 13.5;
    float flareWeight = mix(0.85, 1.0, uOrbit) * uDaylight;
    color += coreTint * solarDisc + sunTint * (corona * uDaylight * 0.30 + (starburst * 2.25 + photoAureole) * flareWeight);

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
  uniform float uOrbit;
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
    float exposure = mix(1.42, 0.96, uDaylight) * 1.72;
    vColor = aColor * twinkle * exposure;
    float basePt = aSize * uPixelRatio * (0.85 + 0.32 * pulse);
    gl_PointSize = max(basePt * 0.96, 1.32 * uPixelRatio);
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
  uniform float uTravel;
  uniform float uBoost;
  varying vec3 vColor;
  varying float vFade;
  varying float vShape;
  varying float vGlint;
  varying float vRotation;
  void main() {
    float layerSpeed = mix(0.70, 1.25, aSeed.w);
    // Stream orbital ice crystals aft (-X) smoothly during orbital cruise & thruster boost
    float spanX = 64.0;
    float streamedX = mod(position.x - uTravel * mix(0.55, 1.35, aSeed.w) + 28.0, spanX) - 28.0;
    vec3 basePos = vec3(streamedX, position.y, position.z);
    vec3 drifted = basePos + vec3(
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
    vec3 boostTint = mix(baseTint, vec3(0.76, 0.92, 1.0), uBoost * 0.32);
    vColor = boostTint * pulse * (1.1 + forwardScatter * (0.55 * uDaylight + 0.40 * uWarmth) + uBoost * 0.65);

    // Smooth depth attenuation across near-cabin and deep-orbital layers
    float nearFade = smoothstep(1.5, 4.2, dist);
    float farFade = 1.0 - smoothstep(22.0, 68.0, dist);
    // Softly fade wrapped particles near the corridor edges so entry/exit is invisible
    float edgeFade = smoothstep(-28.0, -21.0, streamedX) * (1.0 - smoothstep(29.0, 36.0, streamedX));
    vFade = nearFade * farFade * mix(1.0, edgeFade, step(0.001, uTravel));
    vShape = aSeed.w;
    vGlint = glint;
    vRotation = uTime * (0.35 - 0.7 * aSeed.w) + aSeed.z;

    gl_PointSize = aSize * uPixelRatio * (21.0 / dist) * (0.94 + 0.30 * glint + uBoost * 0.28);
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
  uniform vec3 uLitSun;
  uniform float uOrbit;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectSun;
  varying vec3 vActiveSun;
  void main() {
    vObjectNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    mat3 rot = mat3(modelMatrix);
    vWorldNormal = normalize(rot * normal);
    vActiveSun = normalize(uLitSun);
    vObjectSun = normalize(vActiveSun * rot);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const clouds = /* glsl */ `
  float cloudDensity(vec3 p, float time) {
    // Smooth 3D cyclonic curl warp + billowy cellular cumulus + wispy cirrus (no 1D shear streaks)
    vec3 drift = vec3(time * 0.005, time * 0.0015, -time * 0.0035);
    vec3 warp = vec3(
      fbm(p * 2.3 + drift, 3),
      fbm(p * 2.3 + vec3(5.2, -1.8, 3.1) + drift, 3),
      fbm(p * 2.3 + vec3(-2.7, 4.3, -1.9) + drift, 3)
    );
    float coriolis = sign(p.y + 0.001) * smoothstep(0.05, 0.45, abs(p.y));
    vec3 swirl = cross(p, warp) * (0.28 * coriolis);
    vec3 wp = normalize(p + warp * 0.16 + swirl);

    // Synoptic weather systems (~48% cloud cover, ~52% clear blue ocean & continent windows)
    float synoptic = fbm(wp * vec3(4.6, 6.2, 4.8) + drift * 1.4, 5);
    // Fluffy billowy cumulus puffs (1 - |snoise|) + fine feathery cloud-edge detail
    float puffs = (1.0 - abs(snoise(wp * 19.0 + warp * 1.8))) * 0.18 - 0.09;
    float fineEdge = fbm(p * 52.0 + warp * 2.2, 2) * 0.11;
    float cirrus = (ridgedFbm(wp * 11.5 - drift, 2) - 0.48) * 0.16;

    float bands = exp(-pow(p.y / 0.20, 2.0)) * 0.08 + exp(-pow((abs(p.y) - 0.46) / 0.20, 2.0)) * 0.07;
    return smoothstep(0.075, 0.42, synoptic * 0.86 + puffs + fineEdge + cirrus + bands);
  }
`;

export const earthFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uLitSun;
  uniform float uOrbit;
  uniform float uTime;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectSun;
  varying vec3 vActiveSun;
  ${noise}
  ${clouds}
  void main() {
    vec3 p = normalize(vObjectNormal);
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 activeSun = normalize(vActiveSun);
    vec3 objectLitSun = normalize(vObjectSun);

    float sunHeight = dot(n, activeSun);
    float daylight = smoothstep(-0.12, 0.20, sunHeight);
    float twilight = smoothstep(-0.15, 0.04, sunHeight) * (1.0 - smoothstep(0.03, 0.30, sunHeight));

    // Lightweight tectonic domain warp for jagged coastlines, peninsulas, bays & island arcs
    float warp = fbm(p * 2.15 + vec3(0.5, 1.8, -0.9), 3);
    float warp2 = snoise(p * 8.2 + warp * 1.6);
    vec3 wp = normalize(p + vec3(warp, -warp * 0.72, warp * 0.85) * 0.21 + vec3(warp2, -warp2, warp2 * 0.5) * 0.034);

    // Continental elevation (~60% deep ocean, ~40% fractal continents & island chains)
    float plate = fbm(wp * 2.25 + vec3(0.45, -0.85, 0.30), 5) - 0.028;
    float coastDetail = snoise(wp * 22.0) * 0.038 + snoise(p * 56.0) * 0.018 + snoise(p * 118.0) * 0.008;
    float mountain = ridgedFbm(wp * 6.4 + vec3(2.1, -1.4, 0.8), 4);
    float islands = max(mountain - 0.56, 0.0) * 0.38;
    float height = plate + coastDetail + islands;

    // Crisp 1-pixel fractal coastline with shallow continental shelves & turquoise coral shoals
    float land = smoothstep(0.008, 0.015, height);
    float reefBand = smoothstep(-0.015, 0.009, height) * (1.0 - land);
    float shallow = smoothstep(-0.11, 0.006, height) * (1.0 - land);
    float abyssal = 1.0 - smoothstep(-0.22, -0.05, height);
    float polar = smoothstep(0.86, 0.93, abs(p.y) + 0.045 * snoise(p * 7.5));

    float canyon = snoise(p * 42.0 + warp2) * 0.5 + 0.5;
    float elevation = max(height - 0.01, 0.0) * 1.7 + pow(max(mountain - 0.30, 0.0), 1.7) * (0.60 + 0.40 * canyon) * smoothstep(0.01, 0.055, height);
    float humedad = snoise(wp * 3.1 + 4.0) * 0.5 + 0.5;
    float microGrain = snoise(p * 96.0);
    float arid = smoothstep(0.18, 0.56, (1.0 - humedad) - abs(abs(p.y) - 0.28) * 1.15);
    float alpine = smoothstep(0.20, 0.40, elevation);
    float snowPeak = smoothstep(0.34, 0.48, elevation + abs(p.y) * 0.12) * smoothstep(0.35, 0.75, canyon);

    // Dendritic river channels meandering across humid & savannah lowlands
    float river = (1.0 - smoothstep(0.0, 0.014, abs(snoise(wp * 15.5 + warp * 1.4)))) * land * (1.0 - alpine) * (1.0 - arid * 0.75);

    // Fast 3D mountain & canyon relief normal perturbation
    float eps = 0.0020;
    vec3 t1 = normalize(abs(p.y) < 0.9 ? cross(p, vec3(0.0, 1.0, 0.0)) : cross(p, vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(p, t1);
    float h0 = mountain * 0.55 + canyon * 0.14;
    float h1 = ridgedFbm(normalize(wp + t1 * eps) * 6.4 + vec3(2.1, -1.4, 0.8), 2) * 0.55 + (snoise(normalize(p + t1 * eps) * 42.0 + warp2) * 0.5 + 0.5) * 0.14;
    float h2 = ridgedFbm(normalize(wp + t2 * eps) * 6.4 + vec3(2.1, -1.4, 0.8), 2) * 0.55 + (snoise(normalize(p + t2 * eps) * 42.0 + warp2) * 0.5 + 0.5) * 0.14;
    vec3 reliefOffset = (t1 * (h0 - h1) + t2 * (h0 - h2)) * (land * 4.2);
    float bumpedSun = dot(normalize(p + reliefOffset), objectLitSun);
    float diffuse = max(mix(sunHeight, bumpedSun, 0.74 * land), 0.0);

    // Satellite ocean bathymetry: vivid Blue-Marble cobalt abyssal -> royal sapphire shelf -> turquoise coral shoals
    vec3 ocean = mix(vec3(0.018, 0.078, 0.215), vec3(0.009, 0.042, 0.135), abyssal);
    ocean = mix(ocean, vec3(0.036, 0.165, 0.340), shallow);
    float reefTex = 0.55 + 0.45 * (microGrain * 0.5 + 0.5);
    ocean = mix(ocean, vec3(0.075, 0.39, 0.43) * (0.85 + 0.35 * reefTex), reefBand * 0.88);

    // Satellite terrestrial biomes with micro-scale vegetation & sandstone dune texture
    float grainMod = 0.88 + 0.24 * (microGrain * 0.5 + 0.5);
    vec3 rainforest = vec3(0.036, 0.105, 0.044) * grainMod;
    vec3 woodland = vec3(0.082, 0.148, 0.062) * grainMod;
    vec3 steppe = vec3(0.20, 0.185, 0.095) * grainMod;
    vec3 forest = mix(steppe, mix(woodland, rainforest, smoothstep(0.48, 0.82, humedad)), smoothstep(0.22, 0.58, humedad));

    float duneStreaks = snoise(p * vec3(44.0, 16.0, 44.0) + mountain * 2.0) * 0.5 + 0.5;
    vec3 terracotta = mix(vec3(0.38, 0.25, 0.145), vec3(0.50, 0.37, 0.225), duneStreaks);
    vec3 desert = mix(terracotta, vec3(0.58, 0.53, 0.45), smoothstep(0.78, 0.94, duneStreaks * arid) * 0.45) * (0.92 + 0.16 * microGrain);

    vec3 ground = mix(forest, desert, arid);
    ground = mix(ground, vec3(0.165, 0.152, 0.145) * grainMod, alpine * 0.88);
    ground = mix(ground, vec3(0.84, 0.88, 0.94), snowPeak * 0.82);
    ground = mix(ground, vec3(0.028, 0.095, 0.155), river * 0.78);

    vec3 iceSheet = vec3(0.78, 0.84, 0.91) * (0.94 + 0.10 * microGrain);
    vec3 albedo = mix(mix(ocean, ground, land), iceSheet, polar);

    // Crisp parallax-projected cloud shadows cast along incoming sunlight
    float shadowSlide = 0.0050 / max(sunHeight + 0.24, 0.10);
    vec3 shadowSamplePos = normalize(p + objectLitSun * shadowSlide);
    float cloudShadow = cloudDensity(shadowSamplePos, uTime);

    // Balanced satellite exposure (no white blowout) with golden terminator warmth
    vec3 sunColor = mix(vec3(1.0, 0.95, 0.88), vec3(1.0, 0.56, 0.24), twilight * 0.88);
    vec3 day = albedo * (vec3(0.065, 0.085, 0.135) + diffuse * sunColor * 1.18);
    day += vec3(0.44, 0.19, 0.065) * albedo * twilight * (0.45 + 0.65 * diffuse);
    vec3 night = albedo * vec3(0.028, 0.045, 0.105) * 0.26;
    vec3 color = mix(night, day, daylight);
    color *= 1.0 - cloudShadow * daylight * 0.58;

    // Cox-Munk anisotropic ocean sun-glint broken up by fine wind-wave ripples
    vec3 halfway = normalize(activeSun + viewDirection);
    float waveFine = 0.82 + 0.18 * snoise(p * 135.0 + vec3(uTime * 0.02, 0.0, -uTime * 0.02));
    float specTight = pow(max(dot(n, halfway), 0.0), 115.0) * 0.46 * waveFine;
    float specBroad = pow(max(dot(n, halfway), 0.0), 26.0) * 0.13 * waveFine;
    float waterMask = (1.0 - land) * (1.0 - polar * 0.92) * (1.0 - cloudShadow * 0.85);
    vec3 glintHue = mix(vec3(0.98, 0.94, 0.86), vec3(1.0, 0.66, 0.34), twilight * 0.85);
    color += glintHue * (specTight + specBroad) * waterMask * daylight;

    // Energy-conserving Rayleigh aerial perspective (cerulean atmospheric veil toward curved horizon, zero white clipping)
    float facing = max(dot(n, viewDirection), 0.0);
    float mu = max(facing, 0.055);
    float airMass = clamp(0.072 / mu - 0.072, 0.0, 0.72);
    vec3 rayleighDay = mix(vec3(0.11, 0.32, 0.74), vec3(0.26, 0.52, 0.92), smoothstep(0.0, 0.32, facing));
    vec3 rayleighDusk = vec3(0.84, 0.44, 0.20);
    vec3 aerialVeil = mix(rayleighDay, rayleighDusk, twilight * 0.74) * (0.04 + 0.82 * daylight);
    color = mix(color, aerialVeil, airMass * (0.28 + 0.58 * daylight));

    // Night-side city networks: metropolitan cores + coastal/highway corridors
    float nightMask = 1.0 - smoothstep(-0.14, 0.02, sunHeight);
    float popBasin = smoothstep(0.34, 0.78, snoise(p * 4.8) * 0.5 + 0.5) + reefBand * 0.42;
    float metroHubs = smoothstep(0.64, 0.90, snoise(p * 28.0) * 0.5 + 0.5);
    float fineTowns = smoothstep(0.57, 0.85, snoise(p * 58.0) * 0.5 + 0.5) * 0.44;
    float cities = (metroHubs + fineTowns * smoothstep(0.45, 0.82, popBasin)) * clamp(popBasin, 0.0, 1.0);
    cities *= land * (1.0 - polar) * (1.0 - arid * 0.75) * (1.0 - alpine * 0.65) * nightMask;
    vec3 cityGlow = mix(vec3(1.0, 0.62, 0.24), vec3(1.0, 0.88, 0.64), metroHubs);
    color += cityGlow * cities * (0.64 - cloudShadow * 0.28);

    // High-latitude polar aurora oval (70°–76° magnetic latitude)
    float limb = pow(1.0 - facing, 3.2);
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
  uniform vec3 uLitSun;
  uniform float uOrbit;
  uniform float uTime;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectSun;
  varying vec3 vActiveSun;
  ${noise}
  ${clouds}
  void main() {
    vec3 p = normalize(vObjectNormal);
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 activeSun = normalize(vActiveSun);
    vec3 objectLitSun = normalize(vObjectSun);

    float density = cloudDensity(p, uTime);
    if (density < 0.004) discard;

    // Crisp cloud-top relief & directional self-shadowing toward the Sun
    float sunSample = cloudDensity(normalize(p + objectLitSun * 0.0042), uTime);
    float selfShadow = clamp((sunSample - density) * 2.8, 0.0, 1.0);
    float ridgeHighlight = clamp((density - sunSample) * 2.6, 0.0, 1.0);

    float sunHeight = dot(n, activeSun);
    float day = smoothstep(-0.13, 0.19, sunHeight);
    float sunsetBand = smoothstep(-0.15, 0.05, sunHeight) * (1.0 - smoothstep(0.03, 0.30, sunHeight));

    // Pure atmospheric white cloud tops with cool cerulean-slate shadow bases (never muddy beige)
    vec3 dayTint = mix(vec3(0.48, 0.58, 0.75), vec3(0.97, 0.98, 1.0), 1.0 - selfShadow * 0.62);
    vec3 sunsetTint = mix(vec3(0.94, 0.40, 0.20), vec3(1.0, 0.74, 0.44), ridgeHighlight * 0.7 + 0.3);
    vec3 nightTint = vec3(0.035, 0.055, 0.12);

    vec3 tint = mix(nightTint, dayTint, day);
    tint = mix(tint, sunsetTint, sunsetBand * (0.68 + 0.32 * ridgeHighlight));

    float illumination = 0.035 + day * (0.22 + max(sunHeight, 0.0) * 0.72 * (1.0 - selfShadow * 0.40) + ridgeHighlight * 0.22);
    float facing = max(dot(n, viewDirection), 0.0);
    vec3 color = tint * illumination + sunsetTint * sunsetBand * ridgeHighlight * 0.30;

    // Blend horizon clouds smoothly into Earth's cerulean Rayleigh veil so horizon never clips white
    float mu = max(facing, 0.055);
    float airMass = clamp(0.065 / mu - 0.065, 0.0, 0.68);
    vec3 limbVeil = mix(vec3(0.18, 0.44, 0.86), vec3(0.86, 0.46, 0.22), sunsetBand * 0.75) * (0.04 + 0.82 * day);
    color = mix(color, limbVeil, airMass * 0.55);

    gl_FragColor = vec4(color, density * 0.88);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uLitSun;
  uniform float uOrbit;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vActiveSun;
  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 activeSun = normalize(vActiveSun);
    float facing = max(dot(n, viewDirection), 0.0);
    float sunHeight = dot(n, activeSun);
    float day = smoothstep(-0.22, 0.32, sunHeight);

    // On a 1.0092R shell around a 1.0R planet, the surface horizon sits at facing ~= 0.135.
    // Fade smoothly to 0 at facing = 0 (outer vacuum edge) so there is zero hard glass-bubble ring!
    float vacuumFade = smoothstep(0.0, 0.132, facing);
    float rim = pow(1.0 - facing, 4.2) * vacuumFade;
    float outerRim = exp(-max(facing - 0.115, 0.0) * 14.0) * smoothstep(0.0, 0.115, facing);
    float twilight = (1.0 - smoothstep(0.0, 0.32, abs(sunHeight))) * 0.42;

    vec3 blue = mix(vec3(0.10, 0.36, 0.88), vec3(0.48, 0.80, 1.0), outerRim);
    vec3 duskBand = mix(vec3(0.96, 0.50, 0.22), vec3(0.42, 0.62, 0.96), smoothstep(-0.12, 0.20, sunHeight));
    vec3 color = mix(blue, duskBand, twilight);

    // High-altitude nightglow (airglow layer ~90 km) visible on the dark limb
    float nightSide = 1.0 - smoothstep(-0.20, 0.08, sunHeight);
    color += vec3(0.08, 0.30, 0.36) * outerRim * nightSide * 0.24;

    // Orbital sunrise / sunset chromatic crescent when Sun passes behind Earth's limb
    float behind = pow(max(dot(-viewDirection, uSun), 0.0), 16.0);
    float ring = outerRim * behind;
    vec3 lowFlare = mix(vec3(1.0, 0.38, 0.12), vec3(1.0, 0.74, 0.34), outerRim);
    vec3 flare = mix(lowFlare, vec3(0.42, 0.68, 1.0), smoothstep(-0.04, 0.26, dot(n, uSun)));
    color = color * (1.0 - ring * 0.85) + flare * ring * 2.8;

    float alpha = min(0.88, rim * (0.10 + day * 0.38 + twilight * 0.16) + outerRim * (day * 0.42 + nightSide * 0.08) + ring * 0.88);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const moonFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uLitSun;
  uniform float uDaylight;
  uniform float uOrbit;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectSun;
  varying vec3 vActiveSun;
  ${noise}

  vec3 hash33(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
  }

  float craterLayer(vec3 p, float scale, float rimSharpness) {
    vec3 g = p * scale;
    vec3 cell = floor(g);
    vec3 fracP = fract(g);
    float minDist = 8.0;
    float craterSize = 0.35;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 offset = vec3(float(x), float(y), float(z));
          vec3 h = hash33(cell + offset);
          vec3 center = offset + 0.18 + 0.64 * h;
          float d = length(fracP - center);
          if (d < minDist) {
            minDist = d;
            craterSize = 0.24 + 0.24 * h.z;
          }
        }
      }
    }
    float u = minDist / craterSize;
    float bowl = -max(0.0, 1.0 - u * u) * 0.72;
    float rim = exp(-pow((u - 1.0) * rimSharpness, 2.0)) * 0.34;
    float ejecta = exp(-max(u - 1.0, 0.0) * 3.2) * 0.08 * step(1.0, u);
    return bowl + rim + ejecta;
  }

  float lunarElevation(vec3 p) {
    float giantBasins = craterLayer(p, 2.9, 3.6) * 0.55;
    float majorCraters = craterLayer(p + vec3(3.7, -1.9, 2.3), 6.8, 4.4) * 0.38;
    float fineCraters = craterLayer(p + vec3(-2.1, 4.3, -1.4), 15.5, 5.0) * 0.20;
    float regolith = fbm(p * 14.0, 3) * 0.08;
    return giantBasins + majorCraters + fineCraters + regolith;
  }

  void main() {
    vec3 p = normalize(vObjectNormal);
    vec3 n = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 sunDir = normalize(vActiveSun);
    vec3 objSun = normalize(vObjectSun);

    // Basaltic Lunar Maria (dark slate-blue plains) vs Anorthositic Highlands (silver-ivory)
    float mareWarp = fbm(p * 1.55 + vec3(0.8, -0.4, 1.2), 4);
    float mareMask = smoothstep(-0.04, 0.28, mareWarp + 0.14 * snoise(p * 3.2));
    float rayStreaks = smoothstep(0.54, 0.86, ridgedFbm(p * 5.6 + vec3(1.4, 2.2, -0.9), 3));

    // Finite-difference crater relief normal perturbation for razor-sharp terminator shadows
    float eps = 0.0085;
    vec3 t1 = normalize(abs(p.y) < 0.9 ? cross(p, vec3(0.0, 1.0, 0.0)) : cross(p, vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(p, t1);
    float reliefScale = mix(1.35, 0.62, mareMask);
    float h0 = lunarElevation(p) * reliefScale;
    float h1 = lunarElevation(normalize(p + t1 * eps)) * reliefScale;
    float h2 = lunarElevation(normalize(p + t2 * eps)) * reliefScale;
    vec3 bumpedObjNormal = normalize(p + (t1 * (h0 - h1) + t2 * (h0 - h2)) * 2.85);

    float rawSun = dot(n, sunDir);
    float bumpedSun = dot(bumpedObjNormal, objSun);
    float terminatorMask = smoothstep(-0.08, 0.06, rawSun);
    float incidence = max(bumpedSun, 0.0) * smoothstep(-0.12, 0.02, rawSun);

    // Lommel-Seeliger / Hapke lunar regolith retroreflection (crisp sunlit limb without plastic gloss)
    float facing = max(dot(n, viewDir), 0.0);
    float lommel = incidence / (incidence + facing * 0.52 + 0.065);
    float sunLit = mix(incidence, lommel, 0.68) * terminatorMask * (0.20 + 0.80 * uDaylight);

    vec3 highlandAlbedo = vec3(0.56, 0.55, 0.53) + vec3(0.11, 0.11, 0.12) * rayStreaks;
    vec3 mareAlbedo = vec3(0.20, 0.22, 0.265);
    vec3 albedo = mix(highlandAlbedo, mareAlbedo, mareMask);
    albedo *= 0.90 + 0.22 * clamp(h0 + 0.5, 0.0, 1.2);

    vec3 sunTint = vec3(1.02, 0.98, 0.92);
    float limb = pow(1.0 - facing, 2.6);
    vec3 earthshine = albedo * vec3(0.085, 0.115, 0.175) * (0.72 + 0.55 * limb);

    vec3 color = earthshine * (1.0 - sunLit * 0.65) + albedo * sunTint * sunLit * 1.42;
    color += vec3(0.85, 0.90, 0.98) * pow(1.0 - facing, 4.5) * smoothstep(0.0, 0.35, rawSun) * uDaylight * 0.26;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
