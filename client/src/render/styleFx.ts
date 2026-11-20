/**
 * Graphics styles on top of the normal renderer: "Standard" (untouched), "Pixel-Art" (crisp
 * low-res pixels with a hand-picked palette, pixel outlines, Firewatch haze and warm rim light)
 * and "Comic" (cel bands, thick ink outlines, a bit more saturation, light hatching).
 *
 * One scene render into an off-screen target (colour + depth), then one or two full-screen
 * passes. Normals for outlines and lighting come from the depth buffer, so no extra scene pass.
 */
import * as THREE from "three";

export type GfxStyle = "standard" | "pixel" | "comic";
export const GFX_STYLES: { id: GfxStyle; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "pixel", label: "Pixel-Art" },
  { id: "comic", label: "Comic" },
];
const STYLE_KEY = "cityline-style";

export function loadStyle(): GfxStyle {
  try {
    const stored = localStorage.getItem(STYLE_KEY);
    if (stored === "pixel" || stored === "comic" || stored === "standard") return stored;
  } catch {
    // storage blocked: default look
  }
  return "standard";
}

export function saveStyle(style: GfxStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    // ignore
  }
}

/** Everyone who renders a scene listens here, so switching applies everywhere at once. */
const listeners = new Set<(style: GfxStyle) => void>();
let current: GfxStyle = typeof localStorage === "undefined" ? "standard" : loadStyle();
export function currentStyle(): GfxStyle {
  return current;
}
export function setStyle(style: GfxStyle): void {
  current = style;
  saveStyle(style);
  for (const listener of listeners) listener(style);
}
export function onStyle(listener: (style: GfxStyle) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hand-picked palette in the Stardew / Firewatch spirit: warm oranges and creams, deep teals,
 * purple shadows, soft greens, dusk pinks and a few night blues.
 */
const PALETTE = [
  // shadows / outlines (purple-black)
  0x1b1426, 0x2d2140, 0x3e2f55, 0x5a4470, 0x7a5a8a,
  // night blues
  0x0f1a2e, 0x1b2b48, 0x2a3f66, 0x3d5a86,
  // teals and water
  0x12333f, 0x1d4e5c, 0x2a6f7a, 0x3e8f93, 0x64b2ad, 0x9ad3c8,
  // sky
  0x4a7fb5, 0x6fa3d0, 0x9cc6e4, 0xc8e2ef, 0xe6f1f0, 0xa3bccf, 0xbad0de, 0xd5e4f0,
  // greens
  0x1f3b2c, 0x2f5a36, 0x457a3c, 0x66994a, 0x8db85a, 0xb5d16b, 0xd8e69a,
  // earth and warm
  0x3a2420, 0x5a3426, 0x7e4a30, 0x9c6440, 0xb8683f, 0xd98b4a, 0xf0a85a, 0xf7c873, 0xfbe3a6,
  // sand and dry grass
  0xc9a46a, 0xdcbd85, 0xead3a2, 0xa88a5c,
  // reds / dusk pinks
  0x6e2a34, 0x9c3a40, 0xc8524c, 0xe57a5e, 0xf2a68a, 0xb06a8a, 0xd898a8,
  // stone / neutrals
  0x34323c, 0x4c4a55, 0x67646c, 0x858088, 0xa59e9c, 0xc5bcb0, 0xe2d9c6, 0xfff4dc,
  // warm greys (walls, roads, concrete)
  0x26242a, 0x3a3836, 0x4f4b47, 0x66605a, 0x807870, 0x9a9188, 0xb8afa4,
  // sea blues
  0x24577e, 0x2f6f99, 0x3f87b0, 0x58a0c4, 0x7db9d6,
  // building accents (brick, roof red, slate, mustard)
  0x4a2220, 0x5e2a24, 0x7a2e26, 0xa8402f, 0x4a5a78, 0x6d7fa0, 0xc89a3a,
];

function oklab(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex); // three converts sRGB hex to linear working space
  const l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  const m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  const s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  return new THREE.Vector3(
    0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  );
}

