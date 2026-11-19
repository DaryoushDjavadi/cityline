/**
 * Habitat dressing for the zoo: painted ground textures, instanced grass that sways in the wind
 * (vertex shader, no CPU per frame), bushes, flowers, stones, water with gentle waves, ice floes,
 * hay, varied wooden fences and soft blob shadows. Shared by the interior view (full set) and the
 * city layer (grass only). Everything is instanced: a few draw calls per habitat.
 */
import * as THREE from "three";

export type DecorType = "savanne" | "wald" | "wasser" | "polar" | "wiese";

/** Deterministic tiny PRNG so a habitat always looks the same. */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ wind shader

const windTime = { value: 0 };
/** Advance the shared wind clock (one uniform for every grass/water material). */
export function setWindTime(time: number): void {
  windTime.value = time;
}

/** MeshStandardMaterial whose vertices bend with height (y²) in a soft wind, per-instance phase. */
export function swayMaterial(strength = 1): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          float h = max(transformed.y, 0.0);
          #ifdef USE_INSTANCING
            vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 root = vec3(0.0);
          #endif
          float phase = root.x * 0.37 + root.z * 0.29;
          float gust = 0.6 + 0.4 * sin(uWind * 0.45 + root.x * 0.05);
          transformed.x += sin(uWind * 1.7 + phase) * ${(0.16 * strength).toFixed(3)} * h * h * gust;
          transformed.z += cos(uWind * 1.3 + phase * 1.4) * ${(0.1 * strength).toFixed(3)} * h * h * gust;
        }`,
      );
  };
  // Two-sided blades keep the up-facing normal on both sides (no black backfaces).
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize(vNormal);");
  };
  material.customProgramCacheKey = () => `sway-${strength}`;
  return material;
}

/** A grass tuft: `blades` tapered blades fanned around the root, height 1, base dark → tip light. */
export function tuftGeometry(blades = 6, seed = 3): THREE.BufferGeometry {
  const random = rng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < blades; i += 1) {
    const a = (i / blades) * Math.PI * 2 + random() * 0.6;
    const lean = 0.12 + random() * 0.22;
    const w = 0.06 + random() * 0.035;
    const h = 0.65 + random() * 0.35;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const px = -cz * w;
    const pz = cx * w;
    const ox = cx * 0.05;
    const oz = cz * 0.05;
    // two triangles: wide base, narrow tip that leans outward
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + cx * lean, h, oz + cz * lean);
    col.push(0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 1.12, 1.12, 1.12);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  // Up-facing normals: tufts are lit like the ground, never black from behind.
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

const GRASS: Record<DecorType, { colors: number[]; height: [number, number]; density: number }> = {
  savanne: { colors: [0xd8c070, 0xcbb060, 0xbfa456, 0xa8a456, 0xe0cc84], height: [0.4, 0.78], density: 0.8 },
  wald: { colors: [0x4f8e3c, 0x5c9c44, 0x437e36, 0x6aa84c], height: [0.3, 0.6], density: 1 },
  wasser: { colors: [0x6aa84a, 0x5c9c42, 0x78b454], height: [0.3, 0.55], density: 0.75 },
  polar: { colors: [0xc0b894, 0xb0a888, 0xd0c8a8], height: [0.22, 0.4], density: 0.12 },
  wiese: { colors: [0x6cb84a, 0x7cc858, 0x5aa840, 0x88cc60], height: [0.26, 0.48], density: 1.05 },
};

export interface GrassSpot {
  x: number;
  z: number;
}

/** Instanced, wind-swayed grass for one rectangular area; `skip` keeps tufts out of pools etc. */
export function grassField(type: DecorType, opts: { half: number; count: number; seed: number; scale?: number; skip?: (x: number, z: number) => boolean }): THREE.InstancedMesh {
  const conf = GRASS[type];
  const count = Math.max(1, Math.round(opts.count * conf.density));
  const mesh = new THREE.InstancedMesh(tuftGeometry(7, opts.seed), swayMaterial(type === "savanne" ? 1.3 : 1), count);
  const random = rng(opts.seed * 7 + 11);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const scale = opts.scale ?? 1;
  let n = 0;
  for (let tries = 0; n < count && tries < count * 6; tries += 1) {
    const x = (random() * 2 - 1) * opts.half;
    const z = (random() * 2 - 1) * opts.half;
    if (opts.skip?.(x, z)) continue;
    // patchy: clumps where a cheap noise is high
    const patch = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.sin(z * 0.7) * 2) * Math.cos(z * 0.8 - x * 0.3);
    if (random() > 0.35 + patch * 0.75) continue;
    const h = (conf.height[0] + random() * (conf.height[1] - conf.height[0])) * scale * (0.8 + patch * 0.4);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * Math.PI * 2);
    s.set(h * (0.8 + random() * 0.5), h, h * (0.8 + random() * 0.5));
    p.set(x, 0, z);
    mesh.setMatrixAt(n, m.compose(p, q, s));
    c.setHex(conf.colors[Math.floor(random() * conf.colors.length)]).multiplyScalar(0.9 + random() * 0.2);
    mesh.setColorAt(n, c);
    n += 1;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ ground

/** Painted ground: base color, soft blotches and type details (sand, moss, leaves, snow shadows, hay). */
export function groundTexture(type: DecorType, size = 512): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = rng(type.length * 97 + type.charCodeAt(0));
  const base: Record<DecorType, string> = { savanne: "#d4b86e", wald: "#557f40", wasser: "#7aa85c", polar: "#eaf1f7", wiese: "#80bc5c" };
  ctx.fillStyle = base[type];
  ctx.fillRect(0, 0, size, size);
  const blob = (color: string, count: number, rMin: number, rMax: number, alpha: number) => {
    for (let i = 0; i < count; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const r = rMin + random() * (rMax - rMin);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      // Fade to the same color at alpha 0 (fading to transparent black leaves grey rims).
      const hex = parseInt(color.slice(1), 16);
      const clear = `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},0)`;
      g.addColorStop(0, color);
      g.addColorStop(1, clear);
      ctx.globalAlpha = alpha * (0.6 + random() * 0.4);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + random() * 0.6), random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  const dots = (colors: string[], count: number, r: number) => {
    for (let i = 0; i < count; i += 1) {
      ctx.fillStyle = colors[Math.floor(random() * colors.length)];
      ctx.globalAlpha = 0.55 + random() * 0.45;
      ctx.beginPath();
      ctx.ellipse(random() * size, random() * size, r * (0.6 + random()), r * (0.4 + random() * 0.6), random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  if (type === "savanne") {
    blob("#e8d49c", 9, 40, 95, 0.9); // sand patches
    blob("#b89a52", 26, 20, 60, 0.5);
    blob("#9a9a50", 10, 20, 50, 0.35);
    dots(["#c09a5a", "#a88650", "#e6d6a6"], 500, 1.6);
  } else if (type === "wald") {
    blob("#3e6a32", 26, 30, 80, 0.6); // moss shade
    blob("#6e5a3a", 10, 18, 45, 0.55); // earth
    blob("#6a9a48", 18, 20, 60, 0.45);
    dots(["#a8642c", "#c08a3a", "#7a5a2a", "#b8782e", "#8a4a22"], 700, 2.4); // leaves
  } else if (type === "wasser") {
    blob("#6a9a4c", 22, 25, 70, 0.55);
    blob("#a8b878", 10, 20, 50, 0.35);
    dots(["#5a8a40", "#8ab866", "#d8d4b0"], 400, 1.6);
  } else if (type === "polar") {
    blob("#d2e2f4", 20, 30, 90, 0.5); // blue snow shadows
    blob("#ffffff", 18, 20, 70, 0.85);
    blob("#c4d8f0", 8, 15, 40, 0.35);
    dots(["#ffffff", "#dfe9f4"], 600, 1.4);
  } else {
    blob("#94cc6c", 22, 25, 70, 0.6);
    blob("#6aa848", 16, 25, 60, 0.45);
    blob("#d8c070", 7, 14, 30, 0.6); // hay
    for (let i = 0; i < 320; i += 1) {
      ctx.strokeStyle = random() < 0.5 ? "#e0c878" : "#c8b060";
      ctx.globalAlpha = 0.5 + random() * 0.4;
      ctx.lineWidth = 1.4;
      const x = random() * size;
      const y = random() * size;
      const a = random() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    dots(["#ffffff", "#ffe066", "#f4a6c8", "#b8a0f0"], 260, 1.8); // flowers in the turf
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Soft radial dark spot used as contact shadow / ambient occlusion under animals and objects. */
let blobTexture: THREE.CanvasTexture | null = null;
export function blobShadowMaterial(): THREE.MeshBasicMaterial {
  if (!blobTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(30,24,12,0.55)");
    g.addColorStop(0.55, "rgba(30,24,12,0.28)");
    g.addColorStop(1, "rgba(30,24,12,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    blobTexture = new THREE.CanvasTexture(canvas);
  }
  return new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

// ------------------------------------------------------------------ interior set

export interface InteriorDecor {
  group: THREE.Group;
  groundMap: THREE.CanvasTexture;
  dispose(): void;
}

interface Pool {
  x: number;
  z: number;
  w: number;
  d: number;
}

const FENCE_STYLE: Record<DecorType, { color: number; post: "log" | "plank" | "picket"; height: number; rails: number[]; r: number }> = {
  savanne: { color: 0x8a6a44, post: "log", height: 1.5, rails: [0.55, 1.15], r: 0.14 },
  wald: { color: 0x5e4230, post: "log", height: 2.5, rails: [0.8, 1.6, 2.3], r: 0.17 },
  wasser: { color: 0xe6dfd2, post: "plank", height: 1.3, rails: [0.5, 1.05], r: 0.12 },
  polar: { color: 0xbcc6d0, post: "plank", height: 1.6, rails: [0.5, 1.0, 1.45], r: 0.13 },
  wiese: { color: 0xf6f1e6, post: "picket", height: 1.1, rails: [0.35, 0.8], r: 0.09 },
};

function fence(type: DecorType, edge: number, step: number, random: () => number): THREE.Object3D[] {
  const style = FENCE_STYLE[type];
  const picket = style.post === "picket";
  const spacing = picket ? step * 0.34 : step;
  const n = Math.round((edge * 2) / spacing);
  const geometry = style.post === "log" ? new THREE.CylinderGeometry(style.r * 0.9, style.r, 1, 7) : picket ? new THREE.BoxGeometry(0.16, 1, 0.06) : new THREE.BoxGeometry(style.r * 1.6, 1, style.r * 1.6);
  if (picket) {
    // pointed picket top
    const tip = new THREE.ConeGeometry(0.11, 0.16, 4).rotateY(Math.PI / 4).translate(0, 0.58, 0);
    tip.scale(1, 1, 0.4);
    const merged = mergeSimple([geometry, tip]);
    geometry.dispose();
    return fenceMeshes(merged, style, edge, n, random, picket);
  }
  return fenceMeshes(geometry, style, edge, n, random, picket);
}

function fenceMeshes(post: THREE.BufferGeometry, style: (typeof FENCE_STYLE)[DecorType], edge: number, n: number, random: () => number, picket: boolean): THREE.Object3D[] {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  const posts = new THREE.InstancedMesh(post, material, 4 * (n + 1));
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.1), material, 4 * style.rails.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  let k = 0;
  for (let i = 0; i <= n; i += 1) {
    const t = -edge + (i * edge * 2) / n;
    for (const [x, z, side] of [[t, -edge, 0], [t, edge, 0], [-edge, t, 1], [edge, t, 1]] as const) {
      if (i === 0 && (z === edge || x === edge)) continue;
      const h = style.height * (picket ? 0.95 + random() * 0.1 : 0.92 + random() * 0.16);
      e.set((random() - 0.5) * 0.05, side ? Math.PI / 2 : 0, (random() - 0.5) * 0.05);
      q.setFromEuler(e);
      s.set(1, h, 1);
      p.set(x, h / 2, z);
      posts.setMatrixAt(k, m.compose(p, q, s));
      c.setHex(style.color).multiplyScalar(0.84 + random() * 0.24);
      posts.setColorAt(k, c);
      k += 1;
    }
  }
  posts.count = k;
  let r = 0;
  for (const y of style.rails) {
    for (const [x, z, w, rot] of [[0, -edge, edge * 2, 0], [0, edge, edge * 2, 0], [-edge, 0, edge * 2, 1], [edge, 0, edge * 2, 1]] as const) {
      q.setFromEuler(e.set(0, rot ? Math.PI / 2 : 0, (random() - 0.5) * 0.012));
      s.set(w, 1, 1);
      p.set(x, y + (random() - 0.5) * 0.05, z + (rot ? 0 : (z > 0 ? -1 : 1) * (picket ? 0.06 : 0.02)));
      rails.setMatrixAt(r, m.compose(p, q, s));
      c.setHex(style.color).multiplyScalar(0.8 + random() * 0.2);
      rails.setColorAt(r, c);
      r += 1;
    }
  }
  posts.castShadow = rails.castShadow = true;
  posts.receiveShadow = rails.receiveShadow = true;
  return [posts, rails];
}

/** Merge non-indexed copies of simple geometries (position+normal only). */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of flat) count += g.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.getAttribute("position").array as Float32Array, o * 3);
    nor.set(g.getAttribute("normal").array as Float32Array, o * 3);
    o += g.getAttribute("position").count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

function scatter(geometry: THREE.BufferGeometry, material: THREE.Material, spots: { x: number; y: number; z: number; s: number; sy?: number; color: number; ry?: number }[], shadows = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach((spot, i) => {
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spot.ry ?? 0);
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(spot.x, spot.y, spot.z), q, new THREE.Vector3(spot.s, spot.sy ?? spot.s, spot.s)));
    mesh.setColorAt(i, c.setHex(spot.color));
  });
  mesh.count = spots.length;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  return mesh;
}

/** Water surface with slow vertex waves and a slightly darker basin + pebble rim. */
function waterSet(type: DecorType, pool: Pool, random: () => number, low: boolean): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const shore = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.04, 28).scale(pool.w / 2 + 0.7, 1, pool.d / 2 + 0.6),
    new THREE.MeshStandardMaterial({ color: type === "polar" ? 0xdfe8f0 : 0xdcc894, roughness: 1 }),
  );
  shore.position.set(pool.x, 0.012, pool.z);
  shore.receiveShadow = true;
  out.push(shore);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.05, 28).scale(pool.w / 2, 1, pool.d / 2), new THREE.MeshStandardMaterial({ color: type === "polar" ? 0x1f5a86 : 0x2a7a8e, roughness: 0.6 }));
  basin.position.set(pool.x, 0.03, pool.z);
  out.push(basin);
  // Elliptic, radially subdivided disc (so the waves have vertices to move).
  const surface = new THREE.RingGeometry(0.001, 0.5, low ? 16 : 40, low ? 3 : 8).rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: type === "polar" ? 0x5aa6d6 : 0x4cb8d8, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.85 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.y += sin(position.x * 18.0 + uWind * 1.6) * 0.012 + cos(position.z * 15.0 - uWind * 1.2) * 0.012;`,
      )
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
        objectNormal = normalize(vec3(-cos(position.x * 18.0 + uWind * 1.6) * 0.1, 1.0, sin(position.z * 15.0 - uWind * 1.2) * 0.1));`);
  };
  material.customProgramCacheKey = () => "zoo-water";
  const water = new THREE.Mesh(surface, material);
  water.scale.set(pool.w * 0.97, 1, pool.d * 0.97);
  water.position.set(pool.x, 0.1, pool.z);
  out.push(water);
  // pebbles around the rim
  const pebbles: Parameters<typeof scatter>[2] = [];
  const ring = low ? 22 : 46;
  for (let i = 0; i < ring; i += 1) {
    const a = (i / ring) * Math.PI * 2 + random() * 0.1;
    const rx = pool.w / 2 + 0.15 + random() * 0.4;
    const rz = pool.d / 2 + 0.15 + random() * 0.35;
    pebbles.push({ x: pool.x + Math.cos(a) * rx, y: 0.04, z: pool.z + Math.sin(a) * rz, s: 0.12 + random() * 0.16, sy: 0.08 + random() * 0.08, color: type === "polar" ? 0xa8b4c2 : [0xb8ae9c, 0xa09684, 0xcfc4ae][i % 3], ry: random() * 6 });
  }
  out.push(scatter(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), pebbles));
  if (type === "polar") {
    // ice floes
    const floes: Parameters<typeof scatter>[2] = [];
    for (let i = 0; i < 4; i += 1) floes.push({ x: pool.x + (random() - 0.5) * pool.w * 0.6, y: 0.13, z: pool.z + (random() - 0.5) * pool.d * 0.55, s: 0.45 + random() * 0.45, sy: 0.12, color: i % 2 ? 0xf4f8fc : 0xdceaf6, ry: random() * 6 });
    out.push(scatter(new THREE.CylinderGeometry(1, 0.85, 1, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, flatShading: true }), floes));
  } else {
    // reeds and lily pads
    const pads: Parameters<typeof scatter>[2] = [];
    for (let i = 0; i < 5; i += 1) pads.push({ x: pool.x + (random() - 0.5) * pool.w * 0.7, y: 0.13, z: pool.z + (random() - 0.5) * pool.d * 0.6, s: 0.22 + random() * 0.12, sy: 0.02, color: 0x5a9a48, ry: random() * 6 });
    out.push(scatter(new THREE.CylinderGeometry(1, 1, 1, 9, 1, false, 0, Math.PI * 1.75), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), pads, false));
  }
  return out;
}

/**
 * Full interior dressing for a habitat of `half` size (items live on a grid inside),
 * `pool` = water area for water/polar habitats.
 */
export function buildInteriorDecor(type: DecorType, opts: { half: number; edge: number; step: number; pool: Pool | null; low: boolean }): InteriorDecor {
  const group = new THREE.Group();
  const random = rng(type.charCodeAt(0) * 131 + type.length);
  const { half, pool, low } = opts;
  const inPool = (x: number, z: number, margin = 0.6) => !!pool && Math.abs(x - pool.x) < pool.w / 2 + margin && Math.abs(z - pool.z) < pool.d / 2 + margin;
  group.add(...fence(type, opts.edge, opts.step, random));
  if (pool) group.add(...waterSet(type, pool, random, low));
  // grass
  const grassCount = low ? 260 : 800;
  group.add(grassField(type, { half: half - 0.1, count: grassCount, seed: 5 + type.length, skip: (x, z) => inPool(x, z, 0.3) }));
  if (type === "wasser" && pool) {
    // reeds on the shore
    const reeds = grassField("wald", { half: half, count: low ? 40 : 110, seed: 77, scale: 2.4, skip: (x, z) => !inPool(x, z, 1.1) || inPool(x, z, 0.35) });
    group.add(reeds);
  }
  const edgeSpot = (band = 1.3) => {
    const side = Math.floor(random() * 4);
    const t = (random() * 2 - 1) * (half - 0.4);
    const d = half - 0.3 - random() * band;
    return side === 0 ? { x: t, z: -d } : side === 1 ? { x: t, z: d } : side === 2 ? { x: -d, z: t } : { x: d, z: t };
  };
  // bushes along the fence
  const bushColors: Record<DecorType, number[]> = { savanne: [0x8a9a4a, 0x9aa456, 0x7a8a40], wald: [0x3e7a34, 0x4a8a3a, 0x356e2e], wasser: [0x4e8e40, 0x5a9a46], polar: [0xe8f0f6, 0xdce6f0], wiese: [0x5aa040, 0x6ab04a] };
  const bushCount: Record<DecorType, number> = { savanne: 7, wald: 20, wasser: 10, polar: 8, wiese: 9 };
  const bushes: Parameters<typeof scatter>[2] = [];
  for (let i = 0; i < bushCount[type]; i += 1) {
    const at = edgeSpot();
    if (inPool(at.x, at.z, 0.4)) continue;
    const s = (type === "wald" ? 0.7 : 0.5) + random() * 0.45;
    const colors = bushColors[type];
    // polar "bushes" are snow mounds
    bushes.push({ x: at.x, y: s * (type === "polar" ? 0.05 : 0.45), z: at.z, s, sy: s * (type === "polar" ? 0.45 : 0.8), color: colors[i % colors.length], ry: random() * 6 });
    if (type !== "polar" && random() < 0.6) bushes.push({ x: at.x + (random() - 0.5) * s, y: s * 0.35, z: at.z + (random() - 0.5) * s, s: s * 0.7, sy: s * 0.6, color: colors[(i + 1) % colors.length], ry: random() * 6 });
  }
  if (bushes.length) group.add(scatter(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), bushes));
  // flowers
  const flowerCount: Record<DecorType, number> = { savanne: 14, wald: 26, wasser: 22, polar: 0, wiese: 70 };
  const flowerColors: Record<DecorType, number[]> = { savanne: [0xf4d040, 0xe8a030], wald: [0xffffff, 0x9ab4f0, 0xf4e070], wasser: [0xffffff, 0xf4d040, 0xc8a0f0], polar: [], wiese: [0xffffff, 0xffe066, 0xf49ac0, 0xb8a0f0, 0xff8a6a] };
  const flowers: Parameters<typeof scatter>[2] = [];
  for (let i = 0; i < (low ? Math.round(flowerCount[type] / 2) : flowerCount[type]); i += 1) {
    const x = (random() * 2 - 1) * (half - 0.4);
    const z = (random() * 2 - 1) * (half - 0.4);
    if (inPool(x, z)) continue;
    const colors = flowerColors[type];
    flowers.push({ x, y: 0.28 + random() * 0.12, z, s: 0.07 + random() * 0.04, sy: 0.05, color: colors[i % colors.length], ry: random() * 6 });
  }
  if (flowers.length) group.add(scatter(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0x222018 }), flowers, false));
  // stones
  const stoneCount: Record<DecorType, number> = { savanne: 22, wald: 16, wasser: 8, polar: 14, wiese: 8 };
  const stones: Parameters<typeof scatter>[2] = [];
  for (let i = 0; i < stoneCount[type]; i += 1) {
    const x = (random() * 2 - 1) * (half - 0.3);
    const z = (random() * 2 - 1) * (half - 0.3);
    if (inPool(x, z)) continue;
    const s = 0.08 + random() * 0.14;
    stones.push({ x, y: s * 0.3, z, s, sy: s * 0.6, color: type === "polar" ? 0x9aa8b8 : type === "savanne" ? [0xb8a078, 0x9a8a6a][i % 2] : [0x9a9890, 0x8a8478][i % 2], ry: random() * 6 });
  }
  group.add(scatter(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), stones));
  // type extras
  if (type === "wiese") {
    const bales: Parameters<typeof scatter>[2] = [];
    for (const [x, z] of [[-half + 1.1, half - 1.2], [-half + 2.3, half - 0.9]]) bales.push({ x, y: 0.42, z, s: 0.55, sy: 0.85, color: 0xe2c66a, ry: random() });
    const bale = new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2);
    group.add(scatter(bale, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), bales));
  }
  if (type === "savanne") {
    // a dry log and a termite mound
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 2.2, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 1 }));
    log.position.set(half - 1.6, 0.22, half - 1.0);
    log.rotation.y = 0.5;
    const mound = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 7), new THREE.MeshStandardMaterial({ color: 0xb8865a, roughness: 1, flatShading: true }));
    mound.position.set(-half + 1.0, 0.7, -half + 1.2);
    log.castShadow = mound.castShadow = true;
    group.add(log, mound);
  }
  if (type === "wald") {
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.45, 9), new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 1 }));
    stump.position.set(half - 1.3, 0.22, half - 1.4);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 9), new THREE.MeshStandardMaterial({ color: 0xd8b886, roughness: 1 }));
    top.position.set(half - 1.3, 0.46, half - 1.4);
    stump.castShadow = true;
    group.add(stump, top);
  }
  const groundMap = groundTexture(type, low ? 256 : 512);
  return {
    group,
    groundMap,
    dispose() {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      groundMap.dispose();
    },
  };
}
