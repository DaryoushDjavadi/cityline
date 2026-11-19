import * as THREE from "three";
import { CELL_SIZE, GRID_SIZE } from "../../../shared/src/index.ts";

const HALF = (GRID_SIZE * CELL_SIZE) / 2;
const ROTATE_TAP = 0.18;
/** Closest zoom: street level, houses and residents fill the screen. */
export const MIN_DISTANCE = 7;
export const MAX_DISTANCE = 560;
/** Below this distance the view flattens towards a side view (Cities: Skylines style). */
const CLOSE_START = 70;
const CLOSE_POLAR = 1.36;
/** Camera never goes below terrain/roofs + this margin. */
const CLEARANCE = 1.1;

export class RtsCamera {
  readonly camera = new THREE.PerspectiveCamera(56, 1, 0.5, 3200);
  readonly target = new THREE.Vector3(0, 0, 0);
  azimuth = 0.7;
  polar = 0.9;
  distance = 420;
  lookLift = 0;
  /** Ground (+ building) height under a world point; set by the game. */
  heightAt: ((x: number, z: number) => number) | null = null;

  private readonly keys = new Set<string>();
  private dragging: "pan" | "orbit" | null = null;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private viewW = 1;
  private viewH = 1;
  private focusEase: { x: number; z: number; distance: number } | null = null;
  /** Smooth wheel/trackpad zoom: eased towards the goal, keeping the point under the cursor fixed. */
  private zoomGoal: number | null = null;
  private zoomAnchor: { x: number; y: number; rect: DOMRect } | null = null;
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();

