import * as THREE from "three";
import type { Climate } from "../../../shared/src/index.ts";
import type { GfxProfile } from "./quality.ts";

const tmp = new THREE.Color();
const tmpB = new THREE.Color();

export interface Atmosphere {
  sky: THREE.Mesh;
  skyMaterial: THREE.ShaderMaterial;
  clouds: THREE.InstancedMesh;
  stars: THREE.Points;
  moon: THREE.Mesh;
  sunDisc: THREE.Mesh;
}

export function createAtmosphere(): Atmosphere {
  const skyMaterial = skyGradient();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 48, 28), skyMaterial);
  sky.geometry.scale(-1, 1, 1);
  sky.frustumCulled = false;
  sky.renderOrder = -20;

  const cloudGeo = cloudGeometry();
  const clouds = new THREE.InstancedMesh(
    cloudGeo,
    new THREE.MeshBasicMaterial({ color: 0xfff4ea }),
    12,
  );
  clouds.count = 12;
  clouds.frustumCulled = false;
  clouds.castShadow = false;
  clouds.receiveShadow = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    const r = 420 + (i % 5) * 70;
    dummy.position.set(Math.cos(a) * r * 1.6, 210 + (i % 4) * 18, Math.sin(a) * r * 1.15);
    dummy.rotation.set(0, a + 0.4, 0);
    dummy.scale.set(0.35 + (i % 3) * 0.12, 0.22 + (i % 2) * 0.06, 0.32 + ((i * 3) % 4) * 0.08);
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
  }

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const p = Math.acos(Math.random() * 0.72);
    const r = 980;
    starPos[i * 3] = Math.sin(p) * Math.cos(a) * r;
    starPos[i * 3 + 1] = Math.abs(Math.cos(p)) * r + 80;
    starPos[i * 3 + 2] = Math.sin(p) * Math.sin(a) * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xf4f0e4, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -18;

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(10, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff4c8 }),
  );
  moon.frustumCulled = false;

  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(7, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe7b0 }),
  );
  sunDisc.visible = false;
  sunDisc.frustumCulled = false;

  return { sky, skyMaterial, clouds, stars, moon, sunDisc };
}

