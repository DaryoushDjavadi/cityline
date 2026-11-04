import * as THREE from "three";
import { CELL_SIZE, GRID_SIZE } from "../../../shared/src/index.ts";

const HALF = (GRID_SIZE * CELL_SIZE) / 2;

export class RtsCamera {
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2800);
  readonly target = new THREE.Vector3(0, 0, 0);
  azimuth = 0.7;
  polar = 0.9;
  distance = 420;

  private readonly keys = new Set<string>();
  private dragging: "pan" | "orbit" | null = null;
  private lastX = 0;
  private lastY = 0;

  resize(width: number, height: number): void {
    this.camera.aspect = Math.max(width, 1) / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  begin(button: number, x: number, y: number): boolean {
    if (button === 2) this.dragging = "orbit";
    else if (button === 1) this.dragging = "pan";
    else return false;
    this.lastX = x;
    this.lastY = y;
    return true;
  }

  move(x: number, y: number): void {
    if (!this.dragging) return;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
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

  wheel(deltaY: number): void {
    this.distance = clamp(this.distance * Math.exp(deltaY * 0.0011), 48, 560);
  }

  lookAt(x: number, z: number): void {
    const limit = HALF - 40;
    this.target.x = clamp(x, -limit, limit);
    this.target.z = clamp(z, -limit, limit);
  }

  update(dt: number): void {
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

  private pan(dx: number, dy: number): void {
    const scale = this.distance * 0.0014;
    const rightX = Math.cos(this.azimuth);
    const rightZ = -Math.sin(this.azimuth);
    const backX = Math.sin(this.azimuth);
    const backZ = Math.cos(this.azimuth);
    this.target.x += (dx * rightX + dy * backX) * scale;
    this.target.z += (dx * rightZ + dy * backZ) * scale;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
