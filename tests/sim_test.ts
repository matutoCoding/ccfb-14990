// 推演内核确定性与物理性质测试：node --experimental-strip-types tests/sim_test.ts
import { DomainGrid } from '../src/sim/grid.ts'
import { Simulation, TOOL_PARAMS } from '../src/sim/grind.ts'
import { buildLayers } from '../src/sim/layers.ts'
import { buildBumpHeight } from '../src/sim/bump.ts'
import { buildBodyHeight } from '../src/sim/body.ts'
import { mulberry32 } from '../src/sim/rng.ts'
import type { BumpConfig, BodyConfig, GrindStroke, LacquerLayer, StrokePoint, ToolType } from '../src/sim/types.ts'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ok - ${msg}`)
  } else {
    failures++
    console.error(`  FAIL - ${msg}`)
  }
}

const body: BodyConfig = {
  shape: 'disk',
  diameter: 400,
  width: 400,
  depth: 400,
  wallThickness: 8,
  curvature: 6
}

const bump: BumpConfig = {
  type: 'seed',
  distribution: 'grid',
  density: 12,
  height: 2.2,
  radius: 9,
  seed: 20261122,
  variation: 0.35
}

const layers: LacquerLayer[] = [
  { id: 'l1', name: '朱漆', color: '#9e2b25', thickness: 0.6, shrinkage: 0.18, dryDays: 7, flow: 0.35 },
  { id: 'l2', name: '黑漆', color: '#171412', thickness: 0.5, shrinkage: 0.15, dryDays: 6, flow: 0.3 },
  { id: 'l3', name: '金漆', color: '#c9a24b', thickness: 0.55, shrinkage: 0.12, dryDays: 8, flow: 0.28 }
]

function makeStrokes(): GrindStroke[] {
  const rand = mulberry32(99)
  const tools: ToolType[] = ['coarse', 'medium', 'fine']
  const strokes: GrindStroke[] = []
  for (let s = 0; s < 6; s++) {
    const tool = tools[s % 3]
    const points: StrokePoint[] = []
    let u = 0.2 + rand() * 0.5
    let v = rand()
    for (let p = 0; p < 24; p++) {
      u = Math.min(0.95, Math.max(0.05, u + (rand() - 0.5) * 0.08))
      v = (v + rand() * 0.06) % 1
      points.push({ x: u, y: v })
    }
    strokes.push({
      id: `s${s}`,
      tool,
      radius: TOOL_PARAMS[tool].radius,
      pressure: 0.4 + rand() * 0.5,
      cutRate: TOOL_PARAMS[tool].cutRate,
      points,
      order: s
    })
  }
  return strokes
}

console.log('1. 胎体与凸点场确定性')
const grid = new DomainGrid('polar', 200, 400, 400)
const bh1 = buildBodyHeight(grid, body)
const bh2 = buildBodyHeight(grid, body)
assert(Float32Array.from(bh1).every((v, k) => v === bh2[k]), '同参数胎体高度场逐点一致')
const bump1 = buildBumpHeight(grid, bump)
const bump2 = buildBumpHeight(grid, { ...bump })
assert(Float32Array.from(bump1).every((v, k) => v === bump2[k]), '同种子凸点场逐点一致')
const bump3 = buildBumpHeight(grid, { ...bump, seed: bump.seed + 1 })
assert(bump3.some((v, k) => v !== bump1[k]), '换种子凸点场发生变化')

console.log('2. 漆层流动：凸顶流薄、凹处积厚')
const base = new Float32Array(bh1.length)
for (let k = 0; k < base.length; k++) base[k] = bh1[k] + bump1[k]
const built = buildLayers(grid, base, layers)
let topThin = 0
let valleyThick = 0
let topCnt = 0
let valleyCnt = 0
for (let k = 0; k < base.length; k++) {
  if (bump1[k] > bump.height * 0.9) {
    topThin += built.wet[0][k]
    topCnt++
  } else if (bump1[k] < bump.height * 0.15) {
    valleyThick += built.wet[0][k]
    valleyCnt++
  }
}
assert(valleyThick / Math.max(1, valleyCnt) > topThin / Math.max(1, topCnt), '凹处湿漆厚度大于凸顶')

// 体积守恒（干漆总量 = 名义量 × (1-收缩)）
const area = grid.area
let nominal = 0
let actual = 0
for (let li = 0; li < layers.length; li++) {
  for (let k = 0; k < area.length; k++) {
    nominal += area[k] * layers[li].thickness * (1 - layers[li].shrinkage)
    actual += area[k] * built.thickness[li][k]
  }
}
const conservationError = Math.abs(actual - nominal) / nominal
assert(conservationError < 0.02, `干漆体积守恒误差 ${(conservationError * 100).toFixed(2)}% < 2%`)

console.log('3. 打磨推演确定性')
const simA = new Simulation(new DomainGrid('polar', 200, 400, 400), body, bump, layers)
const simB = new Simulation(new DomainGrid('polar', 200, 400, 400), body, { ...bump }, layers.map((l) => ({ ...l })))
const strokes = makeStrokes()
for (const s of strokes) simA.applyStroke(s)
simB.rebuild(strokes)
assert(simA.checksum() === simB.checksum(), `增量打磨与从零重放校验和一致 (${simA.checksum()})`)

// 再跑一次完全独立的实例
const simC = new Simulation(new DomainGrid('polar', 200, 400, 400), body, bump, layers)
simC.rebuild(strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })))
assert(simA.checksum() === simC.checksum(), '深拷贝输入后结果仍逐字节一致')

console.log('4. 打磨物理性质')
assert(simA.breachRatio() >= 0 && simA.breachRatio() <= 1, '磨穿比例在合法区间')
assert(simA.thinRatio() >= 0 && simA.thinRatio() <= 1, '薄漆预警比例在合法区间')
let nonNeg = true
for (let k = 0; k < simA.remaining.length; k++) {
  if (simA.remaining[k] < -1e-6 || simA.ground[k] < 0) nonNeg = false
}
assert(nonNeg, '剩余漆厚与切削深度均非负')
let exposedValid = true
for (let k = 0; k < simA.exposed.length; k++) {
  if (simA.exposed[k] < -1 || simA.exposed[k] >= layers.length) exposedValid = false
}
assert(exposedValid, '露出层序号全部合法')

// 重磨同一笔不会改变结果（幂等回放）
const before = simA.checksum()
simA.rebuild(strokes)
assert(simA.checksum() === before, '重复重放结果幂等')

console.log('5. 矩形域（盒胎）可运行且确定')
const rectGrid = new DomainGrid('rect', 0, 300, 200)
const rectBody: BodyConfig = { ...body, shape: 'box', width: 300, depth: 200 }
const simRect = new Simulation(rectGrid, rectBody, { ...bump, distribution: 'random' }, layers)
const simRect2 = new Simulation(new DomainGrid('rect', 0, 300, 200), rectBody, { ...bump, distribution: 'random' }, layers)
simRect.rebuild(strokes)
simRect2.rebuild(strokes)
assert(simRect.checksum() === simRect2.checksum(), '矩形域两次推演校验和一致')

if (failures > 0) {
  console.error(`\n${failures} 项测试失败`)
  const nodeProcess = (globalThis as { process?: { exit: (code: number) => void } }).process
  nodeProcess?.exit(1)
}
console.log('\n全部测试通过')
