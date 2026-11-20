/**
 * Roller coasters in the park scene: one merged mesh for every track (rails, spine, ties, support
 * pillars, stations), one instanced mesh for all cars and one for their riders, plus the editor
 * preview (next piece, station footprint). Trains follow the smooth centre line from coaster.ts
 * with the same speed profile the ratings use (gravity, friction, chain lift, station tyres).
 */
import * as THREE from "three";
import {
  PARK_SIZE,
  PARK_TILE,
  STATION_LEN,
  UNIT_M,
  coasterLayout,
  pointAt,
  simulate,
  trackPath,
  walkable,
  type Coaster,
  type PieceKind,
  type RideRun,
  type RideState,
  type TrackPath,
} from "../../../shared/src/index.ts";
import { ballPart as ball, box, compose, type Part } from "./models.ts";

export const COASTER_COLORS = [
  { rail: 0xe2463a, spine: 0xb03428, roof: 0xe2463a },
  { rail: 0x2f86d8, spine: 0x235f9a, roof: 0x2f86d8 },
  { rail: 0x3fae5a, spine: 0x2c7c40, roof: 0x3fae5a },
  { rail: 0x9a5ad0, spine: 0x6c3e94, roof: 0x9a5ad0 },
];
const SUPPORT = 0xeee8da;
const TIE = 0x4c4c56;
const HALF = (PARK_SIZE * PARK_TILE) / 2;
const CARS = 4;
const CAR_GAP = 1.12;
/** Where the front car stops in the station (arc length). */
const STOP_S = STATION_LEN * PARK_TILE - 0.75;
const CAR_CAP = 16;

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  private readonly c = new THREE.Color();

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.c.setHex(color);
    this.col.push(this.c.r, this.c.g, this.c.b);
    return this.pos.length / 3 - 1;
  }

  /** Box with its own axes (unit vectors) and half sizes. */
  orientedBox(c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, az: THREE.Vector3, hx: number, hy: number, hz: number, color: number): void {
    const faces: [THREE.Vector3, THREE.Vector3, THREE.Vector3, number, number, number][] = [
      [ax, ay, az, hx, hy, hz],
      [ay, az, ax, hy, hz, hx],
      [az, ax, ay, hz, hx, hy],
    ];
    for (const [n, u, v, hn, hu, hv] of faces) {
      for (const sign of [1, -1]) {
        const base = this.pos.length / 3;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const su = sign > 0 ? a : -a;
          this.vertex(
            c.x + n.x * hn * sign + u.x * hu * su + v.x * hv * b,
            c.y + n.y * hn * sign + u.y * hu * su + v.y * hv * b,
            c.z + n.z * hn * sign + u.z * hu * su + v.z * hv * b,
            n.x * sign, n.y * sign, n.z * sign, color,
          );
        }
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  /** Four-sided tube through rings (each ring: centre, side, up, half width, half height). */
  tube(rings: { c: THREE.Vector3; s: THREE.Vector3; u: THREE.Vector3 }[], hw: number, hh: number, color: number, closed: boolean): void {
    const n = rings.length;
    if (n < 2) return;
    const base = this.pos.length / 3;
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (const ring of rings) {
      for (const [a, b] of corners) {
        const nx = ring.s.x * a + ring.u.x * b;
        const ny = ring.s.y * a + ring.u.y * b;
        const nz = ring.s.z * a + ring.u.z * b;
        const l = Math.hypot(nx, ny, nz) || 1;
        this.vertex(ring.c.x + ring.s.x * hw * a + ring.u.x * hh * b, ring.c.y + ring.s.y * hw * a + ring.u.y * hh * b, ring.c.z + ring.s.z * hw * a + ring.u.z * hh * b, nx / l, ny / l, nz / l, color);
      }
    }
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i += 1) {
      const a = base + i * 4;
      const b = base + ((i + 1) % n) * 4;
      for (let k = 0; k < 4; k += 1) {
        const k2 = (k + 1) % 4;
        this.idx.push(a + k, b + k2, b + k, a + k, a + k2, b + k2);
      }
    }
  }

  /** Append a (vertex-coloured) geometry with a transform. */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, tint?: number): void {
    const p = geometry.getAttribute("position");
    const n = geometry.getAttribute("normal");
    const c = geometry.getAttribute("color");
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.pos.length / 3;
    const v = new THREE.Vector3();
    const tintColor = tint !== undefined ? new THREE.Color(tint) : null;
    for (let i = 0; i < p.count; i += 1) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      this.nor.push(v.x, v.y, v.z);
      let r = c.getX(i);
      let g = c.getY(i);
      let b = c.getZ(i);
      // Pure white parts take the coaster colour.
      if (tintColor && r > 0.99 && g > 0.99 && b > 0.99) {
        r = tintColor.r;
        g = tintColor.g;
        b = tintColor.b;
      }
      this.col.push(r, g, b);
    }
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i += 1) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i += 1) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geometry.setIndex(this.idx);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Station: platforms on both sides, a roof on posts, a gate; local +z = travel direction, length 6. */
let stationGeo: THREE.BufferGeometry | null = null;
function stationGeometry(): THREE.BufferGeometry {
  if (stationGeo) return stationGeo;
  const L = STATION_LEN * PARK_TILE;
  const stone = 0xd2c6ae;
  const parts: Part[] = [
    box(-0.82, 0.2, L / 2, 0.62, 0.4, L - 0.1, stone),
    box(0.82, 0.2, L / 2, 0.62, 0.4, L - 0.1, stone),
    box(-0.82, 0.41, L / 2, 0.64, 0.03, L - 0.06, 0xe8dcc4),
    box(0.82, 0.41, L / 2, 0.64, 0.03, L - 0.06, 0xe8dcc4),
    // yellow safety edge
    box(-0.53, 0.43, L / 2, 0.05, 0.02, L - 0.1, 0xf2c64a),
    box(0.53, 0.43, L / 2, 0.05, 0.02, L - 0.1, 0xf2c64a),
  ];
  for (const z of [0.3, L / 2, L - 0.3]) for (const x of [-1.05, 1.05]) parts.push(box(x, 1.45, z, 0.1, 2.1, 0.1, 0x6a5a4a));
  // Roof: two pitched halves in the coaster colour (white → tinted), dark rim.
  parts.push(box(-0.62, 2.62, L / 2, 1.34, 0.08, L + 0.3, 0xffffff, { rz: 0.28 }));
  parts.push(box(0.62, 2.62, L / 2, 1.34, 0.08, L + 0.3, 0xffffff, { rz: -0.28 }));
  parts.push(box(0, 2.82, L / 2, 0.12, 0.1, L + 0.3, 0x5a3a2a));
  // railings at the outer platform edges
  for (const x of [-1.1, 1.1]) {
    parts.push(box(x, 0.78, L / 2, 0.04, 0.04, L - 0.2, 0xd8d0c0));
    for (let z = 0.3; z < L; z += 0.9) parts.push(box(x, 0.6, z, 0.04, 0.38, 0.04, 0xd8d0c0));
  }
  // sign with a little coaster swoosh
  parts.push(box(0, 3.15, L - 0.05, 1.3, 0.42, 0.06, 0xfdf6ea));
  parts.push(box(-0.3, 3.15, L - 0.01, 0.5, 0.06, 0.02, 0xffffff, { rz: 0.5 }));
  parts.push(box(0.22, 3.12, L - 0.01, 0.5, 0.06, 0.02, 0xffffff, { rz: -0.4 }));
  stationGeo = compose(parts);
  return stationGeo;
}

