// 预置教学作品：经典三色、七八层复杂款等，首次启动写入 IndexedDB
import type { Project } from './types.ts'
import { hashSeed, uid } from './rng.ts'

function layer(
  name: string,
  color: string,
  thickness: number,
  shrinkage: number,
  dryDays: number,
  flow = 0.32
): Project['layers'][number] {
  return { id: uid(), name, color, thickness, shrinkage, dryDays, flow }
}

function baseProject(partial: Partial<Project>): Project {
  const now = Date.now()
  return {
    id: uid(),
    name: '未命名作品',
    customer: '',
    note: '',
    createdAt: now,
    updatedAt: now,
    body: {
      shape: 'disk',
      diameter: 400,
      width: 400,
      depth: 400,
      wallThickness: 8,
      curvature: 6
    },
    bump: {
      type: 'seed',
      distribution: 'grid',
      density: 12,
      height: 2.2,
      radius: 9,
      seed: 1001,
      variation: 0.35
    },
    layers: [],
    strokes: [],
    polished: false,
    light: 'studio',
    ...partial
  }
}

export function presetProjects(): Project[] {
  const classic = baseProject({
    name: '朱砂黑金·三色茶盘',
    customer: '样件 A-01',
    note: '红黑黄三色经典款，麻籽起底，适合客户看纹',
    body: {
      shape: 'disk',
      diameter: 400,
      width: 400,
      depth: 400,
      wallThickness: 8,
      curvature: 6
    },
    bump: {
      type: 'seed',
      distribution: 'grid',
      density: 12,
      height: 2.2,
      radius: 9,
      seed: hashSeed('classic-three-color'),
      variation: 0.35
    },
    layers: [
      layer('朱漆底层', '#9e2b25', 0.62, 0.18, 7),
      layer('黑漆二层', '#171412', 0.5, 0.15, 6),
      layer('金漆三层', '#c9a24b', 0.55, 0.12, 8),
      layer('黑漆四层', '#171412', 0.48, 0.15, 6),
      layer('朱漆面层', '#a83226', 0.58, 0.18, 7)
    ]
  })

  const complex = baseProject({
    name: '八层叠髹·圆捧盒',
    customer: '样件 B-02',
    note: '八层复杂叠色，指捺凸点，磨显层次最丰富',
    body: {
      shape: 'box',
      diameter: 300,
      width: 300,
      depth: 300,
      wallThickness: 10,
      curvature: 5
    },
    bump: {
      type: 'finger',
      distribution: 'random',
      density: 16,
      height: 2.8,
      radius: 12,
      seed: hashSeed('eight-layer-box'),
      variation: 0.5
    },
    layers: [
      layer('黑漆固底', '#14110f', 0.55, 0.16, 6),
      layer('朱漆', '#9e2b25', 0.45, 0.18, 7),
      layer('褐漆', '#6b4423', 0.45, 0.14, 6),
      layer('黑漆', '#171412', 0.42, 0.15, 6),
      layer('金漆', '#c9a24b', 0.44, 0.12, 8),
      layer('朱漆', '#a83226', 0.42, 0.18, 7),
      layer('黑漆', '#171412', 0.4, 0.15, 6),
      layer('金漆面', '#d4b25c', 0.5, 0.12, 8)
    ]
  })

  const bowl = baseProject({
    name: '黑漆金纹·茶碗',
    customer: '样件 C-03',
    note: '碗胎深弧面，螺旋分布凸点',
    body: {
      shape: 'bowl',
      diameter: 220,
      width: 220,
      depth: 220,
      wallThickness: 6,
      curvature: 14
    },
    bump: {
      type: 'seed',
      distribution: 'spiral',
      density: 10,
      height: 1.8,
      radius: 7,
      seed: hashSeed('bowl-spiral'),
      variation: 0.3
    },
    layers: [
      layer('黑漆底', '#14110f', 0.5, 0.16, 6),
      layer('金漆', '#c9a24b', 0.45, 0.12, 8),
      layer('黑漆', '#171412', 0.45, 0.15, 6),
      layer('朱漆面', '#9e2b25', 0.5, 0.18, 7),
      layer('黑漆罩', '#171412', 0.42, 0.15, 6)
    ]
  })

  const minimal = baseProject({
    name: '双色素髹·长方盘',
    customer: '样件 D-04',
    note: '朱黑双色，低密度凸点，纹样疏朗',
    body: {
      shape: 'box',
      diameter: 0,
      width: 420,
      depth: 260,
      wallThickness: 8,
      curvature: 4
    },
    bump: {
      type: 'finger',
      distribution: 'grid',
      density: 6,
      height: 2,
      radius: 11,
      seed: hashSeed('minimal-duo'),
      variation: 0.4
    },
    layers: [
      layer('朱漆底', '#9e2b25', 0.6, 0.18, 7),
      layer('黑漆面', '#171412', 0.55, 0.15, 6),
      layer('朱漆罩', '#a83226', 0.5, 0.18, 7)
    ]
  })

  return [classic, complex, bowl, minimal]
}