export function seaMaterial(segmentsHint = 80): THREE.ShaderMaterial {
  void segmentsHint;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShade: { value: 1 },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
          uDeep: { value: new THREE.Color(0x0e4f96) },
      uMid: { value: new THREE.Color(0x1e7ec4) },
      uShallow: { value: new THREE.Color(0x3ea0d4) },
      uHorizon: { value: new THREE.Color(0xc9b089) },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      varying vec3 vNormalW;
      void main() {
        vec3 shifted = position;
        float wave = sin(position.x * 0.022 + uTime * 0.35) * 0.12
          + sin(position.z * 0.018 - uTime * 0.28) * 0.08
          + sin((position.x + position.z) * 0.012 + uTime * 0.4) * 0.05;
        shifted.y += wave;
        vWave = wave;
        vec3 n = normalize(vec3(
          -cos(position.x * 0.028 + uTime * 0.55) * 0.028,
          1.0,
          -cos(position.z * 0.034 - uTime * 0.42) * 0.034
        ));
        vNormalW = n;
        vec4 world = modelMatrix * vec4(shifted, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uShade;
      uniform float uNight;
      uniform vec3 uSunDir;
      uniform vec3 uDeep;
      uniform vec3 uMid;
      uniform vec3 uShallow;
      uniform vec3 uHorizon;
      varying vec3 vWorld;
      varying float vWave;
      varying vec3 vNormalW;
      void main() {
        float dist = length(vWorld.xz);
        float near = smoothstep(480.0, 160.0, dist);
        float farFade = smoothstep(1600.0, 620.0, dist);
        vec3 color = mix(uDeep, uMid, clamp(vWave * 1.4 + 0.35, 0.0, 1.0));
        color = mix(color, uShallow, near * 0.4);
        float spark = sin(vWorld.z * 0.031 + vWorld.x * 0.017) * 0.015;
        color += spark * vec3(0.12, 0.2, 0.24);
        vec3 n = normalize(vNormalW);
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 h = normalize(normalize(uSunDir) + view);
        float spec = pow(max(dot(n, h), 0.0), mix(48.0, 90.0, 1.0 - uNight));
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.0);
        vec3 sparkle = mix(vec3(1.0, 0.94, 0.78), vec3(0.82, 0.9, 1.0), uNight);
        color += sparkle * spec * mix(0.45, 0.22, uNight);
        color = mix(color, uHorizon, fresnel * 0.08 * farFade);
        float foam = smoothstep(0.12, 0.28, vWave) * near;
        color = mix(color, vec3(0.86, 0.94, 0.96), foam * 0.35);
        color *= uShade;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

export function applyLook(
  climate: Climate,
  hemi: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  fill: THREE.DirectionalLight,
  fog: THREE.Fog,
  skyMaterial: THREE.ShaderMaterial,
  seaMaterial: THREE.ShaderMaterial,
  clouds: THREE.InstancedMesh,
  stars: THREE.Points,
  moon: THREE.Mesh,
  sunDisc: THREE.Mesh,
  target: THREE.Vector3,
  quality: GfxProfile,
): { nightLit: boolean; exposure: number } {
  const day = climate.daylight;
  const rainy = climate.weather === "rain";
  const cloudy = climate.weather === "cloud" || rainy;
  const night = climate.isNight;
  const golden = (climate.hour > 5.5 && climate.hour < 7.8) || (climate.hour > 17.2 && climate.hour < 19.8);
  const nightAmt = night ? 1 - Math.min(1, Math.max(0, (day - 0.14) / 0.2)) : Math.max(0, 0.35 - day) / 0.35;

  const zenith = tmp.setHSL(
    rainy ? 0.58 : golden ? 0.6 : night ? 0.64 : 0.58,
    rainy ? 0.28 : golden ? 0.55 : night ? 0.58 : 0.72,
    night ? 0.2 : golden ? 0.34 : rainy ? 0.42 : 0.4,
  );
  const horizon = tmpB.setHSL(
    rainy ? 0.58 : golden ? 0.075 : night ? 0.62 : 0.1,
    rainy ? 0.16 : golden ? 0.78 : night ? 0.28 : 0.62,
    night ? 0.3 : golden ? 0.68 : rainy ? 0.58 : 0.72,
  );

  skyMaterial.uniforms.uZenith.value.copy(zenith);
  skyMaterial.uniforms.uHorizon.value.copy(horizon);
  skyMaterial.uniforms.uNight.value = nightAmt;
  skyMaterial.uniforms.uHaze.value = cloudy ? 0.45 : golden ? 0.22 : 0.08;

  fog.color.set(night ? 0x1c4a82 : golden ? 0x6a9ac4 : 0x2f86c8);
  fog.near = rainy ? 280 : 780;
  fog.far = rainy ? 1200 : 2600;

  hemi.color.set(night ? 0xb8c6dc : golden ? 0xffe0c0 : 0xfff6ea);
  hemi.groundColor.set(night ? 0x3a4a42 : 0x4d6a40);
  hemi.intensity = night ? 0.72 : 0.55 + day * 0.5;

  const az = climate.phase * Math.PI * 2;
  const sunHeight = night ? 55 : 48 + day * 130;
  const ring = 90 + (1 - day) * 40;
  sun.position.set(target.x + Math.cos(az) * ring, sunHeight, target.z + Math.sin(az) * ring);
  sun.target.position.copy(target);
  sun.target.updateMatrixWorld();
  sun.color.set(golden ? 0xffb068 : night ? 0xc5d4ea : 0xfff3d6);
  sun.intensity = (night ? 0.42 : 0.55 + day * 1.55) * (rainy ? 0.55 : cloudy ? 0.78 : 1);
  sun.castShadow = quality.shadows && !night;

  fill.position.set(target.x - Math.cos(az) * 70, 40, target.z - Math.sin(az) * 70);
  fill.target.position.copy(target);
  fill.target.updateMatrixWorld();
  fill.color.set(night ? 0x8aa0c0 : 0xb7d4e8);
  fill.intensity = night ? 0.22 : 0.28;

  const sunDir = sun.position.clone().sub(target).normalize();
  seaMaterial.uniforms.uSunDir.value.copy(sunDir);
  seaMaterial.uniforms.uNight.value = nightAmt;
  seaMaterial.uniforms.uShade.value = night ? 0.78 : rainy ? 0.82 : 1;
  if (night) {
    seaMaterial.uniforms.uDeep.value.set(0x123f78);
    seaMaterial.uniforms.uMid.value.set(0x1f5f9c);
    seaMaterial.uniforms.uShallow.value.set(0x2f78b4);
    seaMaterial.uniforms.uHorizon.value.set(0x6e84a0);
  } else if (golden) {
    seaMaterial.uniforms.uDeep.value.set(0x0f4c8e);
    seaMaterial.uniforms.uMid.value.set(0x1f74b4);
    seaMaterial.uniforms.uShallow.value.set(0x3e94c4);
    seaMaterial.uniforms.uHorizon.value.set(0xe2b888);
  } else {
    seaMaterial.uniforms.uDeep.value.set(0x0e4f96);
    seaMaterial.uniforms.uMid.value.set(0x1e7ec4);
    seaMaterial.uniforms.uShallow.value.set(0x3ea0d4);
    seaMaterial.uniforms.uHorizon.value.set(0xc9b089);
  }

  clouds.visible = quality.clouds && !night;
  (clouds.material as THREE.MeshBasicMaterial).color.set(golden ? 0xffe0c4 : 0xfff4ea);

  const starMat = stars.material as THREE.PointsMaterial;
  stars.visible = quality.stars && nightAmt > 0.25;
  starMat.opacity = nightAmt * 0.85;

  moon.visible = nightAmt > 0.35;
  moon.position.set(target.x - Math.cos(az) * 320, 240, target.z - Math.sin(az) * 320);

  sunDisc.visible = false;
  sunDisc.position.copy(sun.position);

  return {
    nightLit: night || day < 0.28,
    exposure: night ? 1.08 : golden ? 1.04 : 0.98,
  };
}

export function nightWindowCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uNightWindows = { value: 0 };
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    `#include <common>
     uniform float uNightWindows;`,
  ).replace(
    "#include <emissivemap_fragment>",
    `#include <emissivemap_fragment>
     float windowMask = step(0.42, diffuseColor.b) * step(diffuseColor.g, diffuseColor.b + 0.08) * step(diffuseColor.r, 0.72) * step(0.38, diffuseColor.g);
     vec3 lamp = vec3(1.0, 0.86, 0.52);
     diffuseColor.rgb = mix(diffuseColor.rgb, lamp, windowMask * uNightWindows);
     totalEmissiveRadiance += lamp * windowMask * uNightWindows * 1.15;`,
  );
}

function skyGradient(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x4a90d4) },
      uHorizon: { value: new THREE.Color(0xf3d2a0) },
      uNight: { value: 0 },
      uHaze: { value: 0.1 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform float uNight;
      uniform float uHaze;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.72 + 0.28, 0.0, 1.0);
        float band = smoothstep(0.18, 0.78, h);
        vec3 color = mix(uHorizon, uZenith, band);
        color = mix(color, vec3(0.92, 0.95, 0.98), uHaze * (1.0 - band) * 0.35);
        float glow = pow(1.0 - abs(vDir.y), 4.0) * (1.0 - uNight) * 0.18;
        color += vec3(1.0, 0.78, 0.42) * glow;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function cloudGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(38, 10, 22),
    new THREE.BoxGeometry(22, 8, 16),
    new THREE.BoxGeometry(16, 7, 14),
  ];
  parts[1].translate(14, 2, 4);
  parts[2].translate(-12, 1, -3);
  const merged = mergeBoxes(parts);
  for (const part of parts) part.dispose();
  return merged;
}

function mergeBoxes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const part of parts) {
    verts += part.getAttribute("position").count;
    idx += part.getIndex()?.count ?? 0;
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const index = new Uint16Array(idx);
  let v = 0;
  let c = 0;
  for (const part of parts) {
    const p = part.getAttribute("position");
    const n = part.getAttribute("normal");
    const base = v;
    for (let i = 0; i < p.count; i += 1) {
      position.set([p.getX(i), p.getY(i), p.getZ(i)], (v + i) * 3);
      normal.set([n.getX(i), n.getY(i), n.getZ(i)], (v + i) * 3);
    }
    v += p.count;
    const pi = part.getIndex();
    if (pi) {
      for (let i = 0; i < pi.count; i += 1) index[c++] = pi.getX(i) + base;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

