// 髹漆层页：逐层管理颜色/厚度/收缩/流动，查看实际厚度统计
import { h, field, numberInput, colorInput, toast } from '../dom.ts'
import { iconSvg } from '../icons.ts'
import { createStudioViewer } from '../viewer.ts'
import { store } from '../../state/store.ts'
import { uid } from '../../sim/rng.ts'
import type { LacquerLayer } from '../../sim/types.ts'

export function renderLayersPage(): HTMLElement {
  const project = store.current
  if (!project) {
    return h('div', { class: 'page-body' }, h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择作品')))
  }

  const viewer = createStudioViewer()
  viewer.refresh()

  const addBtn = h('button', { class: 'btn primary' }, h('span', { html: iconSvg('plus') }), '添加漆层')
  addBtn.addEventListener('click', () => {
    if (project.layers.length >= 12) {
      toast('最多支持 12 层叠髹', 'error')
      return
    }
    void store
      .save((p) => {
        p.layers.push({
          id: uid(),
          name: `第${p.layers.length + 1}层漆`,
          color: '#7a3b2e',
          thickness: 0.5,
          shrinkage: 0.15,
          dryDays: 7,
          flow: 0.32
        })
      })
      .then(() => {
        store.invalidate()
        viewer.refresh()
      })
  })

  const tableCard = h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, `髹漆层（${project.layers.length}/12）`), addBtn),
    h('div', { class: 'card-body tight table-wrap' }, renderTable(project, viewer)),
    h('div', { class: 'card-body' }, renderThicknessSummary(viewer))
  )

  return h(
    'div',
    { class: 'page-body' },
    h('div', { class: 'studio-layout' }, h('div', { class: 'card viewer-panel' }, viewer.host), tableCard)
  )
}

function renderTable(project: NonNullable<typeof store.current>, viewer: ReturnType<typeof createStudioViewer>): HTMLElement {
  const table = document.createElement('table')
  table.className = 'data-table'
  const thead = document.createElement('thead')
  thead.innerHTML = '<tr><th>序</th><th>色样</th><th>层名</th><th>名义厚度 mm</th><th>收缩率</th><th>流动系数</th><th>阴干天</th><th>操作</th></tr>'
  const tbody = document.createElement('tbody')

  const rerender = (): void => {
    tbody.replaceChildren()
    project.layers.forEach((layer, index) => tbody.append(row(layer, index, project, viewer, rerender)))
  }

  project.layers.forEach((layer, index) => tbody.append(row(layer, index, project, viewer, rerender)))
  table.append(thead, tbody)
  return table
}

function row(
  layer: LacquerLayer,
  index: number,
  project: NonNullable<typeof store.current>,
  viewer: ReturnType<typeof createStudioViewer>,
  rerender: () => void
): HTMLElement {
  const tr = document.createElement('tr')

  const persist = (mutate: (l: LacquerLayer) => void): void => {
    void store
      .save((p) => {
        const target = p.layers.find((l) => l.id === layer.id)
        if (target) mutate(target)
      })
      .then(() => {
        store.invalidate()
        viewer.refresh()
      })
  }

  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.value = layer.name
  nameInput.addEventListener('change', () => persist((l) => {
    l.name = nameInput.value
  }))

  const thickness = numberInput(layer.thickness, (v) => persist((l) => {
    l.thickness = Math.min(2, Math.max(0.05, v))
  }))
  thickness.step = '0.05'

  const shrink = numberInput(layer.shrinkage, (v) => persist((l) => {
    l.shrinkage = Math.min(0.6, Math.max(0, v))
  }))
  shrink.step = '0.01'

  const flow = numberInput(layer.flow, (v) => persist((l) => {
    l.flow = Math.min(1, Math.max(0, v))
  }))
  flow.step = '0.02'

  const days = numberInput(layer.dryDays, (v) => persist((l) => {
    l.dryDays = Math.max(1, Math.round(v))
  }))

  const color = colorInput(layer.color, (v) => persist((l) => {
    l.color = v
  }))

  const del = h('button', { class: 'btn sm danger' }, h('span', { html: iconSvg('trash') }))
  del.addEventListener('click', () => {
    void store
      .save((p) => {
        p.layers = p.layers.filter((l) => l.id !== layer.id)
      })
      .then(() => {
        store.invalidate()
        rerender()
        viewer.refresh()
      })
  })

  const up = h('button', { class: 'btn sm', disabled: index === 0 ? '' : null }, '上移')
  up.addEventListener('click', () => {
    if (index === 0) return
    void store
      .save((p) => {
        const list = p.layers
        ;[list[index - 1], list[index]] = [list[index], list[index - 1]]
      })
      .then(() => {
        store.invalidate()
        rerender()
        viewer.refresh()
      })
  })

  const td = (node: Node): HTMLTableCellElement => {
    const cell = document.createElement('td')
    cell.append(node)
    return cell
  }

  tr.append(
    td(document.createTextNode(String(index + 1))),
    td(color),
    td(nameInput),
    td(thickness),
    td(shrink),
    td(flow),
    td(days),
    td(h('div', { class: 'row' }, up, del))
  )
  void project
  return tr
}

// 实际厚度统计：凸顶与凹处的干漆均值，验证流动效果
function renderThicknessSummary(viewer: ReturnType<typeof createStudioViewer>): HTMLElement {
  const sim = store.ensureSimulation()
  if (!sim || sim.layerThickness.length === 0) {
    return h('div', { class: 'muted' }, '添加漆层后，这里会显示凸顶与凹处的实际干漆厚度对比')
  }
  const rows = sim.layerCfgs.map((cfg, li) => {
    let topSum = 0
    let topN = 0
    let valleySum = 0
    let valleyN = 0
    const fieldData = sim.layerThickness[li]
    for (let k = 0; k < sim.bumpHeight.length; k++) {
      if (sim.bumpHeight[k] > sim.bumpCfg.height * 0.8) {
        topSum += fieldData[k]
        topN++
      } else if (sim.bumpHeight[k] < sim.bumpCfg.height * 0.15) {
        valleySum += fieldData[k]
        valleyN++
      }
    }
    const top = (topSum / Math.max(1, topN)).toFixed(3)
    const valley = (valleySum / Math.max(1, valleyN)).toFixed(3)
    return h('div', { class: 'metric-row' }, h('span', { class: 'metric-name' }, h('span', { class: 'color-dot', style: `background:${cfg.color}` }), cfg.name), h('span', { class: 'metric-value' }, `凸顶 ${top} mm / 凹处 ${valley} mm`))
  })
  void viewer
  return h('div', { class: 'col' }, h('h3', {}, '实际干漆厚度（流动后）'), ...rows)
}

void field
