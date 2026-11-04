import * as THREE from "three";
import { CELL_SIZE, GRID_SIZE } from "../../../shared/src/index.ts";

const HALF = (GRID_SIZE * CELL_SIZE) / 2;
const ROTATE_TAP = 0.18;

export class RtsCamera {
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2800);
  readonly target = new THREE.Vector3(0, 0, 0);
  azimuth = 0.7;
  polar = 0.9;
  distance = 420;

  private readonly keys = new Set<string>();
  private dragging: "pan" | "orbit" | null = null;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private viewW = 1;
  private viewH = 1;
  private focusEase: { x: number; z: number; distance: number } | null = null;
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
      this.polar = clamp(this.polar - dy * 0.003, 0.38, 1.22);
      return;
    }
    this.pan(dx, dy);
  }

  end(): void {
    this.dragging = null;
  }

  wheel(deltaY: number, clientX?: number, clientY?: number, rect?: DOMRect): void {
    this.focusEase = null;
    const before = clientX !== undefined && clientY !== undefined && rect
      ? this.groundPoint(clientX, clientY, rect)
      : null;
    this.setDistance(this.distance * Math.exp(deltaY * 0.0011));
    this.update(0);
    if (!before) return;
    const after = this.groundPoint(clientX!, clientY!, rect!);
    if (!after) return;
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
  }

  setDistance(value: number): void {
    this.distance = clamp(value, 48, 560);
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
      distance: clamp(distance, 48, 560),
    };
  }

  /** Wide overview of the island, used when a level starts. */
  resetOverview(): void {
    this.focusEase = null;
    this.target.set(0, 0, 0);
    this.azimuth = 0.7;
    this.polar = 0.95;
    this.distance = 480;
  }

  update(dt: number): void {
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

    const limit = HALF - 40;
    this.target.x = clamp(this.target.x, -limit, limit);
    this.target.z = clamp(this.target.z, -limit, limit);
    this.polar = clamp(this.polar, 0.38, 1.22);

    const height = Math.cos(this.polar);
    const ring = Math.sin(this.polar);
    this.camera.position.set(
      this.target.x + this.distance * ring * Math.sin(this.azimuth),
      this.distance * height,
      this.target.z + this.distance * ring * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
