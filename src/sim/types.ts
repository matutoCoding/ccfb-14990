// 全局领域模型：工艺档案的全部可持久化数据

export type BodyShape = 'disk' | 'box' | 'bowl' | 'obj'

export type DomainMode = 'polar' | 'rect'

export type BumpType = 'seed' | 'finger'

export type BumpDistribution = 'grid' | 'random' | 'spiral'

export type ToolType = 'coarse' | 'medium' | 'fine'

export type RenderMode = 'craft' | 'layer' | 'grind' | 'heat'

export type LightPreset = 'studio' | 'warm' | 'daylight'

export interface BodyConfig {
  shape: BodyShape
  // 直径或边长，毫米
  diameter: number
  width: number
  depth: number
  // 壁厚，毫米
  wallThickness: number
  // 盘面浅凹深度 / 碗高，毫米
  curvature: number
  // 导入 OBJ 时的参数域网格尺寸（固定方形域）
  objVertices?: number[]
  objIndices?: number[]
}

export interface BumpConfig {
  type: BumpType
  distribution: BumpDistribution
  // 每平方分米凸点数
  density: number
  // 凸点平均高度，毫米
  height: number
  // 凸点平均底径，毫米
  radius: number
  // 随机种子
  seed: number
  // 麻籽大小参差（变异系数 0~1）
  variation: number
}

export interface LacquerLayer {
  id: string
  name: string
  color: string
  // 名义髹涂厚度，毫米（湿漆）
  thickness: number
  // 干燥收缩率 0~1
  shrinkage: number
  // 阴干天数
  dryDays: number
  // 流动扩散系数（越大越容易从凸顶流向凹处）
  flow: number
}

export interface StrokePoint {
  // 参数域坐标：polar 时 x=半径比(0~1) y=角度(弧度)；rect 时为归一化 0~1
  x: number
  y: number
}

export interface GrindStroke {
  id: string
  tool: ToolType
  // 磨具半径，毫米
  radius: number
  // 下压力度 0~1
  pressure: number
  // 每点切削深度系数，毫米/点
  cutRate: number
  points: StrokePoint[]
  // 创建顺序，回放依据
  order: number
}

export interface Project {
  id: string
  name: string
  customer: string
  note: string
  createdAt: number
  updatedAt: number
  body: BodyConfig
  bump: BumpConfig
  layers: LacquerLayer[]
  strokes: GrindStroke[]
  // 打磨后光工序开关
  polished: boolean
  light: LightPreset
  // 参考图（dataURL），纹样比对用
  referenceImage?: string
}
