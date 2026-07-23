/**
 * Grid-based A* pathfinding with 8-directional movement, binary heap open set,
 * and line-of-sight path smoothing.
 *
 * Designed for a 2560x9600 map with 16px cells (160x600 = 96,000 cells).
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface GridNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: GridNode | null;
  opened: boolean;
  closed: boolean;
}

// 8-directional neighbors: [dx, dy, cost]
const DIRECTIONS: [number, number, number][] = [
  [0, -1, 1],    // N
  [1, -1, Math.SQRT2], // NE
  [1, 0, 1],    // E
  [1, 1, Math.SQRT2],  // SE
  [0, 1, 1],    // S
  [-1, 1, Math.SQRT2], // SW
  [-1, 0, 1],   // W
  [-1, -1, Math.SQRT2], // NW
];

/**
 * Binary min-heap for A* open set, keyed on f-score.
 */
class BinaryHeap {
  private data: GridNode[] = [];

  get size(): number {
    return this.data.length;
  }

  push(node: GridNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): GridNode | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  update(node: GridNode): void {
    const idx = this.data.indexOf(node);
    if (idx !== -1) {
      this.bubbleUp(idx);
    }
  }

  clear(): void {
    this.data.length = 0;
  }

  private bubbleUp(idx: number): void {
    const node = this.data[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this.data[parentIdx];
      if (node.f >= parent.f) break;
      this.data[idx] = parent;
      this.data[parentIdx] = node;
      idx = parentIdx;
    }
  }

  private sinkDown(idx: number): void {
    const length = this.data.length;
    const node = this.data[idx];

    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;

      if (left < length && this.data[left].f < this.data[smallest].f) {
        smallest = left;
      }
      if (right < length && this.data[right].f < this.data[smallest].f) {
        smallest = right;
      }
      if (smallest === idx) break;

      this.data[idx] = this.data[smallest];
      this.data[smallest] = node;
      idx = smallest;
    }
  }
}

export default class AStarGrid {
  private cellSize: number;
  private gridWidth: number = 0;
  private gridHeight: number = 0;
  private originX: number = 0;
  private originY: number = 0;
  /** Flat boolean array: true = blocked. Indexed as [y * gridWidth + x] */
  private blocked: Uint8Array = new Uint8Array(0);

  constructor(cellSize: number = 16) {
    this.cellSize = cellSize;
  }

  /**
   * Build the walkability grid by marking cells overlapping collision bodies.
   */
  buildGrid(
    mapWidth: number,
    mapHeight: number,
    rects: Rect[],
    polys: Point[][],
    inflate: number = 0,
    originX: number = 0,
    originY: number = 0
  ): void {
    this.originX = originX;
    this.originY = originY;
    this.gridWidth = Math.ceil(mapWidth / this.cellSize);
    this.gridHeight = Math.ceil(mapHeight / this.cellSize);
    const totalCells = this.gridWidth * this.gridHeight;
    this.blocked = new Uint8Array(totalCells);

    const inflatePixels = inflate;

    // Mark cells overlapping rectangles (inflated) — shift by origin
    for (const rect of rects) {
      const minGX = Math.max(0, Math.floor((rect.x - originX - inflatePixels) / this.cellSize));
      const minGY = Math.max(0, Math.floor((rect.y - originY - inflatePixels) / this.cellSize));
      const maxGX = Math.min(
        this.gridWidth - 1,
        Math.floor((rect.x - originX + rect.width + inflatePixels) / this.cellSize)
      );
      const maxGY = Math.min(
        this.gridHeight - 1,
        Math.floor((rect.y - originY + rect.height + inflatePixels) / this.cellSize)
      );

      for (let gy = minGY; gy <= maxGY; gy++) {
        const rowOffset = gy * this.gridWidth;
        for (let gx = minGX; gx <= maxGX; gx++) {
          this.blocked[rowOffset + gx] = 1;
        }
      }
    }

    // Mark cells overlapping polygons (inflated)
    for (const poly of polys) {
      this.rasterizePolygon(poly, inflatePixels);
    }
  }

