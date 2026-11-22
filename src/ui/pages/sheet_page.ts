// 工艺单页：每层配色、厚度、阴干天数与打磨顺序，支持浏览器打印
import { h } from '../dom.ts'
import { iconSvg } from '../icons.ts'
import { store } from '../../state/store.ts'
import { TOOL_PARAMS } from '../../sim/grind.ts'

export function renderSheetPage(): HTMLElement {
  const project = store.current
  if (!project) {
    return h('div', { class: 'page-body' }, h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择作品')))
  }

  const printBtn = h('button', { class: 'btn primary no-print' }, h('span', { html: iconSvg('print') }), '打印工艺单')
  printBtn.addEventListener('click', () => window.print())

  const totalDry = project.layers.reduce((sum, l) => sum + l.dryDays, 0)
  const shapeLabel: Record<string, string> = { disk: '圆盘', box: '方盒', bowl: '茶碗', obj: 'OBJ 模型' }
  const bumpLabel = project.bump.type === 'seed' ? '稠漆麻籽' : '手指捺点'

  const layerRows = project.layers.map((layer, index) =>
    h(
      'tr',
      {},
      td(String(index + 1)),
      td(h('span', { class: 'row' }, h('span', { class: 'color-dot', style: `background:${layer.color}` }), layer.color)),
      td(layer.name),
      td(`${layer.thickness.toFixed(2)} mm`),
      td(`${Math.round(layer.shrinkage * 100)}%`),
      td(`${layer.dryDays} 天`),
      td(layer.flow.toFixed(2))
    )
  )

  const strokeRows = project.strokes.map((stroke, index) =>
    h(
      'tr',
      {},
      td(String(index + 1)),
      td(TOOL_PARAMS[stroke.tool].label),
      td(`${stroke.radius} mm`),
      td(stroke.pressure.toFixed(2)),
      td(`${stroke.points.length} 个轨迹点`)
    )
  )

  const sheet = h(
    'div',
    { class: 'sheet' },
    h('div', { class: 'sheet-head' }, h('h1', {}, '犀皮漆髹饰工艺单'), h('p', { class: 'muted' }, '大漆工作室 · 数字化推演档案')),
    h(
      'div',
      { class: 'sheet-meta' },
      meta('作品名称', project.name),
      meta('客户 / 订单', project.customer || '—'),
      meta('胎体形状', shapeLabel[project.body.shape] ?? '—'),
      meta('胎体尺寸', `${project.body.diameter || `${project.body.width}×${project.body.depth}`} mm`),
      meta('壁厚', `${project.body.wallThickness} mm`),
      meta('起底方式', `${bumpLabel} / ${project.bump.distribution}`),
      meta('凸点密度', `${project.bump.density} 个/dm²`),
      meta('凸点高度', `${project.bump.height} mm`),
      meta('随机种子', String(project.bump.seed)),
      meta('漆层总数', `${project.layers.length} 层`),
      meta('累计阴干', `${totalDry} 天`),
      meta('打磨笔数', `${project.strokes.length} 笔`)
    ),
    h('h3', {}, '一、髹漆层配色与厚度'),
    h(
      'table',
      { class: 'data-table' },
      h('thead', {}, h('tr', {}, th('序'), th('色值'), th('层名'), th('名义厚度'), th('收缩率'), th('阴干'), th('流动系数'))),
      h('tbody', {}, ...(layerRows.length ? layerRows : [h('tr', {}, td('暂无漆层记录', 7))]))
    ),
    h('h3', { style: 'margin-top:var(--sp-6)' }, '二、打磨顺序'),
    h(
      'table',
      { class: 'data-table' },
      h('thead', {}, h('tr', {}, th('序'), th('磨具'), th('半径'), th('下压力'), th('轨迹'))),
      h('tbody', {}, ...(strokeRows.length ? strokeRows : [h('tr', {}, td('暂无打磨记录', 5))]))
    ),
    h('p', { class: 'muted', style: 'margin-top:var(--sp-6)' }, `备注：${project.note || '无'}。本工艺单由推演系统按当前档案生成，同种子同参数可复现。`)
  )

  return h('div', { class: 'page-body' }, h('div', { class: 'row between no-print' }, h('h2', {}, '工艺单'), printBtn), sheet)
}

function td(content: string | HTMLElement, colspan?: number): HTMLTableCellElement {
  const cell = document.createElement('td')
  if (colspan) cell.colSpan = colspan
  if (typeof content === 'string') cell.textContent = content
  else cell.append(content)
  return cell
}

function th(text: string): HTMLTableCellElement {
  const cell = document.createElement('th')
  cell.textContent = text
  return cell
}

function meta(label: string, value: string): HTMLElement {
  return h('div', {}, h('span', { class: 'muted' }, label), h('span', {}, value))
}
