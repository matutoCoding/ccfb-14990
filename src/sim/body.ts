// 胎体高度场：参数化盘/盒/碗，以及 OBJ 导入后的表面光栅化
import type { BodyConfig } from './types.ts'
import { DomainGrid, GRID_N } from './grid.ts'

export function domainModeFor(shape: BodyConfig['shape']): 'polar' | 'rect' {
  return shape === 'box' || shape === 'obj' ? 'rect' : 'polar'
}

// 浅凹回转面：盘面 z = curvature·r²，边缘唇边抬起
function revolvedProfile(r: number, curvature: number, lip: number): number {
  const dish = curvature * r * r
  const rim = lip * Math.pow(Math.max(0, (r - 0.86) / 0.14), 2)
  return dish + rim
}

export function buildBodyHeight(grid: DomainGrid, body: BodyConfig): Float32Array {
  const n = grid.n
  const h = new Float32Array(n * n)

  if (body.shape === 'obj' && body.objVertices) {
    return rasterizeObj(grid, body)
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = grid.idx(i, j)
      if (grid.mode === 'polar') {
        const r = i / (n - 1)
        const bowlFactor = body.shape === 'bowl' ? 2.4 : 1
        h[k] = revolvedProfile(r, body.curvature * bowlFactor, body.curvature * 0.5)
      } else {
        // 盒：平底，四周唇边
        const [u, v] = grid.uvFromIJ(i, j)
        const edge = Math.max(Math.abs(u - 0.5) * 2, Math.abs(v - 0.5) * 2)
        const lip = body.curvature * 0.5 * Math.pow(Math.max(0, (edge - 0.82) / 0.18), 2)
        h[k] = lip
      }
    }
  }
  return h
}

// OBJ 三角面按 XY 投影分桶，逐格取最近三角形插值高度
function rasterizeObj(grid: DomainGrid, body: BodyConfig): Float32Array {
  const verts = body.objVertices as number[]
  const indices = body.objIndices as number[]
  const n = grid.n
  const h = new Float32Array(n * n)
  const filled = new Uint8Array(n * n)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let p = 0; p < verts.length; p += 3) {
    minX = Math.min(minX, verts[p])
    maxX = Math.max(maxX, verts[p])
    minY = Math.min(minY, verts[p + 1])
    maxY = Math.max(maxY, verts[p + 1])
  }
  const spanX = Math.max(1e-6, maxX - minX)
  const spanY = Math.max(1e-6, maxY - minY)

  // 三角形分桶
  const bins = Math.ceil(Math.sqrt(indices.length / 3)) + 4
  const buckets: number[][] = Array.from({ length: bins * bins }, () => [])
  const triCount = indices.length / 3
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3
    const b = indices[t * 3 + 1] * 3
    const c = indices[t * 3 + 2] * 3
    const cx = (verts[a] + verts[b] + verts[c]) / 3
    const cy = (verts[a + 1] + verts[b + 1] + verts[c + 1]) / 3
    const bx = Math.min(bins - 1, Math.max(0, Math.floor(((cx - minX) / spanX) * bins)))
    const by = Math.min(bins - 1, Math.max(0, Math.floor(((cy - minY) / spanY) * bins)))
    buckets[by * bins + bx].push(t)
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const k = grid.idx(i, j)
      const [px, py] = grid.planarXY(i, j)
      // 物理毫米坐标映射到 OBJ 归一化包围盒
      const nx = ((px / grid.width + 0.5) * spanX) + minX
      const ny = ((py / grid.depth + 0.5) * spanY) + minY
      const gx = Math.min(bins - 1, Math.max(0, Math.floor(((nx - minX) / spanX) * bins)))
      const gy = Math.min(bins - 1, Math.max(0, Math.floor(((ny - minY) / spanY) * bins)))

      let best = Infinity
      let bestZ = 0
      for (let ring = 0; ring < bins && !isFinite(best === Infinity ? Infinity : best); ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
            const yy = gy + dy
            const xx = gx + dx
            if (yy < 0 || yy >= bins || xx < 0 || xx >= bins) continue
            for (const t of buckets[yy * bins + xx]) {
              const z = triZ(verts, indices, t, nx, ny)
              if (z === null) continue
              const ia = indices[t * 3] * 3
              const d = dist2(verts[ia], verts[ia + 1], nx, ny)
              if (d < best) {
                best = d
                bestZ = z
              }
            }
          }
        }
        if (isFinite(best)) break
      }
      if (isFinite(best)) {
        h[k] = bestZ
        filled[k] = 1
      }
    }
  }

  // 未覆盖格：用最近填充值兜底（确定性扩散，固定迭代上限）
  for (let pass = 0; pass < n; pass++) {
    if (filled.every(Boolean)) break
    const nextH = new Float32Array(h)
    const nextF = new Uint8Array(filled)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = grid.idx(i, j)
        if (filled[k]) continue
        let sum = 0
        let cnt = 0
        const neighbors = [
          [i - 1, j], [i + 1, j], [i, grid.wrapJ(j - 1)], [i, grid.wrapJ(j + 1)]
        ]
        for (const [ni, nj] of neighbors) {
          if (ni < 0 || ni >= n) continue
          const nk = grid.idx(ni, nj)
          if (filled[nk]) {
            sum += h[nk]
            cnt++
          }
        }
        if (cnt > 0) {
          nextH[k] = sum / cnt
          nextF[k] = 1
        }
      }
    }
    h.set(nextH)
    filled.set(nextF)
  }
  return h
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

// 点在三角形 XY 投影内则返回重心插值 z，否则 null
function triZ(
  verts: number[],
  indices: number[],
  t: number,
  px: number,
  py: number
): number | null {
  const ia = indices[t * 3] * 3
  const ib = indices[t * 3 + 1] * 3
  const ic = indices[t * 3 + 2] * 3
  const ax = verts[ia]
  const ay = verts[ia + 1]
  const bx = verts[ib]
  const by = verts[ib + 1]
  const cx = verts[ic]
  const cy = verts[ic + 1]
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (Math.abs(denom) < 1e-12) return null
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
  const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
  const l3 = 1 - l1 - l2
  const eps = 1e-6
  if (l1 < -eps || l2 < -eps || l3 < -eps) return null
  return l1 * verts[ia + 2] + l2 * verts[ib + 2] + l3 * verts[ic + 2]
}

// 极简 OBJ 解析：v / f（支持 v、vt、vn 混合索引与三角扇）
export function parseObj(text: string): { vertices: number[]; indices: number[] } {
  const positions: number[] = []
  const indices: number[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    if (parts[0] === 'v') {
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]))
    } else if (parts[0] === 'f') {
      const face = parts.slice(1).map((p) => parseInt(p.split('/')[0], 10) - 1)
      for (let q = 1; q < face.length - 1; q++) {
        indices.push(face[0], face[q], face[q + 1])
      }
    }
  }
  return { vertices: positions, indices }
}

export { GRID_N }