const COMMON = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform mat4 uProjInv;
  uniform float uExposure;
  uniform vec3 uHaze;
  uniform vec2 uHazeRange;
  uniform float uHazeAmt;
  uniform vec3 uSunView;
  uniform vec3 uSunColor;
  uniform vec3 uUpView;
  varying vec2 vUv;

  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 color) {
    const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color *= uExposure / 0.6;
    color = outM * RRTAndODTFit(inM * color);
    return clamp(color, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  float rawDepth(vec2 uv) { return texture2D(tDepth, uv).r; }
  vec3 viewPos(vec2 uv, float d) {
    vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  vec3 viewAt(vec2 uv) { return viewPos(uv, rawDepth(uv)); }
  /** Normal from depth: pick the flatter side so silhouettes do not smear. */
  vec3 normalAt(vec2 uv, vec3 p, vec2 px) {
    vec3 r = viewAt(uv + vec2(px.x, 0.0)) - p;
    vec3 l = p - viewAt(uv - vec2(px.x, 0.0));
    vec3 u = viewAt(uv + vec2(0.0, px.y)) - p;
    vec3 d = p - viewAt(uv - vec2(0.0, px.y));
    vec3 dx = abs(r.z) < abs(l.z) ? r : l;
    vec3 dy = abs(u.z) < abs(d.z) ? u : d;
    return normalize(cross(dx, dy));
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  /** 1 / view distance: linear across the screen for any flat face, 0 for the sky. */
  float invDist(vec2 uv) {
    float d = rawDepth(uv);
    return d >= 0.99999 ? 0.0 : 1.0 / max(-viewPos(uv, d).z, 1e-3);
  }
`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const PIXEL_FRAG = /* glsl */ `
  ${COMMON}
  uniform vec3 uPal[${PALETTE.length}];
  uniform vec3 uPalLab[${PALETTE.length}];
  uniform float uOutline;

  vec3 labOf(vec3 c) {
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    vec3 q = pow(max(vec3(l, m, s), 0.0), vec3(1.0 / 3.0));
    return vec3(
      0.2104542553 * q.x + 0.793617785 * q.y - 0.0040720468 * q.z,
      1.9779984951 * q.x - 2.428592205 * q.y + 0.4505937099 * q.z,
      0.0259040371 * q.x + 0.7827717662 * q.y - 0.808675766 * q.z);
  }
  float bayer(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    int i = int(q.x + q.y * 4.0);
    int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(b[i]) + 0.5) / 16.0 - 0.5;
  }
  /** Nearest palette colour in OKLab (lightness counts a bit more, keeps forms readable). */
  vec3 quantize(vec3 srgb) {
    vec3 lab = labOf(toLinear(srgb));
    float best = 1e9;
    vec3 pick = srgb;
    for (int i = 0; i < ${PALETTE.length}; i++) {
      vec3 d = lab - uPalLab[i];
      float e = d.x * d.x * 1.15 + (d.y * d.y + d.z * d.z) * 1.35;
      if (e < best) { best = e; pick = uPal[i]; }
    }
    return pick;
  }

  void main() {
    vec2 px = 1.0 / uRes;
    float d = rawDepth(vUv);
    bool sky = d >= 0.99999;
    vec3 col = texture2D(tColor, vUv).rgb;
    vec3 p = viewPos(vUv, d);
    float dist = -p.z;
    float haze = 0.0;
    vec3 n = vec3(0.0, 0.0, 1.0);
    if (!sky) {
      n = normalAt(vUv, p, px);
      // Warm rim / sun light on edges that face the sun (Firewatch glow).
      // Only on upright faces (walls, trunks, animals), not on flat ground seen at a grazing angle.
      float upright = 1.0 - abs(dot(n, uUpView));
      float rim = pow(1.0 - clamp(abs(n.z), 0.0, 1.0), 2.0) * upright * upright * clamp(dot(n, uSunView) * 0.8 + 0.3, 0.0, 1.0);
      col += uSunColor * rim * 0.32;
      haze = smoothstep(uHazeRange.x, uHazeRange.y, dist) * uHazeAmt;
    }
    vec3 srgb = toSRGB(aces(col));
    // Atmospheric haze toward the sky colour (after tone mapping, so it keeps its hue).
    srgb = mix(srgb, uHaze, haze);
    // Gentle saturation and warmth.
    float g = luma(srgb);
    srgb = clamp(mix(vec3(g), srgb, 1.1) * vec3(1.015, 1.0, 0.985), 0.0, 1.0);

    // Outlines: object edge pixels against something farther, and creases between faces.
    float edge = 0.0;
    if (!sky && uOutline > 0.0) {
      vec2 offs[4] = vec2[4](vec2(px.x, 0.0), vec2(-px.x, 0.0), vec2(0.0, px.y), vec2(0.0, -px.y));
      // A neighbour that is much farther than this face would continue to (1/z is linear on a
      // plane), so grazing ground and sea never count as an edge – only real silhouettes.
      float i0 = 1.0 / max(dist, 1e-3);
      for (int i = 0; i < 4; i++) {
        float iN = invDist(vUv + offs[i]);
        float iO = invDist(vUv - offs[i]);
        float predicted = 2.0 * i0 - iO;
        if (predicted - iN > i0 * 0.03 && iN < i0) edge = 1.0;
      }
      if (edge < 1.0) {
        vec3 pr = viewAt(vUv + offs[0]);
        vec3 pd = viewAt(vUv + offs[3]);
        vec3 nr = normalAt(vUv + offs[0], pr, px);
        vec3 nd = normalAt(vUv + offs[3], pd, px);
        float crease = max(1.0 - dot(n, nr), 1.0 - dot(n, nd));
        if (crease > 0.45 && abs(pr.z - p.z) < dist * 0.05) edge = 0.55;
      }
      edge *= uOutline * (1.0 - haze * 0.8);
    }
    // Ordered dithering only in soft gradients (sky, haze).
    float soft = sky ? 1.0 : smoothstep(0.15, 0.6, haze);
    srgb += bayer(gl_FragCoord.xy) * (1.0 / 22.0) * soft;
    vec3 outCol = quantize(clamp(srgb, 0.0, 1.0));
    if (edge > 0.0) {
      // Dark outline that keeps a hint of the colour (purple-shifted, not flat black).
      vec3 ink = quantize(outCol * vec3(0.38, 0.33, 0.45));
      outCol = mix(outCol, ink, edge);
    }
    gl_FragColor = vec4(outCol, 1.0);
  }
`;

const BLIT_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform vec2 uRes;
  uniform float uScale;
  varying vec2 vUv;
  void main() {
    // Integer upscale: each art pixel covers exactly uScale × uScale screen pixels.
    vec2 cell = floor(gl_FragCoord.xy / uScale) + 0.5;
    gl_FragColor = vec4(texture2D(tColor, cell / uRes).rgb, 1.0);
  }
`;

const COMIC_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uInk;
  uniform float uHatch;
  uniform float uLineScale;
  uniform float uCrease;


  void main() {
    vec2 px = 1.0 / uRes;
    float d = rawDepth(vUv);
    bool sky = d >= 0.99999;
    vec3 col = texture2D(tColor, vUv).rgb;
    vec3 p = viewPos(vUv, d);
    float dist = -p.z;
    vec3 n = sky ? vec3(0.0, 0.0, 1.0) : normalAt(vUv, p, px);
    if (!sky) {
      // Cel bands: swap the smooth sun falloff for 3 hard bands.
      float k = dot(n, uSunView);
      float smoothL = 0.5 + 0.5 * clamp(k, 0.0, 1.0);
      float band = k > 0.5 ? 1.0 : (k > 0.12 ? 0.8 : 0.58);
      col *= clamp(band / smoothL, 0.72, 1.3);
    }
    vec3 srgb = toSRGB(aces(col));
    if (!sky) srgb = mix(srgb, uHaze, smoothstep(uHazeRange.x, uHazeRange.y, dist) * uHazeAmt);
    // Flatten tones a little (comic colour fills) and add saturation.
    float l = luma(srgb);
    float lq = floor(l * 5.0 + 0.5) / 5.0;
    srgb *= mix(1.0, (lq + 0.02) / (l + 0.02), 0.45);
    l = luma(srgb);
    srgb = clamp(mix(vec3(l), srgb, 1.22), 0.0, 1.0);
    if (!sky && uHatch > 0.0 && l < 0.3) {
      // Diagonal hatching in the shadows.
      float line = step(fract((gl_FragCoord.x + gl_FragCoord.y) / (5.0 * uLineScale)), 0.2);
      srgb *= 1.0 - line * uHatch * smoothstep(0.3, 0.1, l) * 0.42;
    }
    // Ink: Sobel on depth (thick, silhouettes) and on normals (thin, creases).
    float ink = 0.0;
    if (uInk > 0.0) {
      float r = 2.1 * uLineScale;
      float i0 = sky ? 0.0 : 1.0 / max(dist, 1e-3);
      float maxDiff = 0.0;
      float nearest = sky ? 1e5 : dist;
      for (int i = 0; i < 4; i++) {
        float a = float(i) * 0.7853982;
        vec2 o = vec2(cos(a), sin(a)) * px * r;
        float iA = invDist(vUv + o);
        float iB = invDist(vUv - o);
        float iMax = max(i0, max(iA, iB));
        nearest = min(nearest, 1.0 / max(iMax, 1e-5));
        // Second difference of 1/z: zero on any plane (also at grazing angles), large at silhouettes.
        maxDiff = max(maxDiff, abs(iA + iB - 2.0 * i0) / max(iMax, 1e-5));
      }
      // Silhouettes get the full line; it fades out into the haze so the horizon stays clean.
      ink = smoothstep(0.018, 0.05, maxDiff) * (1.0 - smoothstep(uHazeRange.x, uHazeRange.y, nearest));
      if (!sky && uCrease > 0.0) {
        vec2 o = px * max(1.0, uLineScale);
        vec3 pr = viewAt(vUv + vec2(o.x, 0.0));
        vec3 pu = viewAt(vUv + vec2(0.0, o.y));
        vec3 nr = normalAt(vUv + vec2(o.x, 0.0), pr, px);
        vec3 nu = normalAt(vUv + vec2(0.0, o.y), pu, px);
        float crease = max(1.0 - dot(n, nr), 1.0 - dot(n, nu));
        ink = max(ink, smoothstep(0.45, 0.75, crease) * 0.7);
      }
      ink *= uInk;
    }
    srgb = mix(srgb, vec3(0.07, 0.05, 0.06), ink);
    gl_FragColor = vec4(srgb, 1.0);
  }
`;

export interface StyleFrame {
  /** Point the camera looks at (pixel snapping and haze distances). */
  focus?: THREE.Vector3;
  /** Haze colour (sRGB colour of the sky near the horizon). */
  haze?: THREE.Color;
  /** Haze from/to as multiples of the focus distance. */
  hazeRange?: [number, number];
  hazeAmount?: number;
  sun?: THREE.DirectionalLight;
}

export class StyleFx {
  style: GfxStyle = currentStyle();
  low = false;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private target: THREE.WebGLRenderTarget | null = null;
  private art: THREE.WebGLRenderTarget | null = null;
  private readonly pixelMat: THREE.ShaderMaterial;
  private readonly comicMat: THREE.ShaderMaterial;
  private readonly blitMat: THREE.ShaderMaterial;
  private scale = 3;
  private readonly unsubscribe: () => void;
  private readonly tmp = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly saved = new THREE.Vector3();
  private readonly bufferSize = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer, onChange?: () => void) {
    const base = () => ({
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uProjInv: { value: new THREE.Matrix4() },
      uExposure: { value: 1 },
      uHaze: { value: new THREE.Color(0xcfe3ea) },
      uHazeRange: { value: new THREE.Vector2(100, 400) },
      uHazeAmt: { value: 0.5 },
      uSunView: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffc480) },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
    });
    const lab = PALETTE.map(oklab);
    const pal = PALETTE.map((hex) => {
      const c = new THREE.Color();
      c.setHex(hex, THREE.LinearSRGBColorSpace); // raw sRGB values for direct output
      return new THREE.Vector3(c.r, c.g, c.b);
    });
    this.pixelMat = new THREE.ShaderMaterial({
      uniforms: { ...base(), uPal: { value: pal }, uPalLab: { value: lab }, uOutline: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: PIXEL_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.comicMat = new THREE.ShaderMaterial({
      uniforms: { ...base(), uInk: { value: 1 }, uHatch: { value: 1 }, uLineScale: { value: 1 }, uCrease: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: COMIC_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blitMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uScale: { value: 3 } },
      vertexShader: VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pixelMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.unsubscribe = onStyle((style) => {
      this.style = style;
      this.release();
      onChange?.();
    });
  }

  get active(): boolean {
    return this.style !== "standard";
  }

  /** Art pixel size in drawing-buffer pixels: about 3 screen pixels, a bit larger on dense screens. */
  private artScale(): number {
    const ratio = this.renderer.getPixelRatio();
    return Math.max(2, Math.round(3 * Math.sqrt(Math.max(ratio, 1)))) + (this.low ? 1 : 0);
  }

  private ensure(width: number, height: number): void {
    const pixel = this.style === "pixel";
    const scale = pixel ? this.artScale() : 1;
    const w = Math.max(1, Math.ceil(width / scale));
    const h = Math.max(1, Math.ceil(height / scale));
    if (this.target && this.target.width === w && this.target.height === h && this.scale === scale) return;
    this.release();
    this.scale = scale;
    const filter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: filter, magFilter: filter, depthBuffer: true, depthTexture: depth });
    if (pixel) this.art = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  }

  private release(): void {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.art?.dispose();
    this.target = null;
    this.art = null;
  }

  /** Render the scene in the active style. Returns false for "Standard" (caller renders as usual). */
  render(scene: THREE.Scene, camera: THREE.Camera, frame: StyleFrame = {}): boolean {
    if (this.style === "standard") return false;
    const renderer = this.renderer;
    const size = renderer.getDrawingBufferSize(this.bufferSize);
    const width = size.x;
    const height = size.y;
    this.ensure(width, height);
    const target = this.target!;
    const pixel = this.style === "pixel";
    const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
    const focusDist = frame.focus ? camera.position.distanceTo(frame.focus) : 120;

    // Snap the camera to the art-pixel grid while it pans, so pixels do not crawl.
    let snapped = false;
    if (pixel && persp && frame.focus) {
      camera.updateMatrixWorld();
      const unit = (2 * focusDist * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) / target.height;
      this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const r = camera.position.dot(this.right);
      const u = camera.position.dot(this.up);
      this.saved.copy(camera.position);
      camera.position.addScaledVector(this.right, Math.round(r / unit) * unit - r).addScaledVector(this.up, Math.round(u / unit) * unit - u);
      camera.updateMatrixWorld();
      snapped = true;
    }

    // Count the scene and the passes together in renderer.info (draw-call stats stay honest).
    const autoReset = renderer.info.autoReset;
    if (autoReset) {
      renderer.info.reset();
      renderer.info.autoReset = false;
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);

    const mat = pixel ? this.pixelMat : this.comicMat;
    const uniforms = mat.uniforms;
    uniforms.tColor.value = target.texture;
    uniforms.tDepth.value = target.depthTexture;
    (uniforms.uRes.value as THREE.Vector2).set(target.width, target.height);
    if (persp) (uniforms.uProjInv.value as THREE.Matrix4).copy(persp.projectionMatrixInverse);
    else (uniforms.uProjInv.value as THREE.Matrix4).copy((camera as THREE.OrthographicCamera).projectionMatrixInverse);
    uniforms.uExposure.value = renderer.toneMappingExposure;
    const haze = frame.haze ?? (scene.fog as THREE.Fog | null)?.color ?? (scene.background instanceof THREE.Color ? scene.background : null);
    // Shader works in display sRGB after tone mapping: hand it the colour as sRGB.
    if (haze) (uniforms.uHaze.value as THREE.Color).copy(haze).convertLinearToSRGB();
    const range = frame.hazeRange ?? [1.1, 4.5];
    (uniforms.uHazeRange.value as THREE.Vector2).set(focusDist * range[0], focusDist * range[1]);
    uniforms.uHazeAmt.value = (frame.hazeAmount ?? 0.55) * (pixel ? 1 : 0.6);
    (uniforms.uUpView.value as THREE.Vector3).set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    if (frame.sun) {
      const dir = this.tmp.copy(frame.sun.position).sub(frame.sun.target.position).normalize();
      dir.transformDirection(camera.matrixWorldInverse);
      (uniforms.uSunView.value as THREE.Vector3).copy(dir);
      (uniforms.uSunColor.value as THREE.Color).copy(frame.sun.color).multiplyScalar(Math.min(1.2, frame.sun.intensity / 2));
    } else {
      (uniforms.uSunView.value as THREE.Vector3).set(0.4, 0.6, 0.5).normalize();
    }
    if (pixel) {
      uniforms.uOutline.value = 1;
      this.quad.material = this.pixelMat;
      renderer.setRenderTarget(this.art);
      renderer.render(this.quadScene, this.quadCam);
      this.blitMat.uniforms.tColor.value = this.art!.texture;
      (this.blitMat.uniforms.uRes.value as THREE.Vector2).set(target.width, target.height);
      this.blitMat.uniforms.uScale.value = this.scale;
      this.quad.material = this.blitMat;
      renderer.setRenderTarget(previous);
      renderer.render(this.quadScene, this.quadCam);
    } else {
      const lineScale = Math.max(1, renderer.getPixelRatio() * 0.9);
      uniforms.uLineScale.value = lineScale;
      // Low quality (weak GPUs): no hatching and no crease lines, silhouettes stay.
      uniforms.uHatch.value = this.low ? 0 : 1;
      uniforms.uCrease.value = this.low ? 0 : 1;
      uniforms.uInk.value = 1;
      this.quad.material = this.comicMat;
      renderer.setRenderTarget(previous);
      renderer.render(this.quadScene, this.quadCam);
    }
    if (snapped) {
      camera.position.copy(this.saved);
      camera.updateMatrixWorld();
    }
    renderer.info.autoReset = autoReset;
    return true;
  }

  dispose(): void {
    this.unsubscribe();
    this.release();
    this.pixelMat.dispose();
    this.comicMat.dispose();
    this.blitMat.dispose();
    this.quad.geometry.dispose();
  }
}
