// 打磨推演：以切削高度场表达磨耗，stroke 为唯一操作记录，可逐笔重放
import { DomainGrid } from './grid.ts'
import { buildBodyHeight } from './body.ts'
import { buildBumpHeight } from './bump.ts'
import { buildLayers } from './layers.ts'
import type {
  BodyConfig,
  BumpConfig,
  GrindStroke,
  LacquerLayer,
  StrokePoint,
  ToolType
} from './types.ts'

export const TOOL_PARAMS: Record<ToolType, { label: string; radius: number; cutRate: number }> = {
  coarse: { label: '粗砂石', radius: 22, cutRate: 0.045 },
  medium: { label: '细灰锉', radius: 14, cutRate: 0.022 },
  fine: { label: '水磨砂', radius: 8, cutRate: 0.01 }
}

// 剩漆预警阈值，毫米
export const THIN_WARN = 0.12

export class Simulation {
  readonly grid: DomainGrid
  readonly body: BodyConfig
  readonly bumpCfg: BumpConfig
  readonly layerCfgs: LacquerLayer[]

  bodyHeight: Float32Array
  bumpHeight: Float32Array
  // 每层干漆厚度场
  layerThickness: Float32Array[] = []
  // 打磨前总表面高度
  originalSurface: Float32Array
  // 累计切削深度
  ground: Float32Array
  // 当前表面高度 = originalSurface - ground
  currentSurface: Float32Array
  // 每格露出的漆层序号，-1 表示磨穿到胎体
  exposed: Int8Array
  // 剩余总漆厚
  remaining: Float32Array
  private lastStrokeCount = 0

  constructor(
    grid: DomainGrid,
    body: BodyConfig,
    bumpCfg: BumpConfig,
    layerCfgs: LacquerLayer[]
  ) {
    this.grid = grid
    this.body = body
    this.bumpCfg = bumpCfg
    this.layerCfgs = layerCfgs

    this.bodyHeight = buildBodyHeight(grid, body)
    this.bumpHeight = buildBumpHeight(grid, bumpCfg)
    const base = new Float32Array(grid.n * grid.n)
    for (let k = 0; k < base.length; k++) {
      base[k] = this.bodyHeight[k] + this.bumpHeight[k]
    }
    const built = buildLayers(grid, base, layerCfgs)
    this.layerThickness = built.thickness
    this.originalSurface = built.surface
    this.ground = new Float32Array(grid.n * grid.n)
    this.currentSurface = new Float32Array(built.surface)
    this.exposed = new Int8Array(grid.n * grid.n)
    this.exposed.fill(layerCfgs.length > 0 ? layerCfgs.length - 1 : -1)
    this.remaining = new Float32Array(grid.n * grid.n)
    this.recomputeRemaining()
  }

  // 应用一笔打磨（连续点之间插值，保证轨迹密度与点序无关地确定）
  applyStroke(stroke: GrindStroke): void {
    const n = this.grid.n
    if (stroke.points.length === 0) return
    const samples = this.rasterizePath(stroke.points, stroke.radius)
    const stepDepth = stroke.cutRate * (0.35 + stroke.pressure * 0.9)
    const r2 = stroke.radius * stroke.radius

    for (const [u, v] of samples) {
      const [fi, fj] = this.grid.ijFromUV(u, v)
      const i0 = Math.floor(fi)
      const j0 = Math.floor(fj)
      const reach = Math.ceil(stroke.radius / this.mmPerCell(i0)) + 1
      for (let di = -reach; di <= reach; di++) {
        const i = i0 + di
        if (i < 0 || i >= n) continue
        for (let dj = -reach; dj <= reach; dj++) {
          const j = this.grid.wrapJ(j0 + dj)
          const d2 = this.distanceMM(i, j, u, v)
          if (d2 > r2) continue
          const falloff = Math.sqrt(Math.max(0, 1 - d2 / r2))
          const k = this.grid.idx(i, j)
          this.ground[k] = Math.min(
            this.originalSurface[k] - this.bodyHeight[k],
            this.ground[k] + stepDepth * falloff
          )
        }
      }
    }
    this.refreshAfterStroke()
  }

  // 按记录从零重放全部打磨，用于回放与确定性校验
  rebuild(strokes: GrindStroke[]): void {
    this.ground.fill(0)
    for (const s of [...strokes].sort((a, b) => a.order - b.order)) {
      this.applyStroke(s)
    }
    this.lastStrokeCount = strokes.length
  }