  /**
   * Find a path from (startX, startY) to (endX, endY) in world coordinates.
   * Returns an array of world-space waypoints (center of each cell).
   * If the end point is blocked, finds the nearest unblocked cell as destination.
   */
  findPath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Point[] {
    const sx = Math.floor((startX - this.originX) / this.cellSize);
    const sy = Math.floor((startY - this.originY) / this.cellSize);
    let ex = Math.floor((endX - this.originX) / this.cellSize);
    let ey = Math.floor((endY - this.originY) / this.cellSize);

    // Clamp to grid bounds
    const clampX = (v: number) => Math.max(0, Math.min(this.gridWidth - 1, v));
    const clampY = (v: number) => Math.max(0, Math.min(this.gridHeight - 1, v));

    let startGX = clampX(sx);
    let startGY = clampY(sy);
    let endGX = clampX(ex);
    let endGY = clampY(ey);

    // If start is blocked (player pushed into obstacle by physics), find nearest walkable
    if (this.isBlocked(startGX, startGY)) {
      const nearestStart = this.findNearestUnblocked(startGX, startGY);
      if (!nearestStart) return [];
      startGX = nearestStart.x;
      startGY = nearestStart.y;
    }

    // If end is blocked, find nearest unblocked cell
    if (this.isBlocked(endGX, endGY)) {
      const nearest = this.findNearestUnblocked(endGX, endGY);
      if (!nearest) return [];
      endGX = nearest.x;
      endGY = nearest.y;
    }

    // Trivial case - same cell
    if (startGX === endGX && startGY === endGY) {
      return [{ x: startX, y: startY }, { x: endX, y: endY }];
    }

    // A* search
    const rawPath = this.astar(startGX, startGY, endGX, endGY);
    if (rawPath.length === 0) return [];

    // Smooth path using line-of-sight checks
    const smoothed = this.smoothPath(rawPath);

    // Convert to world coordinates
    const worldPath = smoothed.map((p) => this.gridToWorld(p.x, p.y));

    // Replace first point with exact start position
    if (worldPath.length > 0) {
      worldPath[0] = { x: startX, y: startY };
    }

    // Replace last point with exact end position (if the original end cell wasn't blocked)
    if (worldPath.length > 1) {
      const targetGX = clampX(Math.floor(endX / this.cellSize));
      const targetGY = clampY(Math.floor(endY / this.cellSize));
      if (!this.isBlocked(targetGX, targetGY)) {
        worldPath[worldPath.length - 1] = { x: endX, y: endY };
      }
    }

    return worldPath;
  }

  // --- Private methods ---

