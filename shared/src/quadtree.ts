export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PointItem {
  x: number;
  y: number;
  weight: number;
}

const MAX_DEPTH = 8;

/**
 * Point quadtree over half-open rectangles: a point belongs to a node when
 * x is in [bounds.x, bounds.x + bounds.w) and y is in [bounds.y, bounds.y + bounds.h).
 */
export class Quadtree {
  private readonly items: PointItem[] = [];
  private nw?: Quadtree;
  private ne?: Quadtree;
  private sw?: Quadtree;
  private se?: Quadtree;

  constructor(
    private readonly bounds: Rect,
    private readonly capacity = 12,
    private readonly depth = 0,
  ) {}

  insert(item: PointItem): void {
    if (!contains(this.bounds, item.x, item.y)) return;
    if (this.items.length < this.capacity || this.depth >= MAX_DEPTH) {
      this.items.push(item);
      return;
    }
    this.subdivide();
    this.insertIntoChild(item);
  }

  query(range: Rect, out: PointItem[]): void {
    if (!intersects(this.bounds, range)) return;
    for (const item of this.items) {
      if (contains(range, item.x, item.y)) out.push(item);
    }
    this.nw?.query(range, out);
    this.ne?.query(range, out);
    this.sw?.query(range, out);
    this.se?.query(range, out);
  }

  private subdivide(): void {
    if (this.nw) return;
    const { x, y, w, h } = this.bounds;
    const hw = w / 2;
    const hh = h / 2;
    this.nw = new Quadtree({ x, y, w: hw, h: hh }, this.capacity, this.depth + 1);
    this.ne = new Quadtree({ x: x + hw, y, w: hw, h: hh }, this.capacity, this.depth + 1);
    this.sw = new Quadtree({ x, y: y + hh, w: hw, h: hh }, this.capacity, this.depth + 1);
    this.se = new Quadtree({ x: x + hw, y: y + hh, w: hw, h: hh }, this.capacity, this.depth + 1);
    const existing = this.items.splice(0, this.items.length);
    for (const item of existing) this.insertIntoChild(item);
  }

  private insertIntoChild(item: PointItem): void {
    const midX = this.bounds.x + this.bounds.w / 2;
    const midY = this.bounds.y + this.bounds.h / 2;
    const east = item.x >= midX;
    const south = item.y >= midY;
    const child = south ? (east ? this.se : this.sw) : east ? this.ne : this.nw;
    child?.insert(item);
  }
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
