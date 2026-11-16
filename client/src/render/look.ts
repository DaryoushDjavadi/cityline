import * as THREE from "three";
import type { Climate } from "../../../shared/src/index.ts";
import type { GfxProfile } from "./quality.ts";

const tmp = new THREE.Color();
const tmpB = new THREE.Color();
const cloudDummy = new THREE.Object3D();

/** Default camera azimuth is ~0.58; sun sits front-left in that framing. */
const DEFAULT_AZIMUTH = 0.58;
const DUSK_HEADING = Math.atan2(
  -Math.cos(DEFAULT_AZIMUTH) + 0.62 * Math.sin(DEFAULT_AZIMUTH),
  -Math.sin(DEFAULT_AZIMUTH) - 0.62 * Math.cos(DEFAULT_AZIMUTH),
);

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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 64, 32), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -20;

  const cloudGeo = new THREE.SphereGeometry(18, 7, 5);
  const clouds = new THREE.InstancedMesh(
    cloudGeo,
    new THREE.MeshBasicMaterial({ color: 0xf2e4d0, transparent: true, opacity: 0.94, depthWrite: false }),
    8,
  );
  clouds.count = 8;
  clouds.frustumCulled = false;
  clouds.castShadow = false;
  clouds.receiveShadow = false;
  clouds.renderOrder = -5;
  layoutClouds(clouds, new THREE.Vector3());

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const p = Math.acos(Math.random() * 0.72);
    const r = 1100;
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
    new THREE.SphereGeometry(11, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff4c8 }),
  );
  moon.frustumCulled = false;

  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(9, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  sunDisc.frustumCulled = false;

  return { sky, skyMaterial, clouds, stars, moon, sunDisc };
}

export function sunElevation(hour: number): number {
  const t = (hour - 5.7) / 13.6;
  return Math.max(0.02, Math.sin(Math.PI * Math.max(0, Math.min(1, t))));
}

export function poseSun(hour: number, target: THREE.Vector3): THREE.Vector3 {
  const elev = sunElevation(hour);
  const golden = goldenAmount(hour);
  const height = 16 + elev * 88 - golden * 8;
  const ring = 108 + (1 - elev) * 70;
  return new THREE.Vector3(
    target.x + Math.cos(DUSK_HEADING) * ring,
    height,
    target.z + Math.sin(DUSK_HEADING) * ring,
  );
}