  private isBlocked(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return true;
    }
    return this.blocked[gy * this.gridWidth + gx] === 1;
  }

  private gridToWorld(gx: number, gy: number): Point {
    return {
      x: gx * this.cellSize + this.cellSize * 0.5 + this.originX,
      y: gy * this.cellSize + this.cellSize * 0.5 + this.originY,
    };
  }

  /**
   * Find the nearest unblocked cell to (gx, gy) using BFS spiral.
   */
  private findNearestUnblocked(
    gx: number,
    gy: number
  ): Point | null {
    const maxRadius = Math.max(this.gridWidth, this.gridHeight);
    for (let r = 1; r <= maxRadius; r++) {
      // Check cells at Manhattan distance r in a square ring
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // Only ring
          const nx = gx + dx;
          const ny = gy + dy;
          if (
            nx >= 0 &&
            nx < this.gridWidth &&
            ny >= 0 &&
            ny < this.gridHeight &&
            !this.isBlocked(nx, ny)
          ) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return null;
  }

  /**
   * Core A* implementation with binary heap.
   */
  private astar(
    sx: number,
    sy: number,
    ex: number,
    ey: number
  ): Point[] {
    // Use flat arrays for node data to avoid object allocation for every cell
    const totalCells = this.gridWidth * this.gridHeight;
    const gScore = new Float32Array(totalCells).fill(Infinity);
    const fScore = new Float32Array(totalCells).fill(Infinity);
    const parentX = new Int16Array(totalCells).fill(-1);
    const parentY = new Int16Array(totalCells).fill(-1);
    const closed = new Uint8Array(totalCells);

    // Lightweight node for heap
    const heap = new BinaryHeap();

    const startIdx = sy * this.gridWidth + sx;
    gScore[startIdx] = 0;
    const h = this.heuristic(sx, sy, ex, ey);
    fScore[startIdx] = h;

    const startNode: GridNode = {
      x: sx,
      y: sy,
      g: 0,
      h,
      f: h,
      parent: null,
      opened: true,
      closed: false,
    };
    heap.push(startNode);

    // Map from grid index to heap node for updates
    const nodeMap = new Map<number, GridNode>();
    nodeMap.set(startIdx, startNode);

    while (heap.size > 0) {
      const current = heap.pop()!;
      const cx = current.x;
      const cy = current.y;
      const cIdx = cy * this.gridWidth + cx;

      if (cx === ex && cy === ey) {
        // Reconstruct path
        return this.reconstructPath(parentX, parentY, ex, ey, sx, sy);
      }

      closed[cIdx] = 1;

      for (const [dx, dy, cost] of DIRECTIONS) {
        const nx = cx + dx;
        const ny = cy + dy;

        if (
          nx < 0 || nx >= this.gridWidth ||
          ny < 0 || ny >= this.gridHeight
        ) {
          continue;
        }

        const nIdx = ny * this.gridWidth + nx;

        if (closed[nIdx] === 1 || this.blocked[nIdx] === 1) {
          continue;
        }

        // For diagonal movement, ensure both adjacent cardinal cells are open
        // to prevent corner-cutting through blocked cells
        if (dx !== 0 && dy !== 0) {
          const adj1 = cy * this.gridWidth + nx; // (nx, cy)
          const adj2 = ny * this.gridWidth + cx; // (cx, ny)
          if (this.blocked[adj1] === 1 || this.blocked[adj2] === 1) {
            continue;
          }
        }

        const tentativeG = gScore[cIdx] + cost;

        if (tentativeG < gScore[nIdx]) {
          gScore[nIdx] = tentativeG;
          parentX[nIdx] = cx;
          parentY[nIdx] = cy;
          const nh = this.heuristic(nx, ny, ex, ey);
          const nf = tentativeG + nh;
          fScore[nIdx] = nf;

          let neighborNode = nodeMap.get(nIdx);
          if (neighborNode) {
            neighborNode.g = tentativeG;
            neighborNode.h = nh;
            neighborNode.f = nf;
            heap.update(neighborNode);
          } else {
            neighborNode = {
              x: nx,
              y: ny,
              g: tentativeG,
              h: nh,
              f: nf,
              parent: null,
              opened: true,
              closed: false,
            };
            nodeMap.set(nIdx, neighborNode);
            heap.push(neighborNode);
          }
        }
      }
    }

    // No path found
    return [];
  }

  /**
   * Octile distance heuristic (consistent for 8-directional movement).
   */
  private heuristic(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  /**
   * Reconstruct path from parent arrays.
   */
  private reconstructPath(
    parentX: Int16Array,
    parentY: Int16Array,
    ex: number,
    ey: number,
    sx: number,
    sy: number
  ): Point[] {
    const path: Point[] = [];
    let cx = ex;
    let cy = ey;

    while (cx !== sx || cy !== sy) {
      path.push({ x: cx, y: cy });
      const idx = cy * this.gridWidth + cx;
      const px = parentX[idx];
      const py = parentY[idx];
      cx = px;
      cy = py;
    }
    path.push({ x: sx, y: sy });
    path.reverse();
    return path;
  }

  /**
   * Smooth path by removing intermediate waypoints that have
   * direct line-of-sight (no blocked cells along the line).
   */
  private smoothPath(path: Point[]): Point[] {
    if (path.length <= 2) return path;

    const smoothed: Point[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      let furthest = current + 1;

      // Find the furthest point with direct line-of-sight
      for (let i = path.length - 1; i > current + 1; i--) {
        if (this.hasLineOfSight(path[current], path[i])) {
          furthest = i;
          break;
        }
      }

      smoothed.push(path[furthest]);
      current = furthest;
    }

    return smoothed;
  }

  /**
   * Bresenham-style raycast to check if all cells along the line
   * from a to b are unblocked. Uses supercover line algorithm
   * to catch all cells the line passes through.
   */
  private hasLineOfSight(a: Point, b: Point): boolean {
    let x0 = a.x;
    let y0 = a.y;
    const x1 = b.x;
    const y1 = b.y;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;

    let err = dx - dy;

    while (true) {
      if (this.isBlocked(x0, y0)) return false;

      if (x0 === x1 && y0 === y1) break;

      const e2 = 2 * err;

      // Handle diagonal steps - check adjacent cells to prevent corner cutting
      if (e2 > -dy && e2 < dx) {
        // Diagonal step: check both cardinal neighbors
        if (this.isBlocked(x0 + sx, y0) || this.isBlocked(x0, y0 + sy)) {
          return false;
        }
        err -= dy;
        err += dx;
        x0 += sx;
        y0 += sy;
      } else if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      } else {
        err += dx;
        y0 += sy;
      }
    }

    return true;
  }

  /**
   * Rasterize a polygon into the blocked grid using scanline fill.
   * Polygon vertices are in world-space (absolute coordinates).
   */
  private rasterizePolygon(vertices: Point[], inflate: number = 0): void {
    if (vertices.length < 3) return;

    // Find bounding box in world coords (inflated)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const v of vertices) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }

    const gMinX = Math.max(0, Math.floor((minX - this.originX - inflate) / this.cellSize));
    const gMinY = Math.max(0, Math.floor((minY - this.originY - inflate) / this.cellSize));
    const gMaxX = Math.min(this.gridWidth - 1, Math.floor((maxX - this.originX + inflate) / this.cellSize));
    const gMaxY = Math.min(
      this.gridHeight - 1,
      Math.floor((maxY - this.originY + inflate) / this.cellSize)
    );

    // For each grid cell in the bounding box, check if cell overlaps polygon (with inflation)
    for (let gy = gMinY; gy <= gMaxY; gy++) {
      const cellCenterY = gy * this.cellSize + this.cellSize * 0.5 + this.originY;
      const rowOffset = gy * this.gridWidth;

      for (let gx = gMinX; gx <= gMaxX; gx++) {
        if (this.blocked[rowOffset + gx] === 1) continue;

        const cellCenterX = gx * this.cellSize + this.cellSize * 0.5 + this.originX;

        if (
          this.pointInPolygon(cellCenterX, cellCenterY, vertices) ||
          this.polygonIntersectsCell(gx, gy, vertices, inflate)
        ) {
          this.blocked[rowOffset + gx] = 1;
        }
      }
    }
  }

  /**
   * Ray-casting point-in-polygon test.
   */
  private pointInPolygon(px: number, py: number, vertices: Point[]): boolean {
    let inside = false;
    const n = vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x,
        yi = vertices[i].y;
      const xj = vertices[j].x,
        yj = vertices[j].y;

      if (
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Check if any edge of the polygon intersects with the cell's rectangle.
   */
  private polygonIntersectsCell(
    gx: number,
    gy: number,
    vertices: Point[],
    inflate: number = 0
  ): boolean {
    const left = gx * this.cellSize - inflate;
    const top = gy * this.cellSize - inflate;
    const right = left + this.cellSize + inflate * 2;
    const bottom = top + this.cellSize + inflate * 2;

    const n = vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (
        this.lineIntersectsRect(
          vertices[j].x,
          vertices[j].y,
          vertices[i].x,
          vertices[i].y,
          left,
          top,
          right,
          bottom
        )
      ) {
        return true;
      }
    }

    // Also check if any vertex is inside the cell
    for (const v of vertices) {
      if (v.x >= left && v.x <= right && v.y >= top && v.y <= bottom) {
        return true;
      }
    }

    return false;
  }

  /**
   * Cohen-Sutherland line-rectangle intersection test.
   */
  private lineIntersectsRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    left: number,
    top: number,
    right: number,
    bottom: number
  ): boolean {
    const INSIDE = 0;
    const LEFT = 1;
    const RIGHT = 2;
    const BOTTOM = 4;
    const TOP = 8;

    const computeCode = (x: number, y: number): number => {
      let code = INSIDE;
      if (x < left) code |= LEFT;
      else if (x > right) code |= RIGHT;
      if (y < top) code |= TOP;
      else if (y > bottom) code |= BOTTOM;
      return code;
    };

    let code0 = computeCode(x0, y0);
    let code1 = computeCode(x1, y1);

    while (true) {
      if ((code0 | code1) === 0) return true; // Both inside
      if ((code0 & code1) !== 0) return false; // Both in same outside zone

      const codeOut = code0 !== 0 ? code0 : code1;
      let x: number, y: number;

      if (codeOut & TOP) {
        x = x0 + ((x1 - x0) * (top - y0)) / (y1 - y0);
        y = top;
      } else if (codeOut & BOTTOM) {
        x = x0 + ((x1 - x0) * (bottom - y0)) / (y1 - y0);
        y = bottom;
      } else if (codeOut & RIGHT) {
        y = y0 + ((y1 - y0) * (right - x0)) / (x1 - x0);
        x = right;
      } else {
        y = y0 + ((y1 - y0) * (left - x0)) / (x1 - x0);
        x = left;
      }

      if (codeOut === code0) {
        x0 = x;
        y0 = y;
        code0 = computeCode(x0, y0);
      } else {
        x1 = x;
        y1 = y;
        code1 = computeCode(x1, y1);
      }
    }
  }
}
