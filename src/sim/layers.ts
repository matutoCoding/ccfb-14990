// 髹漆层推演：湿漆沉积 -> 固定迭代通量扩散（凸顶流薄、凹处积厚）-> 干燥收缩
// 采用逐邻居对的对称交换格式：每条边只算一次、两端同步加减，守恒由结构保证
// 全部运算顺序固定、无系统随机，同参数必然同结果
import type { DomainGrid } from './grid.ts'
import type { LacquerLayer } from './types.ts'

const FLOW_ITERATIONS = 10

export interface LayerBuildResult {
  // 每层干燥后的实际厚度场
  thickness: Float32Array[]
  // 每层干燥前的湿漆厚度场（工艺分析用）
  wet: Float32Array[]
  // 叠加完成后的总表面高度（胎体 + 凸点 + 干漆）
  surface: Float32Array
}

export function buildLayers(
  grid: DomainGrid,
  baseHeight: Float32Array,
  layers: LacquerLayer[]
): LayerBuildResult {
  const n = grid.n
  const count = n * n
  const thickness: Float32Array[] = []
  const wet: Float32Array[] = []
  const surface = new Float32Array(baseHeight)

  for (const layer of layers) {
    const wetField = new Float32Array(count)
    wetField.fill(layer.thickness)

    const { gA, gB } = grid.conductance(layer.flow)
    const dryScale = 1 - layer.shrinkage
    // 坡面重力系数（1/毫米），把高度差换算成等效厚度驱动力
    const gravityK = 0.9

    for (let iter = 0; iter < FLOW_ITERATIONS; iter++) {
      // 径向 / i 方向边
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n; j++) {
          const k = grid.idx(i, j)
          const k2 = grid.idx(i + 1, j)
          const drive = wetField[k] - wetField[k2] + gravityK * (surface[k] - surface[k2])
          // 限幅在 [-w2, w1] 内：非负且总量不变
          const flux = Math.max(-wetField[k2], Math.min(wetField[k], gA[k] * drive))
          wetField[k] -= flux
          wetField[k2] += flux
        }
      }
      // 角度 / j 方向边（环绕，跳过极点 i=0）
      for (let i = 1; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const k = grid.idx(i, j)
          const k2 = grid.idx(i, grid.wrapJ(j + 1))
          const drive = wetField[k] - wetField[k2] + gravityK * (surface[k] - surface[k2])
          const flux = Math.max(-wetField[k2], Math.min(wetField[k], gB[k] * drive))
          wetField[k] -= flux
          wetField[k2] += flux
        }
      }
    }

    wet.push(new Float32Array(wetField))
    const dry = new Float32Array(count)
    for (let k = 0; k < count; k++) {
      dry[k] = wetField[k] * dryScale
      surface[k] += dry[k]
    }
    thickness.push(dry)
  }

  return { thickness, wet, surface }
}