  resize(width: number, height: number): void {
    this.viewW = Math.max(width, 1);
    this.viewH = Math.max(height, 1);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  /** One discrete rotate step for a single Q/E press. */
  nudgeRotate(code: string): void {
    if (code === "KeyQ") this.azimuth += ROTATE_TAP;
    if (code === "KeyE") this.azimuth -= ROTATE_TAP;
  }

  begin(button: number, x: number, y: number, panMode = false, orbitMode = false): boolean {
    if (orbitMode && button === 0) this.dragging = "orbit";
    else if (panMode && button === 0) this.dragging = "pan";
    else if (button === 2) this.dragging = "orbit";
    else if (button === 1) this.dragging = "pan";
    else return false;
    this.dragMoved = false;
    this.lastX = x;
    this.lastY = y;
    this.focusEase = null;
    return true;
  }

  isDragging(): boolean {
    return this.dragging !== null;
  }

  /** True if the current/last drag actually moved the pointer. */
  didDrag(): boolean {
    return this.dragMoved;
  }

  move(x: number, y: number): void {
    if (!this.dragging) return;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.dragMoved = true;
    if (this.dragging === "orbit") {
      this.azimuth -= dx * 0.005;
      this.polar = clamp(this.polar - dy * 0.003, 0.38, 1.28);
      return;
    }
    this.pan(dx, dy);
  }

  end(): void {
    this.dragging = null;
  }

  wheel(deltaY: number, clientX?: number, clientY?: number, rect?: DOMRect): void {
    this.focusEase = null;
    // Mouse notches (~100) and trackpad/pinch deltas (1–10) both scale smoothly; huge deltas are capped.
    const step = clamp(deltaY, -240, 240) * 0.0013;
    this.zoomGoal = clamp((this.zoomGoal ?? this.distance) * Math.exp(step), MIN_DISTANCE, MAX_DISTANCE);
    this.zoomAnchor = clientX !== undefined && clientY !== undefined && rect ? { x: clientX, y: clientY, rect } : null;
  }

  /** Remaining wheel zoom (for tests / UI); null when settled. */
  zoomTarget(): number | null {
    return this.zoomGoal;
  }

  setDistance(value: number): void {
    this.zoomGoal = null;
    this.distance = clamp(value, MIN_DISTANCE, MAX_DISTANCE);
  }

  /** 0 when zoomed out, 1 at street level. */
  closeness(): number {
    const t = clamp((CLOSE_START - this.distance) / (CLOSE_START - MIN_DISTANCE), 0, 1);
    return t * t * (3 - 2 * t);
  }

  nudge(dx: number, dy: number): void {
    this.pan(dx, dy);
  }

  lookAt(x: number, z: number): void {
    const limit = HALF - 40;
    this.target.x = clamp(x, -limit, limit);
    this.target.z = clamp(z, -limit, limit);
  }

  /** Smooth zoom close to a world point (Doppelklick auf Gebäude). */
  focusNear(x: number, z: number, distance = 92): void {
    const limit = HALF - 40;
    this.focusEase = {
      x: clamp(x, -limit, limit),
      z: clamp(z, -limit, limit),
      distance: clamp(distance, MIN_DISTANCE, MAX_DISTANCE),
    };
  }

  /** Wide overview of the island, used when a level starts. */
  resetOverview(): void {
    this.focusEase = null;
    this.target.set(18, 0, 36);
    this.azimuth = 0.58;
    this.polar = 1.02;
    this.lookLift = 5;
    this.distance = 178;
  }

  update(dt: number): void {
    if (this.zoomGoal !== null) {
      const anchor = this.zoomAnchor;
      const before = anchor ? this.groundPoint(anchor.x, anchor.y, anchor.rect) : null;
      const ease = dt > 0 ? 1 - Math.exp(-dt * 12) : 1;
      this.distance += (this.zoomGoal - this.distance) * ease;
      if (Math.abs(this.zoomGoal - this.distance) < Math.max(0.02, this.distance * 0.002)) {
        this.distance = this.zoomGoal;
        this.zoomGoal = null;
      }
      if (before && anchor) {
        this.pose();
        this.camera.updateMatrixWorld(true);
        const after = this.groundPoint(anchor.x, anchor.y, anchor.rect);
        if (after) {
          this.target.x += before.x - after.x;
          this.target.z += before.z - after.z;
        }
      }
    }
    if (this.focusEase) {
      const ease = 1 - Math.exp(-dt * 7.5);
      this.target.x += (this.focusEase.x - this.target.x) * ease;
      this.target.z += (this.focusEase.z - this.target.z) * ease;
      this.distance += (this.focusEase.distance - this.distance) * ease;
      this.polar += (0.72 - this.polar) * ease;
      if (
        Math.hypot(this.focusEase.x - this.target.x, this.focusEase.z - this.target.z) < 0.4
        && Math.abs(this.focusEase.distance - this.distance) < 0.6
      ) {
        this.target.x = this.focusEase.x;
        this.target.z = this.focusEase.z;
        this.distance = this.focusEase.distance;
        this.focusEase = null;
      }
    }

    if (this.keys.has("KeyQ")) this.azimuth += dt * 0.85;
    if (this.keys.has("KeyE")) this.azimuth -= dt * 0.85;

    const forwardX = -Math.sin(this.azimuth);
    const forwardZ = -Math.cos(this.azimuth);
    const rightX = Math.cos(this.azimuth);
    const rightZ = -Math.sin(this.azimuth);
    let x = 0;
    let z = 0;
    if (this.keys.has("KeyW")) {
      x += forwardX;
      z += forwardZ;
    }
    if (this.keys.has("KeyS")) {
      x -= forwardX;
      z -= forwardZ;
    }
    if (this.keys.has("KeyD")) {
      x += rightX;
      z += rightZ;
    }
    if (this.keys.has("KeyA")) {
      x -= rightX;
      z -= rightZ;
    }
    if (x !== 0 || z !== 0) {
      const length = Math.hypot(x, z);
      const speed = this.distance * 0.9 * dt;
      this.target.x += (x / length) * speed;
      this.target.z += (z / length) * speed;
    }

    this.pose();
  }

  /** Places the camera: orbit pose, flatter and lower close up, never inside terrain or roofs. */
  private pose(): void {
    const limit = HALF - 40;
    this.target.x = clamp(this.target.x, -limit, limit);
    this.target.z = clamp(this.target.z, -limit, limit);
    this.polar = clamp(this.polar, 0.38, 1.28);

    const close = this.closeness();
    const polar = this.polar + (Math.max(this.polar, CLOSE_POLAR) - this.polar) * close;
    const ground = this.heightAt ? this.heightAt(this.target.x, this.target.z) : 0;
    // Up close we look at street/eye level of the ground under the target, not at y=0.
    const lookY = this.lookLift + (groundEye(ground) - this.lookLift) * close;
    const height = Math.cos(polar);
    const ring = Math.sin(polar);
    let camY = lookY + this.distance * height;
    const camX = this.target.x + this.distance * ring * Math.sin(this.azimuth);
    const camZ = this.target.z + this.distance * ring * Math.cos(this.azimuth);
    if (this.heightAt) camY = Math.max(camY, this.heightAt(camX, camZ) + CLEARANCE);
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.target.x, lookY, this.target.z);
    // Near plane follows the zoom so nothing close is cut off; far stays for the sky dome.
    const near = clamp(this.distance * 0.012, 0.08, 0.5);
    if (Math.abs(near - this.camera.near) > 0.005) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  private groundPoint(clientX: number, clientY: number, rect: DOMRect): { x: number; z: number } | null {
    this.ndc.x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const point = this.raycaster.ray.intersectPlane(this.ground, this.hit);
    if (!point) return null;
    return { x: point.x, z: point.z };
  }

  /** Grab-the-map pan: the world follows the pointer. */
  private pan(dx: number, dy: number): void {
    const scale = this.distance * 0.0014;
    const rightX = Math.cos(this.azimuth);
    const rightZ = -Math.sin(this.azimuth);
    const backX = Math.sin(this.azimuth);
    const backZ = Math.cos(this.azimuth);
    this.target.x -= (dx * rightX + dy * backX) * scale;
    this.target.z -= (dx * rightZ + dy * backZ) * scale;
  }
}

/** Eye point a bit above the ground (people are ~1.7 units, houses ~5–8). */
function groundEye(ground: number): number {
  return ground + 1.8;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
