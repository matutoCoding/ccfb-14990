// 纹样分析：从推演结果提取色块面积占比、纹路密度，并与参考照片比对
import type { DomainGrid } from './grid.ts'
import type { LacquerLayer } from './types.ts'

export interface PatternStats {
  // 每层颜色的可见面积占比
  colorRatio: Array<{ layerIndex: number; color: string; ratio: number }>
  // 纹路密度：色层边界格占比 0~1
  patternDensity: number
  // 磨穿占比
  breachRatio: number
}

export function analyzePattern(
  grid: DomainGrid,
  exposed: Int8Array,
  layers: LacquerLayer[],
  breachRatio: number
): PatternStats {
  const hits = new Array<number>(layers.length).fill(0)
  let valid = 0
  let edges = 0

  for (let i = 0; i < grid.n; i++) {
    for (let j = 0; j < grid.n; j++) {
      const k = grid.idx(i, j)
      const li = exposed[k]
      if (li < 0) continue
      valid++
      hits[li]++
      if (i < grid.n - 1 && exposed[grid.idx(i + 1, j)] !== li) edges++
      const j2 = grid.wrapJ(j + 1)
      if (i > 0 && exposed[grid.idx(i, j2)] !== li) edges++
    }
  }

  const denom = Math.max(1, valid)
  const colorRatio = layers.map((layer, index) => ({
    layerIndex: index,
    color: layer.color,
    ratio: hits[index] / denom
  }))

  // 边格密度按邻接关系数归一
  const totalAdj = Math.max(1, grid.n * (grid.n - 1) * 2)
  return {
    colorRatio,
    patternDensity: Math.min(1, edges / (totalAdj * 0.25)),
    breachRatio
  }
}

export interface ImageColorStat {
  // 聚类后的主色（hex）与占比
  colorRatio: Array<{ color: string; ratio: number }>
  // 图片边缘密度，由亮度 Sobel 估算
  edgeDensity: number
}

// 参考照片分析：固定 8 色中位切分聚类 + Sobel 边缘
export async function analyzeImage(dataUrl: string): Promise<ImageColorStat> {
  const img = await loadImage(dataUrl)
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布上下文')
  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data

  const pixels: Array<[number, number, number]> = []
  for (let p = 0; p < data.length; p += 4) {
    pixels.push([data[p], data[p + 1], data[p + 2]])
  }

  const clusters = medianCut(pixels, 8)
  const colorRatio = clusters
    .map((c) => ({ color: rgbToHex(c.r, c.g, c.b), ratio: c.count / pixels.length }))
    .sort((a, b) => b.ratio - a.ratio)

  const gray = new Float32Array(size * size)
  for (let p = 0; p < pixels.length; p++) {
    const [r, g, b] = pixels[p]
    gray[p] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  let edgeSum = 0
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const k = y * size + x
      const gx =
        -gray[k - size - 1] + gray[k - size + 1] - 2 * gray[k - 1] + 2 * gray[k + 1] -
        gray[k + size - 1] + gray[k + size + 1]
      const gy =
        -gray[k - size - 1] - 2 * gray[k - size] - gray[k - size + 1] +
        gray[k + size - 1] + 2 * gray[k + size] + gray[k + size + 1]
      if (Math.hypot(gx, gy) > 60) edgeSum++
    }
  }

  return { colorRatio, edgeDensity: edgeSum / ((size - 2) * (size - 2)) }
}

interface Cluster {
  r: number
  g: number
  b: number
  count: number
}

function medianCut(pixels: Array<[number, number, number]>, bucketCount: number): Cluster[] {
  let buckets: Array<Array<[number, number, number]>> = [pixels]
  while (buckets.length < bucketCount) {
    const next: Array<Array<[number, number, number]>> = []
    let splitAny = false
    for (const bucket of buckets) {
      if (bucket.length < 2) {
        next.push(bucket)
        continue
      }
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0
      for (const [r, g, b] of bucket) {
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r)
        gMin = Math.min(gMin, g); gMax = Math.max(gMax, g)
        bMin = Math.min(bMin, b); bMax = Math.max(bMax, b)
      }
      const range = Math.max(rMax - rMin, gMax - gMin, bMax - bMin)
      const channel = range === rMax - rMin ? 0 : range === gMax - gMin ? 1 : 2
      bucket.sort((a, b) => a[channel] - b[channel])
      const mid = bucket.length >> 1
      next.push(bucket.slice(0, mid), bucket.slice(mid))
      splitAny = true
    }
    buckets = next
    if (!splitAny) break
  }
  return buckets.map((bucket) => {
    let r = 0, g = 0, b = 0
    for (const px of bucket) {
      r += px[0]; g += px[1]; b += px[2]
    }
    const n = Math.max(1, bucket.length)
    return { r: r / n, g: g / n, b: b / n, count: bucket.length }
  })
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('参考图加载失败'))
    img.src = src
  })
}

// 将推演主色与参考图主色按最近色配对，返回占比差异（0 完全一致）
export function compareColorRatios(
  sim: PatternStats,
  ref: ImageColorStat
): { matched: Array<{ simColor: string; refColor: string; simRatio: number; refRatio: number; diff: number }>; totalDiff: number } {
  const matched = sim.colorRatio
    .filter((c) => c.ratio > 0.005)
    .map((c) => {
      let best = ref.colorRatio[0]
      let bestD = Infinity
      for (const rc of ref.colorRatio) {
        const d = colorDistance(c.color, rc.color)
        if (d < bestD) {
          bestD = d
          best = rc
        }
      }
      return {
        simColor: c.color,
        refColor: best.color,
        simRatio: c.ratio,
        refRatio: best.ratio,
        diff: Math.abs(c.ratio - best.ratio)
      }
    })
  const totalDiff = matched.reduce((sum, m) => sum + m.diff, 0) / Math.max(1, matched.length)
  return { matched, totalDiff }
}

export function colorDistance(a: string, b: string): number {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) / Math.sqrt(3 * 255 * 255)
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ]
}
