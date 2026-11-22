// 起底凸点场：稠漆麻籽或手指捺出的凸点，高度场由种子完全决定
import type { BumpConfig } from './types.ts'
import { mulberry32, gaussian } from './rng.ts'
import type { DomainGrid } from './grid.ts'

interface Bump {
  // 物理平面坐标（毫米）
  x: number
  y: number
  radius: number
  height: number
}

export function buildBumpHeight(grid: DomainGrid, cfg: BumpConfig): Float32Array {
  const bumps = placeBumps(grid, cfg)
  const n = grid.n
  const h = new Float32Array(n * n)

  // 空间哈希加速 splat
  const cell = Math.max(1, cfg.radius * 2)
  const cols = Math.ceil(grid.width / cell) + 2
  const buckets = new Map<number, Bump[]>()
  const keyOf = (cx: number, cy: number) => cy * cols + cx
  for (const b of bumps) {
    const cx = Math.floor((b.x + grid.width / 2) / cell)
    const cy = Math.floor((b.y + grid.depth / 2) / cell)
    const key = keyOf(cx, cy)
    const list = buckets.get(key)
    if (list) list.push(b)
    else buckets.set(key, [b])
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = grid.idx(i, j)
      const [px, py] = grid.planarXY(i, j)
      const cx = Math.floor((px + grid.width / 2) / cell)
      const cy = Math.floor((py + grid.depth / 2) / cell)
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = buckets.get(keyOf(cx + dx, cy + dy))
          if (!list) continue
          for (const b of list) {
            const d2 = dist2(px, py, b.x, b.y)
            if (d2 > b.radius * b.radius) continue
            const q = d2 / (b.radius * b.radius)
            sum += b.height * Math.exp(-2.2 * q)
          }
        }
      }
      // 凸点叠加设上限，避免堆积处失真
      h[k] = Math.min(sum, cfg.height * 1.8)
    }
  }

  // 极域边缘 4% 平滑收边，模拟口沿不起凸
  if (grid.mode === 'polar') {
    const fadeStart = 0.96
    for (let i = 0; i < n; i++) {
      const r = i / (n - 1)
      if (r <= fadeStart) continue
      const f = Math.max(0, (1 - r) / (1 - fadeStart))
      for (let j = 0; j < n; j++) {
        h[grid.idx(i, j)] *= f
      }
    }
  }
  return h
}

function placeBumps(grid: DomainGrid, cfg: BumpConfig): Bump[] {
  const rand = mulberry32(cfg.seed)
  const areaDm2 = (Math.PI * grid.radius * grid.radius) / 10000
  const target = grid.mode === 'polar'
    ? Math.round(cfg.density * areaDm2)
    : Math.round(cfg.density * (grid.width * grid.depth) / 10000)

  const points: Array<[number, number]> = []
  if (cfg.distribution === 'grid') {
    placeGrid(grid, cfg, rand, target, points)
  } else if (cfg.distribution === 'spiral' && grid.mode === 'polar') {
    placeSpiral(rand, target, points)
  } else {
    placeRandom(grid, rand, target, points)
  }

  return points.map(([x, y]) => {
    const sigma = cfg.radius * cfg.variation * 0.5
    return {
      x,
      y,
      radius: Math.max(0.5, gaussian(rand, cfg.radius, sigma)),
      height: Math.max(0.1, gaussian(rand, cfg.height, cfg.height * cfg.variation * 0.5))
    }
  })
}

function placeGrid(
  grid: DomainGrid,
  cfg: BumpConfig,
  rand: () => number,
  target: number,
  out: Array<[number, number]>
): void {
  const jitter = cfg.type === 'finger' ? 0.42 : 0.22
  if (grid.mode === 'polar') {
    const spacing = grid.radius * Math.sqrt(Math.PI / Math.max(1, target))
    const ringStep = spacing * 0.9
    let ring = 1
    for (let r = ringStep; r < grid.radius * 0.95; r += ringStep, ring++) {
      const count = Math.max(1, Math.round((Math.PI * 2 * r) / spacing))
      const offset = rand() * Math.PI * 2
      for (let q = 0; q < count; q++) {
        const theta = offset + (q / count) * Math.PI * 2 + (rand() - 0.5) * jitter
        const rr = r + (rand() - 0.5) * jitter * ringStep
        out.push([rr * Math.cos(theta), rr * Math.sin(theta)])
      }
    }
  } else {
    const cols = Math.max(1, Math.round(Math.sqrt(target * grid.width / grid.depth)))
    const rows = Math.max(1, Math.round(target / cols))
    for (let ix = 0; ix < cols; ix++) {
      for (let iy = 0; iy < rows; iy++) {
        const x = -grid.width / 2 + ((ix + 0.5) / cols) * grid.width + (rand() - 0.5) * jitter * (grid.width / cols)
        const y = -grid.depth / 2 + ((iy + 0.5) / rows) * grid.depth + (rand() - 0.5) * jitter * (grid.depth / rows)
        out.push([x, y])
      }
    }
  }
}

function placeSpiral(rand: () => number, target: number, out: Array<[number, number]>): void {
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let q = 0; q < target; q++) {
    const r = Math.sqrt((q + 0.5) / target)
    const theta = q * golden + (rand() - 0.5) * 0.12
    out.push([r * Math.cos(theta), r * Math.sin(theta)])
  }
}

function placeRandom(
  grid: DomainGrid,
  rand: () => number,
  target: number,
  out: Array<[number, number]>
): void {
  let guard = 0
  const maxGuard = target * 40
  while (out.length < target && guard < maxGuard) {
    guard++
    if (grid.mode === 'polar') {
      const r = grid.radius * Math.sqrt(rand()) * 0.97
      const theta = rand() * Math.PI * 2
      out.push([r * Math.cos(theta), r * Math.sin(theta)])
    } else {
      const x = (rand() - 0.5) * grid.width * 0.96
      const y = (rand() - 0.5) * grid.depth * 0.96
      out.push([x, y])
    }
  }
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}