export function seaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uShade: { value: 1 },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.28, -0.4) },
      uDeep: { value: new THREE.Color(0x1a5f8a) },
      uMid: { value: new THREE.Color(0x2474a0) },
      uShallow: { value: new THREE.Color(0x2f88b0) },
      uHorizon: { value: new THREE.Color(0xf0c48a) },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec3 shifted = position;
        float wave = sin(position.x * 0.018 + uTime * 0.28) * 0.09
          + sin(position.z * 0.014 - uTime * 0.22) * 0.06;
        shifted.y += wave;
        vNormalW = normalize(vec3(
          -cos(position.x * 0.018 + uTime * 0.28) * 0.018,
          1.0,
          -cos(position.z * 0.014 - uTime * 0.22) * 0.014
        ));
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
      varying vec3 vNormalW;
      void main() {
        float dist = length(vWorld.xz);
        float near = smoothstep(420.0, 140.0, dist);
        vec3 color = mix(uDeep, uMid, 0.38 + near * 0.28);
        color = mix(color, uShallow, near * 0.16);
        vec3 n = normalize(vNormalW);
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 sun = normalize(uSunDir);
        vec3 h = normalize(sun + view);
        float spec = pow(max(dot(n, h), 0.0), 70.0);
        vec2 sunXZ = normalize(sun.xz + vec2(0.0001));
        float along = dot(normalize(vWorld.xz + vec2(0.0001)), sunXZ);
        vec2 acrossV = vWorld.xz - sunXZ * dot(vWorld.xz, sunXZ);
        float streak = exp(-dot(acrossV, acrossV) * 0.000055) * smoothstep(-0.15, 0.55, along)
          * (1.0 - smoothstep(380.0, 1200.0, dist));
        vec3 glitter = mix(vec3(1.0, 0.86, 0.55), vec3(0.78, 0.88, 1.0), uNight);
        color += glitter * (spec * 0.12 * (1.0 - smoothstep(320.0, 980.0, dist)) + streak * mix(0.22, 0.08, uNight));
        vec3 ray = normalize(vWorld - cameraPosition);
        float horizonFade = smoothstep(0.002, -0.003, ray.y) * smoothstep(1500.0, 2800.0, dist);
        vec3 hazeCol = mix(uMid, uHorizon, mix(0.32, 0.1, uNight));
        color = mix(color, hazeCol, horizonFade * mix(0.12, 0.06, uNight));
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 5.0);
        color = mix(color, uMid, fresnel * 0.06 * (1.0 - uNight));
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
  const goldenAmt = goldenAmount(climate.hour);
  const nightAmt = night ? 1 - Math.min(1, Math.max(0, (day - 0.14) / 0.2)) : Math.max(0, 0.28 - day) / 0.28;
  const elev = sunElevation(climate.hour);

  const zenith = night
    ? tmp.set(0x1a3d66)
    : rainy
      ? tmp.set(0x7a93a8)
      : tmp.set(goldenAmt > 0.45 ? 0x3a8ed4 : 0x2d7fc8);
  const horizon = night
    ? tmpB.set(0x2a4a72)
    : rainy
      ? tmpB.set(0xb7c4ce)
      : tmpB.set(goldenAmt > 0.45 ? 0xf4c992 : 0xd5e4f0);

  skyMaterial.uniforms.uZenith.value.copy(zenith);
  skyMaterial.uniforms.uHorizon.value.copy(horizon);
  skyMaterial.uniforms.uNight.value = nightAmt;
  skyMaterial.uniforms.uHaze.value = cloudy ? 0.35 : 0.04 + goldenAmt * 0.06;
  skyMaterial.uniforms.uGlow.value = night ? 0.04 : 0.45 + goldenAmt * 0.4;

  const sunPos = poseSun(climate.hour, target);
  sun.position.copy(sunPos);
  sun.target.position.copy(target);
  sun.target.updateMatrixWorld();
  const sunDir = sunPos.clone().sub(target).normalize();
  skyMaterial.uniforms.uSunDir.value.copy(sunDir);

  fog.color.copy(night || rainy ? zenith : tmp.set(0x17608c));
  fog.near = rainy ? 280 : 4200;
  fog.far = rainy ? 1200 : 9000;

  hemi.color.set(night ? 0xb0c0d8 : goldenAmt > 0.35 ? 0xffe0b8 : 0xe8f0ff);
  hemi.groundColor.set(night ? 0x3a4a42 : 0x5a7a38);
  hemi.intensity = night ? 0.8 : 0.62 + (1 - goldenAmt) * 0.18;

  sun.color.set(night ? 0xc5d4ea : tmp.setRGB(1, 0.78 - goldenAmt * 0.16, 0.48 - goldenAmt * 0.16).getHex());
  sun.intensity = (night ? 0.42 : 0.95 + elev * 0.55 + goldenAmt * 0.4) * (rainy ? 0.55 : cloudy ? 0.78 : 1);
  sun.castShadow = quality.shadows && !night;

  fill.position.set(target.x - sunDir.x * 80, 36, target.z - sunDir.z * 80);
  fill.target.position.copy(target);
  fill.target.updateMatrixWorld();
  fill.color.set(night ? 0x8aa0c0 : 0x9ec0e0);
  fill.intensity = night ? 0.28 : 0.58;

  seaMaterial.uniforms.uSunDir.value.copy(sunDir);
  seaMaterial.uniforms.uNight.value = nightAmt;
  seaMaterial.uniforms.uShade.value = night ? 0.8 : rainy ? 0.84 : 1;
  if (night) {
    seaMaterial.uniforms.uDeep.value.set(0x143a66);
    seaMaterial.uniforms.uMid.value.set(0x1d5580);
    seaMaterial.uniforms.uShallow.value.set(0x2a6a90);
    seaMaterial.uniforms.uHorizon.value.set(0x3d5a7a);
  } else {
    seaMaterial.uniforms.uDeep.value.set(0x17608c);
    seaMaterial.uniforms.uMid.value.set(0x2176a4);
    seaMaterial.uniforms.uShallow.value.set(0x2c88b2);
    seaMaterial.uniforms.uHorizon.value.set(goldenAmt > 0.3 ? 0xe8b878 : 0x6eb4c8);
  }

  clouds.visible = quality.clouds && !night;
  layoutClouds(clouds, target);
  (clouds.material as THREE.MeshBasicMaterial).color.set(goldenAmt > 0.4 ? 0xffe6cc : 0xfff8f0);

  const starMat = stars.material as THREE.PointsMaterial;
  stars.visible = quality.stars && nightAmt > 0.25;
  starMat.opacity = nightAmt * 0.85;

  moon.visible = nightAmt > 0.35;
  moon.position.set(target.x - sunDir.x * 340, 250, target.z - sunDir.z * 340);

  sunDisc.visible = !night && elev > 0.04;
  const along = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize().multiplyScalar(640);
  sunDisc.position.set(target.x + along.x, 70 + elev * 50, target.z + along.z);
  (sunDisc.material as THREE.MeshBasicMaterial).color.set(goldenAmt > 0.3 ? 0xffd080 : 0xffeec0);

  return {
    nightLit: night || day < 0.28,
    exposure: night ? 1.05 : 0.98 + goldenAmt * 0.02,
  };
}

