// 参数域网格：全部物理推演在固定分辨率的规则网格上进行
// polar: u=半径比(0~1), v=角度(0~2π, 首尾环绕)；rect: u,v 均为 0~1
import type { DomainMode } from './types.ts'

export const GRID_N = 256

export class DomainGrid {
  readonly n = GRID_N
  readonly mode: DomainMode
  // polar 域最大半径（毫米）
  readonly radius: number
  // rect 域物理尺寸（毫米）
  readonly width: number
  readonly depth: number

  // 每格面积权重（毫米²）
  readonly area: Float32Array
  private readonly dr: number
  private readonly dtheta: number
  private readonly dx: number
  private readonly dy: number

  constructor(mode: DomainMode, radius: number, width: number, depth: number) {
    this.mode = mode
    this.radius = radius
    this.width = width
    this.depth = depth
    this.dr = radius / (this.n - 1)
    this.dtheta = (Math.PI * 2) / this.n
    this.dx = width / (this.n - 1)
    this.dy = depth / (this.n - 1)

    this.area = new Float32Array(this.n * this.n)
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        this.area[this.idx(i, j)] = this.cellArea(i)
      }
    }
  }

  idx(i: number, j: number): number {
    return i * this.n + j
  }

  // theta 方向环绕
  wrapJ(j: number): number {
    const n = this.n
    return ((j % n) + n) % n
  }

  // 极域格心半径，中心点给最小半径避免除零
  cellRadius(i: number): number {
    if (this.mode !== 'polar') return 0
    return Math.max(i * this.dr, this.dr * 0.5)
  }

  private cellArea(i: number): number {
    if (this.mode === 'polar') {
      const r = this.cellRadius(i)
      return r * this.dr * this.dtheta
    }
    return this.dx * this.dy
  }

  // 归一化坐标 -> 格下标（浮点，供双线性插值）
  uvFromIJ(i: number, j: number): [number, number] {
    return [i / (this.n - 1), j / (this.n - 1)]
  }

  ijFromUV(u: number, v: number): [number, number] {
    const fi = Math.min(this.n - 1.001, Math.max(0, u * (this.n - 1)))
    const fj = Math.min(this.n - 1.001, Math.max(0, v * (this.n - 1)))
    return [fi, fj]
  }

  // 双线性采样（theta 方向环绕处理）
  sample(field: Float32Array, u: number, v: number): number {
    const [fi, fj] = this.ijFromUV(u, v)
    const i0 = Math.floor(fi)
    const j0 = Math.floor(fj)
    const ti = fi - i0
    const tj = fj - j0
    const i1 = Math.min(i0 + 1, this.n - 1)
    const j1 = this.wrapJ(j0 + 1)
    const a = field[this.idx(i0, j0)]
    const b = field[this.idx(i0, j1)]
    const c = field[this.idx(i1, j0)]
    const d = field[this.idx(i1, j1)]
    const top = a * (1 - tj) + b * tj
    const bot = c * (1 - tj) + d * tj
    return top * (1 - ti) + bot * ti
  }

  // 格心物理平面坐标（毫米），z 由胎体高度场另行给出
  planarXY(i: number, j: number): [number, number] {
    if (this.mode === 'polar') {
      const r = i * this.dr
      const theta = j * this.dtheta
      return [r * Math.cos(theta), r * Math.sin(theta)]
    }
    const u = i / (this.n - 1)
    const v = j / (this.n - 1)
    return [(u - 0.5) * this.width, (v - 0.5) * this.depth]
  }

  // 物理平面坐标 -> 归一化 uv（打磨拾取用）
  uvFromXY(x: number, y: number): [number, number] {
    if (this.mode === 'polar') {
      const r = Math.hypot(x, y)
      const theta = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)
      return [Math.min(1, r / this.radius), theta / (Math.PI * 2)]
    }
    return [
      Math.min(1, Math.max(0, x / this.width + 0.5)),
      Math.min(1, Math.max(0, y / this.depth + 0.5))
    ]
  }

  // 扩散交换系数：面面积/格面积，通量按"厚度交换量"实现，更新天然守恒
  // 统一钳到 0.25 以下满足显式扩散 CFL 稳定条件，避免极点小面积格无限吸漆
  conductance(flow: number): { gA: Float32Array; gB: Float32Array } {
    const n = this.n
    const cap = 0.25
    const gA = new Float32Array(n * n)
    const gB = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = this.idx(i, j)
        const cellA = Math.max(1e-9, this.area[k])
        if (this.mode === 'polar') {
          const rFace = Math.max(this.dr * 0.5, (i + 0.5) * this.dr)
          gA[k] = i < n - 1 ? Math.min(cap, (flow * rFace * this.dtheta * this.dr) / cellA) : 0
          gB[k] = i === 0 ? 0 : Math.min(cap, (flow * this.dr * this.dr) / cellA)
        } else {
          gA[k] = i < n - 1 ? Math.min(cap, (flow * this.dy) / this.dx) : 0
          gB[k] = j < n - 1 ? Math.min(cap, (flow * this.dx) / this.dy) : 0
        }
      }
    }
    return { gA, gB }
  }
}