/** One car: local +z forward, +y up, sits on the rails (y = 0 at the rail top). */
let carGeo: THREE.BufferGeometry | null = null;
function carGeometry(): THREE.BufferGeometry {
  if (carGeo) return carGeo;
  const parts: Part[] = [
    box(0, 0.06, 0, 0.5, 0.1, 0.8, 0x3a3a40),
    box(0, 0.26, 0, 0.86, 0.3, 0.98, 0xffffff),
    box(0, 0.3, 0.5, 0.78, 0.22, 0.12, 0xffffff, { rx: -0.5 }),
    box(0, 0.44, -0.12, 0.74, 0.34, 0.08, 0x2c2c34),
    box(0, 0.44, 0.34, 0.74, 0.3, 0.08, 0x2c2c34),
    box(0, 0.42, 0.08, 0.7, 0.04, 0.4, 0x3c3c44),
    box(0, 0.42, -0.36, 0.7, 0.04, 0.3, 0x3c3c44),
    box(-0.44, 0.42, 0, 0.04, 0.08, 0.9, 0xd8d8de),
    box(0.44, 0.42, 0, 0.04, 0.08, 0.9, 0xd8d8de),
    // lap bars
    box(0, 0.56, 0.2, 0.66, 0.05, 0.05, 0xf2c64a),
    box(0, 0.56, -0.26, 0.66, 0.05, 0.05, 0xf2c64a),
  ];
  carGeo = compose(parts);
  return carGeo;
}