export function goldenAmount(hour: number): number {
  const dusk = 1 - Math.min(1, Math.abs(hour - 17.2) / 2.6);
  const dawn = 1 - Math.min(1, Math.abs(hour - 6.8) / 1.8);
  return Math.max(0, dusk, dawn);
}

export const COLOR_GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uWarm: { value: 0.08 },
    uContrast: { value: 0.98 },
    uVignette: { value: 0.2 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uWarm;
    uniform float uContrast;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 color = src.rgb;
      color *= vec3(1.0 + uWarm * 0.16, 1.0 + uWarm * 0.02, 1.0 - uWarm * 0.1);
      color = mix(vec3(0.5), color, uContrast);
      float r = length(vUv - 0.5);
      color *= 1.0 - smoothstep(0.42, 0.95, r) * uVignette;
      gl_FragColor = vec4(color, src.a);
    }
  `,
};

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
     vec3 lamp = vec3(1.0, 0.78, 0.38);
     diffuseColor.rgb = mix(diffuseColor.rgb, lamp, windowMask * uNightWindows);
     totalEmissiveRadiance += lamp * windowMask * uNightWindows * 1.55;`,
  );
}

function skyGradient(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x4a90c8) },
      uHorizon: { value: new THREE.Color(0xf6d09a) },
      uNight: { value: 0 },
      uHaze: { value: 0.1 },
      uGlow: { value: 0.7 },
      uSunDir: { value: new THREE.Vector3(0.6, 0.25, -0.4) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform float uNight;
      uniform float uHaze;
      uniform float uGlow;
      uniform vec3 uSunDir;
      varying vec3 vWorld;
      void main() {
        vec3 ray = normalize(vWorld - cameraPosition);
        float h = ray.y;
        float band = smoothstep(-0.002, 0.012, h);
        vec3 color = mix(uHorizon, uZenith, band);
        vec3 sun = normalize(uSunDir);
        float sunDot = max(dot(ray, sun), 0.0);
        float glow = pow(sunDot, 8.0) * uGlow * (1.0 - uNight);
        float halo = pow(sunDot, 3.4) * 0.16 * uGlow * (1.0 - uNight);
        float low = pow(1.0 - clamp(h + 0.008, 0.0, 1.0), 6.5);
        color += vec3(1.0, 0.74, 0.34) * glow * 0.85;
        color += vec3(1.0, 0.82, 0.5) * halo * low;
        color = mix(color, uHorizon, uHaze * (1.0 - band) * 0.06);
        color = mix(color, vec3(0.07, 0.12, 0.24), uNight * 0.72);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function layoutClouds(clouds: THREE.InstancedMesh, target: THREE.Vector3): void {
  const az = DEFAULT_AZIMUTH;
  const fwdX = -Math.sin(az);
  const fwdZ = -Math.cos(az);
  const leftX = -Math.cos(az);
  const leftZ = Math.sin(az);
  for (let i = 0; i < clouds.count; i += 1) {
    const side = (i - (clouds.count - 1) / 2) * 70;
    const push = 200 + (i % 3) * 48;
    cloudDummy.position.set(
      target.x + fwdX * push + leftX * side,
      88 + (i % 4) * 14,
      target.z + fwdZ * push + leftZ * side,
    );
    cloudDummy.rotation.set(0, az + i * 0.35, 0.08 * (i % 3));
    const s = 1.05 + (i % 3) * 0.22;
    cloudDummy.scale.set(s * 1.7, s * 0.55, s);
    cloudDummy.updateMatrix();
    clouds.setMatrixAt(i, cloudDummy.matrix);
  }
  clouds.instanceMatrix.needsUpdate = true;
}