  // 增量应用新笔
  syncStrokes(strokes: GrindStroke[]): void {
    const sorted = [...strokes].sort((a, b) => a.order - b.order)
    if (sorted.length < this.lastStrokeCount) {
      this.rebuild(sorted)
      return
    }
    for (let q = this.lastStrokeCount; q < sorted.length; q++) {
      this.applyStroke(sorted[q])
    }
    this.lastStrokeCount = sorted.length
  }

  private refreshAfterStroke(): void {
    const count = this.grid.n * this.grid.n
    for (let k = 0; k < count; k++) {
      this.currentSurface[k] = this.originalSurface[k] - this.ground[k]
    }
    this.recomputeExposed()
    this.recomputeRemaining()
  }

  private recomputeExposed(): void {
    const count = this.grid.n * this.grid.n
    const layerCount = this.layerCfgs.length
    for (let k = 0; k < count; k++) {
      if (this.ground[k] <= 0) {
        this.exposed[k] = layerCount > 0 ? layerCount - 1 : -1
        continue
      }
      let depth = this.ground[k]
      let shown = -1
      for (let li = layerCount - 1; li >= 0; li--) {
        const t = this.layerThickness[li][k]
        if (depth < t - 1e-6) {
          shown = li
          break
        }
        depth -= t
      }
      this.exposed[k] = shown
    }
  }

  private recomputeRemaining(): void {
    const count = this.grid.n * this.grid.n
    for (let k = 0; k < count; k++) {
      this.remaining[k] = Math.max(0, this.currentSurface[k] - this.bodyHeight[k])
    }
  }

  // 磨穿格比例（0~1）
  breachRatio(): number {
    let hit = 0
    for (let k = 0; k < this.exposed.length; k++) {
      if (this.exposed[k] < 0) hit++
    }
    return hit / this.exposed.length
  }

  // 薄漆预警格比例（未磨穿且剩余低于阈值）
  thinRatio(): number {
    let hit = 0
    for (let k = 0; k < this.remaining.length; k++) {
      if (this.exposed[k] >= 0 && this.remaining[k] < THIN_WARN) hit++
    }
    return hit / this.remaining.length
  }

  checksum(): string {
    // FNV-1a，依次纳入 ground 原始位，浮点顺序固定
    let h = 2166136261
    const bytes = new Uint8Array(this.ground.buffer, this.ground.byteOffset, this.ground.byteLength)
    for (let q = 0; q < bytes.length; q++) {
      h ^= bytes[q]
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  private mmPerCell(i: number): number {
    if (this.grid.mode === 'polar') {
      return Math.max(0.8, (Math.PI * 2 * this.grid.cellRadius(i)) / this.grid.n)
    }
    return Math.max(this.grid.width, this.grid.depth) / this.grid.n
  }

  // 格心到 uv 点的物理平面距离（毫米），极域按真实圆弧长度
  private distanceMM(i: number, j: number, u: number, v: number): number {
    if (this.grid.mode === 'polar') {
      const [gu, gv] = this.grid.uvFromIJ(i, j)
      const r1 = gu * this.grid.radius
      const r2 = u * this.grid.radius
      const theta = (gv - v) * Math.PI * 2
      const dr = r1 - r2
      const arc = ((r1 + r2) * 0.5) * theta
      return Math.sqrt(dr * dr + arc * arc)
    }
    const [gu, gv] = this.grid.uvFromIJ(i, j)
    const dx = (gu - u) * this.grid.width
    const dy = (gv - v) * this.grid.depth
    return Math.sqrt(dx * dx + dy * dy)
  }

  // 路径插值：按约 2mm 步长补点，结果只依赖点序与坐标
  private rasterizePath(points: StrokePoint[], radius: number): Array<[number, number]> {
    const out: Array<[number, number]> = []
    if (points.length === 1) {
      out.push([points[0].x, points[0].y])
      return out
    }
    const stepUV = 2 / Math.max(this.grid.radius, this.grid.width, this.grid.depth)
    for (let q = 0; q < points.length - 1; q++) {
      const a = points[q]
      const b = points[q + 1]
      const du = b.x - a.x
      const dv = b.y - a.y
      const len = Math.hypot(du, dv)
      const seg = Math.max(1, Math.ceil(len / Math.max(stepUV, 1e-5)))
      for (let s = 0; s < seg; s++) {
        out.push([a.x + (du * s) / seg, a.y + (dv * s) / seg])
      }
    }
    const last = points[points.length - 1]
    out.push([last.x, last.y])
    // radius 仅用于调用方邻域，保留参数语义
    void radius
    return out
  }
}