/** Two rows of two riders with raised arms (vertex colours, no tint). */
let riderGeo: THREE.BufferGeometry | null = null;
function riderGeometry(): THREE.BufferGeometry {
  if (riderGeo) return riderGeo;
  const shirts = [0x3d88c8, 0xf0b43c, 0xe98a5a, 0x3d8a4a];
  const hair = [0x3a2418, 0xe0c070, 0x6a3a1a, 0x1a1a1a];
  const parts: Part[] = [];
  let k = 0;
  for (const z of [0.12, -0.32]) {
    for (const x of [-0.18, 0.18]) {
      parts.push(box(x, 0.66, z, 0.24, 0.32, 0.18, shirts[k % 4]));
      parts.push(ball(x, 0.94, z + 0.01, 0.12, 0xf0c8a0));
      parts.push(ball(x, 1.0, z - 0.02, 0.115, hair[k % 4], 0.07));
      parts.push(box(x - 0.11, 1.0, z + 0.02, 0.06, 0.34, 0.06, 0xf0c8a0, { rz: 0.35 }));
      parts.push(box(x + 0.11, 1.0, z + 0.02, 0.06, 0.34, 0.06, 0xf0c8a0, { rz: -0.35 }));
      k += 1;
    }
  }
  riderGeo = compose(parts);
  return riderGeo;
}

interface Train {
  key: string;
  path: TrackPath;
  run: RideRun;
  state: RideState;
  s: number;
  dwell: number;
  speed: number;
  color: number;
  riders: boolean;
}

export interface RidePose {
  position: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  kmh: number;
}

