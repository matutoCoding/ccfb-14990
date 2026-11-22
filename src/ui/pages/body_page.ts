// 胎体与起底页：参数化胎体、OBJ 导入、凸点起伏实时预览
import { h, field, rangeInput, numberInput, textInput, selectInput, toast } from '../dom.ts'
import { createStudioViewer, type ViewerHandle } from '../viewer.ts'
import { store } from '../../state/store.ts'
import { parseObj } from '../../sim/body.ts'
import type { BodyShape, BumpDistribution, BumpType } from '../../sim/types.ts'

export function renderBodyPage(): HTMLElement {
  const project = store.current
  if (!project) return emptyHint()

  const viewer = createStudioViewer()
  viewer.refresh()

  const panel = h('div', { class: 'side-panel' })
  panel.append(buildBodyCard(viewer), buildBumpCard(viewer))

  return h(
    'div',
    { class: 'page-body' },
    h(
      'div',
      { class: 'studio-layout' },
      h('div', { class: 'card viewer-panel' }, viewer.host),
      panel
    )
  )
}

function buildBodyCard(viewer: ViewerHandle): HTMLElement {
  const project = store.current!
  const body = project.body

  const nameField = field('作品名称', textInput(project.name, (v) => {
    void store.save((p) => {
      p.name = v
    })
  }))
  const customerField = field('客户 / 订单', textInput(project.customer, (v) => {
    void store.save((p) => {
      p.customer = v
    })
  }))

  const shapeSelect = selectInput<BodyShape>(
    body.shape,
    [
      { value: 'disk', label: '圆盘' },
      { value: 'box', label: '方盒' },
      { value: 'bowl', label: '茶碗' },
      { value: 'obj', label: '导入 OBJ 模型' }
    ],
    (v) => applyStructural(viewer, (p) => {
      p.body.shape = v
      if (v === 'box') {
        p.body.width = Math.max(p.body.width, 200)
        p.body.depth = Math.max(p.body.depth, 200)
      }
    })
  )

  const diameter = field('直径 (mm)', numberInput(body.diameter, (v) => {
    applyStructural(viewer, (p) => {
      p.body.diameter = Math.max(80, v)
      p.body.width = p.body.diameter
      p.body.depth = p.body.diameter
    })
  }))
  const width = field('宽度 (mm)', numberInput(body.width, (v) => applyStructural(viewer, (p) => {
    p.body.width = Math.max(80, v)
  })))
  const depth = field('进深 (mm)', numberInput(body.depth, (v) => applyStructural(viewer, (p) => {
    p.body.depth = Math.max(80, v)
  })))
  const wall = field('壁厚 (mm)', numberInput(body.wallThickness, (v) => applyStructural(viewer, (p) => {
    p.body.wallThickness = Math.max(2, v)
  })))
  const curvature = field('盘面弧度 / 碗高 (mm)', numberInput(body.curvature, (v) => applyStructural(viewer, (p) => {
    p.body.curvature = Math.max(0, v)
  })))

  const importBtn = h('button', { class: 'btn' }, '导入 OBJ 文件')
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.obj'
  fileInput.style.display = 'none'
  importBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = parseObj(String(reader.result))
        if (parsed.indices.length === 0) throw new Error('未解析到面片')
        applyStructural(viewer, (p) => {
          p.body.shape = 'obj'
          p.body.objVertices = parsed.vertices
          p.body.objIndices = parsed.indices
        })
        toast(`已导入 ${parsed.indices.length / 3} 个三角面`)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'OBJ 解析失败', 'error')
      }
    }
    reader.readAsText(file)
  })

  const sizeFields = body.shape === 'box' || body.shape === 'obj' ? [width, depth] : [diameter]

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, '胎体参数')),
    h(
      'div',
      { class: 'card-body col' },
      nameField,
      customerField,
      field('胎体形状', shapeSelect),
      h('div', { class: 'form-grid' }, ...sizeFields, wall, curvature),
      h('div', { class: 'row' }, importBtn, fileInput)
    )
  )
}

function buildBumpCard(viewer: ViewerHandle): HTMLElement {
  const project = store.current!
  const bump = project.bump

  const typeSelect = selectInput<BumpType>(
    bump.type,
    [
      { value: 'seed', label: '稠漆麻籽' },
      { value: 'finger', label: '手指捺点' }
    ],
    (v) => applyStructural(viewer, (p) => {
      p.bump.type = v
    })
  )
  const distSelect = selectInput<BumpDistribution>(
    bump.distribution,
    [
      { value: 'grid', label: '规整排布' },
      { value: 'random', label: '随机散布' },
      { value: 'spiral', label: '螺旋分布' }
    ],
    (v) => applyStructural(viewer, (p) => {
      p.bump.distribution = v
    })
  )

  const density = rangeRow('凸点密度 (个/dm²)', bump.density, 2, 30, 1, (v) => {
    applyStructural(viewer, (p) => {
      p.bump.density = v
    })
  })
  const height = rangeRow('凸点高度 (mm)', bump.height, 0.4, 5, 0.1, (v) => {
    applyStructural(viewer, (p) => {
      p.bump.height = v
    })
  })
  const radius = rangeRow('凸点底径 (mm)', bump.radius, 3, 20, 0.5, (v) => {
    applyStructural(viewer, (p) => {
      p.bump.radius = v
    })
  })
  const variation = rangeRow('大小参差', bump.variation, 0, 1, 0.05, (v) => {
    applyStructural(viewer, (p) => {
      p.bump.variation = v
    })
  })

  const seedInput = numberInput(bump.seed, (v) => applyStructural(viewer, (p) => {
    p.bump.seed = Math.max(1, Math.round(v))
  }))
  const reseed = h('button', { class: 'btn sm' }, '换一批种子')
  reseed.addEventListener('click', () => applyStructural(viewer, (p) => {
    p.bump.seed = Math.floor(Math.random() * 1e9)
  }))

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, '起底凸点')),
    h(
      'div',
      { class: 'card-body col' },
      h('div', { class: 'form-grid' }, field('起底方式', typeSelect), field('分布方式', distSelect)),
      density,
      height,
      radius,
      variation,
      h('div', { class: 'row' }, field('随机种子', seedInput), reseed)
    )
  )
}

function rangeRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void
): HTMLElement {
  const valueLabel = h('span', { class: 'value-hint' }, String(value))
  const input = rangeInput(value, min, max, step, (v) => {
    valueLabel.textContent = String(v)
    onInput(v)
  })
  return h('div', { class: 'field' }, h('label', {}, label), h('div', { class: 'range-row' }, input, valueLabel))
}

// 结构性参数：保存后强制重建推演再刷新视图
function applyStructural(viewer: ViewerHandle, mutate: (p: NonNullable<typeof store.current>) => void): void {
  void store.save(mutate).then(() => {
    store.invalidate()
    viewer.refresh()
  })
}

function emptyHint(): HTMLElement {
  return h(
    'div',
    { class: 'page-body' },
    h(
      'div',
      { class: 'empty-state card' },
      h('div', { class: 'empty-title' }, '请先从作品列表选择一件作品')
    )
  )
}