export class CoasterLayer {
  private readonly track: THREE.Mesh;
  private readonly cars: THREE.InstancedMesh;
  private readonly riders: THREE.InstancedMesh;
  private readonly preview: THREE.Mesh;
  private readonly marker: THREE.Mesh;
  private readonly stationGhost: THREE.Mesh;
  private readonly trains = new Map<number, Train>();
  private trackKey = "";
  /** Coaster ridden in first person: its front riders are hidden (the camera sits there). */
  riding = -1;
  private readonly m = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(private readonly scene: THREE.Scene, material: THREE.Material, low: boolean) {
    this.track = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.track.castShadow = !low;
    this.track.receiveShadow = true;
    this.cars = new THREE.InstancedMesh(carGeometry(), material, CAR_CAP);
    this.cars.count = 0;
    this.cars.frustumCulled = false;
    this.cars.castShadow = !low;
    this.riders = new THREE.InstancedMesh(riderGeometry(), material, CAR_CAP);
    this.riders.count = 0;
    this.riders.frustumCulled = false;
    this.preview = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x7cd67c, transparent: true, opacity: 0.6, depthWrite: false }));
    this.preview.visible = false;
    this.preview.renderOrder = 4;
    const cone = new THREE.ConeGeometry(0.42, 0.9, 4).rotateX(Math.PI / 2);
    this.marker = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, depthWrite: false }));
    this.marker.visible = false;
    this.marker.renderOrder = 5;
    const ghostGeo = new THREE.BoxGeometry(PARK_TILE * 0.94, 0.5, STATION_LEN * PARK_TILE - 0.1).translate(0, 0.25, (STATION_LEN * PARK_TILE) / 2);
    const arrow = new THREE.ConeGeometry(0.6, 1.2, 3).rotateX(Math.PI / 2).translate(0, 0.9, STATION_LEN * PARK_TILE + 0.2);
    this.stationGhost = new THREE.Mesh(mergeSimple([ghostGeo, arrow]), new THREE.MeshBasicMaterial({ color: 0x7cd67c, transparent: true, opacity: 0.5, depthWrite: false }));
    this.stationGhost.visible = false;
    this.stationGhost.renderOrder = 4;
    scene.add(this.track, this.cars, this.riders, this.preview, this.marker, this.stationGhost);
  }

  /** Rebuild tracks when they change; keep trains running where the track stayed the same. */
  setCoasters(coasters: Coaster[], grid: Uint8Array): void {
    const key = coasters.map((c) => `${c.id}:${c.station}:${c.dir}:${c.pieces.join("")}`).join("|");
    if (key !== this.trackKey) {
      this.trackKey = key;
      this.track.geometry.dispose();
      this.track.geometry = this.buildTracks(coasters, grid);
    }
    const seen = new Set<number>();
    for (const coaster of coasters) {
      seen.add(coaster.id);
      const k = `${coaster.station}:${coaster.dir}:${coaster.pieces.join("")}`;
      let train = this.trains.get(coaster.id);
      if (!train || train.key !== k) {
        const path = trackPath(coaster);
        train = { key: k, path, run: simulate(path), state: coaster.state, s: STOP_S, dwell: 1, speed: 0, color: COASTER_COLORS[coaster.id % COASTER_COLORS.length].rail, riders: false };
        this.trains.set(coaster.id, train);
      }
      if (train.state !== coaster.state && coaster.state !== "closed" && train.state === "closed") {
        // Leaving the station for a test run or opening: start right away.
        train.dwell = 0.6;
      }
      train.state = coaster.state;
      train.riders = coaster.state === "open";
    }
    for (const id of [...this.trains.keys()]) if (!seen.has(id)) this.trains.delete(id);
  }

  private buildTracks(coasters: Coaster[], grid: Uint8Array): THREE.BufferGeometry {
    const b = new MeshBuilder();
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    const u = new THREE.Vector3();
    const t = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    for (const coaster of coasters) {
      const colors = COASTER_COLORS[coaster.id % COASTER_COLORS.length];
      const path = trackPath(coaster);
      const pts = path.points;
      const rails: { c: THREE.Vector3; s: THREE.Vector3; u: THREE.Vector3 }[][] = [[], [], []];
      for (const p of pts) {
        t.set(...p.t);
        u.set(...p.up);
        s.crossVectors(u, t).normalize();
        const base = new THREE.Vector3(p.x, p.y, p.z);
        rails[0].push({ c: base.clone().addScaledVector(s, 0.3).addScaledVector(u, 0.04), s: s.clone(), u: u.clone() });
        rails[1].push({ c: base.clone().addScaledVector(s, -0.3).addScaledVector(u, 0.04), s: s.clone(), u: u.clone() });
        rails[2].push({ c: base.clone().addScaledVector(u, -0.16), s: s.clone(), u: u.clone() });
      }
      b.tube(rails[0], 0.055, 0.055, colors.rail, path.closed);
      b.tube(rails[1], 0.055, 0.055, colors.rail, path.closed);
      b.tube(rails[2], 0.09, 0.11, colors.spine, path.closed);
      // Ties and support pillars by arc length.
      let nextTie = 0;
      let nextPost = 0.9;
      for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i];
        t.set(...p.t);
        u.set(...p.up);
        s.crossVectors(u, t).normalize();
        if (p.s >= nextTie) {
          nextTie = p.s + 0.62;
          c.set(p.x, p.y, p.z).addScaledVector(u, -0.04);
          b.orientedBox(c, s, u, t, 0.36, 0.035, 0.05, TIE);
        }
        if (p.s >= nextPost && !p.station) {
          // Upright track only (not upside down in a loop), and never in the middle of a path.
          const tx = Math.floor((p.x + HALF) / PARK_TILE);
          const tz = Math.floor((p.z + HALF) / PARK_TILE);
          const onPath = tx >= 0 && tz >= 0 && tx < PARK_SIZE && tz < PARK_SIZE && walkable(grid[tz * PARK_SIZE + tx]);
          if (u.y > 0.75 && !onPath) {
            nextPost = p.s + 1.7;
            const top = p.y - 0.24;
            if (top > 0.05) {
              const height = top;
              c.set(p.x, height / 2, p.z);
              b.orientedBox(c, new THREE.Vector3(1, 0, 0), Y, new THREE.Vector3(0, 0, 1), 0.075, height / 2, 0.075, SUPPORT);
              c.set(p.x, 0.04, p.z);
              b.orientedBox(c, new THREE.Vector3(1, 0, 0), Y, new THREE.Vector3(0, 0, 1), 0.16, 0.04, 0.16, 0xb8b0a0);
              if (height > 2.2) {
                // Cross brace on tall pillars.
                c.set(p.x, height * 0.55, p.z);
                b.orientedBox(c, s.clone().setY(0).normalize(), Y, t.clone().setY(0).normalize(), 0.5, 0.04, 0.04, SUPPORT);
              }
            }
          }
        }
      }
      // Loops get a sturdy A-frame beside the top.
      const loops = new Set<number>();
      coaster.pieces.forEach((piece, index) => piece === "loop" && loops.add(index));
      for (const index of loops) {
        const own = pts.filter((p) => p.piece === index);
        if (own.length < 4) continue;
        const top = own.reduce((best, p) => (p.y > best.y ? p : best), own[0]);
        t.set(...own[0].t).setY(0).normalize();
        s.set(-t.z, 0, t.x);
        for (const side of [-1, 1]) {
          const foot = new THREE.Vector3(top.x, 0, top.z).addScaledVector(s, side * 1.3 + 0.45);
          const head = new THREE.Vector3(top.x, top.y - 0.1, top.z).addScaledVector(s, 0.45 + side * 0.45);
          const mid = foot.clone().add(head).multiplyScalar(0.5);
          const dir = head.clone().sub(foot);
          const len = dir.length();
          dir.normalize();
          const ax = new THREE.Vector3().crossVectors(dir, t).normalize();
          // (ax, dir, t) is right-handed: ax × dir = t.
          b.orientedBox(mid, ax, dir, t, 0.075, len / 2, 0.075, SUPPORT);
        }
      }
      // Station building.
      const layout = coasterLayout(coaster);
      if (layout.tiles.length >= STATION_LEN) {
        const first = pts[0];
        this.m.makeRotationY(Math.atan2(first.t[0], first.t[2]));
        this.m.setPosition(first.x, 0, first.z);
        b.add(stationGeometry(), this.m, colors.roof);
      }
    }
    return b.build();
  }

  /** Advance the trains and place cars and riders. */
  update(dt: number): void {
    let n = 0;
    let r = 0;
    for (const train of this.trains.values()) {
      const path = train.path;
      if (!path.closed || path.points.length < 2) continue;
      const running = train.state !== "closed" && train.run.ok;
      if (running) {
        if (train.dwell > 0) {
          train.dwell -= dt;
          train.speed = 0;
        } else {
          const at = pointAt(path, train.s);
          const v = train.run.speed[at.i] ?? 2;
          train.speed = v;
          const before = train.s;
          train.s += v * dt;
          if (before < STOP_S && train.s >= STOP_S) {
            train.s = STOP_S;
            train.dwell = train.state === "open" ? 2.4 : 1.2;
          }
          if (train.s >= path.length) {
            train.s -= path.length;
            if (train.s >= STOP_S) {
              train.s = STOP_S;
              train.dwell = train.state === "open" ? 2.4 : 1.2;
            }
          }
        }
      } else {
        train.s = STOP_S;
        train.speed = 0;
      }
      const id = [...this.trains.entries()].find(([, entry]) => entry === train)?.[0] ?? -1;
      for (let k = 0; k < CARS && n < CAR_CAP; k += 1) {
        this.carMatrix(path, train.s - k * CAR_GAP - 0.5, this.m);
        this.cars.setMatrixAt(n, this.m);
        this.cars.setColorAt(n, this.color.setHex(train.color));
        n += 1;
        if (train.riders && !(k === 0 && id === this.riding)) {
          this.riders.setMatrixAt(r, this.m);
          this.riders.setColorAt(r, this.color.setHex(0xffffff));
          r += 1;
        }
      }
    }
    this.cars.count = n;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
    this.riders.count = r;
    this.riders.instanceMatrix.needsUpdate = true;
    if (this.riders.instanceColor) this.riders.instanceColor.needsUpdate = true;
  }

  private carMatrix(path: TrackPath, s: number, out: THREE.Matrix4): void {
    const at = pointAt(path, s);
    const z = new THREE.Vector3(...at.t);
    const y = new THREE.Vector3(...at.up);
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    y.crossVectors(z, x).normalize();
    out.makeBasis(x, y, z);
    out.setPosition(at.x + y.x * 0.08, at.y + y.y * 0.08, at.z + y.z * 0.08);
  }

  /** Front seat of a running train (for the ride camera), or null. */
  pose(id: number): RidePose | null {
    const train = this.trains.get(id);
    if (!train || !train.path.closed) return null;
    const at = pointAt(train.path, train.s - 0.45);
    const ahead = pointAt(train.path, train.s + 0.9);
    const up = new THREE.Vector3(...at.up);
    // Look slightly ahead along the track so crests and loop entries read early.
    const forward = new THREE.Vector3(...at.t).multiplyScalar(0.55).add(new THREE.Vector3(...ahead.t).multiplyScalar(0.45)).normalize();
    const position = new THREE.Vector3(at.x, at.y, at.z).addScaledVector(up, 1.0).addScaledVector(forward, 0.1);
    return { position, forward, up, kmh: Math.round(train.speed * UNIT_M * 3.6) };
  }

  running(id: number): boolean {
    const train = this.trains.get(id);
    return !!train && train.state !== "closed" && train.run.ok;
  }

  /** Train counts for tests. */
  stats(): { trains: number; cars: number; riders: number; moving: number } {
    return {
      trains: this.trains.size,
      cars: this.cars.count,
      riders: this.riders.count,
      moving: [...this.trains.values()].filter((train) => train.speed > 0).length,
    };
  }

  /** Arc position of a train (tests: the train moves). */
  trainS(id: number): number {
    return this.trains.get(id)?.s ?? -1;
  }

  /** Editor: the next piece as a translucent ribbon (green fits, red blocked), marker at the open end. */
  setPreview(coaster: Pick<Coaster, "station" | "dir" | "pieces"> | null, piece: PieceKind | null, ok: boolean): void {
    this.preview.visible = false;
    this.marker.visible = false;
    if (!coaster) return;
    const base = trackPath(coaster);
    if (base.closed) return;
    const end = base.points[base.points.length - 1];
    if (end) {
      this.marker.visible = true;
      this.marker.position.set(end.x, end.y + 0.9, end.z);
      this.marker.lookAt(end.x + end.t[0], end.y + 0.9, end.z + end.t[2]);
    }
    if (!piece) return;
    const next = trackPath({ ...coaster, pieces: [...coaster.pieces, piece] });
    const index = coaster.pieces.length;
    const own = next.points.filter((p) => p.piece === index || (p.piece === index - 1 && p === next.points[next.points.length - 1]));
    if (coasterLayout({ ...coaster, pieces: [...coaster.pieces, piece] }).valid <= index) {
      (this.marker.material as THREE.MeshBasicMaterial).color.setHex(0xe8604c);
      return;
    }
    (this.marker.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0xffe27a : 0xe8604c);
    // Include the end point of the new piece (next piece's start or the closing point).
    const after = next.points.find((p) => p.piece > index);
    const pts = after ? [...own, after] : next.closed ? [...own, next.points[0]] : own;
    if (pts.length < 2) return;
    const b = new MeshBuilder();
    const rings = pts.map((p) => {
      const t = new THREE.Vector3(...p.t);
      const u = new THREE.Vector3(...p.up);
      return { c: new THREE.Vector3(p.x, p.y, p.z), s: new THREE.Vector3().crossVectors(u, t).normalize(), u };
    });
    b.tube(rings, 0.42, 0.1, 0xffffff, false);
    this.preview.geometry.dispose();
    this.preview.geometry = b.build();
    (this.preview.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x7cd67c : 0xe8604c);
    this.preview.visible = true;
    if (after) this.marker.position.set(after.x, after.y + 0.9, after.z);
  }

  /** Station placement preview: footprint from a tile in a direction, arrow = travel direction. */
  setStationGhost(tile: number, dir: number, ok: boolean): void {
    this.stationGhost.visible = tile >= 0;
    if (tile < 0) return;
    const x = (tile % PARK_SIZE + 0.5) * PARK_TILE - HALF;
    const z = (Math.floor(tile / PARK_SIZE) + 0.5) * PARK_TILE - HALF;
    const fx = [0, 1, 0, -1][dir];
    const fz = [-1, 0, 1, 0][dir];
    this.stationGhost.position.set(x - fx * (PARK_TILE / 2), 0.02, z - fz * (PARK_TILE / 2));
    this.stationGhost.rotation.set(0, Math.atan2(fx, fz), 0);
    (this.stationGhost.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x7cd67c : 0xe8604c);
  }

  meshes(): number {
    return 3;
  }

  dispose(): void {
    this.track.geometry.dispose();
    this.preview.geometry.dispose();
    this.scene.remove(this.track, this.cars, this.riders, this.preview, this.marker, this.stationGhost);
  }
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const m = new THREE.Matrix4();
  for (const g of list) {
    const geo = g.index ? g : g;
    if (!geo.getAttribute("color")) {
      const count = geo.getAttribute("position").count;
      geo.setAttribute("color", new THREE.Float32BufferAttribute(new Array(count * 3).fill(1), 3));
    }
    b.add(geo, m);
  }
  return b.build();
}

