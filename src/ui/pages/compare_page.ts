// 纹样比对页：参考照片与推演结果并排，色块面积占比与纹路密度对比
import { h, toast } from '../dom.ts'
import { iconSvg } from '../icons.ts'
import { store } from '../../state/store.ts'
import { analyzeImage, analyzePattern, compareColorRatios, type ImageColorStat } from '../../sim/analysis.ts'
import type { PatternStats } from '../../sim/analysis.ts'

export function renderComparePage(): HTMLElement {
  const project = store.current
  if (!project) {
    return h('div', { class: 'page-body' }, h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择作品')))
  }

  const sim = store.ensureSimulation()
  const stats: PatternStats | null = sim
    ? analyzePattern(sim.grid, sim.exposed, project.layers, sim.breachRatio())
    : null

  const right = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, '推演纹样')))
  const simCanvas = document.createElement('canvas')
  simCanvas.className = 'compare-img'
  simCanvas.width = 256
  simCanvas.height = 256
  right.append(h('div', { class: 'card-body' }, simCanvas, stats ? simMetrics(stats) : null))
  renderSimCanvas(simCanvas, stats)

  const left = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, '客户参考照片')))
  const refBody = h('div', { class: 'card-body col' })
  left.append(refBody)
  renderReference(refBody, project, stats)

  return h('div', { class: 'page-body' }, h('h2', {}, '纹样比对'), h('div', { class: 'compare-grid' }, left, right))
}

function renderSimCanvas(canvas: HTMLCanvasElement, stats: PatternStats | null): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || !stats) return
  const n = 32
  const cell = canvas.width / n
  const sim = store.simulation
  if (!sim) return
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const gi = Math.floor((i / n) * sim.grid.n)
      const gj = Math.floor((j / n) * sim.grid.n)
      const li = sim.exposed[sim.grid.idx(gi, gj)]
      const color = li < 0 ? '#c0392b' : projectColor(li)
      ctx.fillStyle = color
      ctx.fillRect(i * cell, j * cell, cell + 1, cell + 1)
    }
  }
}

function projectColor(layerIndex: number): string {
  return store.current?.layers[layerIndex]?.color ?? '#888888'
}

function simMetrics(stats: PatternStats): HTMLElement {
  const rows = [
    h('div', { class: 'metric-row' }, h('span', { class: 'metric-name' }, '纹路密度'), h('span', { class: 'metric-value' }, stats.patternDensity.toFixed(3))),
    h('div', { class: 'metric-row' }, h('span', { class: 'metric-name' }, '磨穿占比'), h('span', { class: 'metric-value danger-text' }, `${(stats.breachRatio * 100).toFixed(2)}%`))
  ]
  for (const c of stats.colorRatio) {
    if (c.ratio < 0.005) continue
    rows.push(
      h(
        'div',
        { class: 'metric-row' },
        h('span', { class: 'metric-name' }, h('span', { class: 'color-dot', style: `background:${c.color}` }), store.current?.layers[c.layerIndex]?.name ?? `第${c.layerIndex + 1}层`),
        h('span', { class: 'metric-value' }, `${(c.ratio * 100).toFixed(1)}%`)
      )
    )
  }
  return h('div', { style: 'margin-top:var(--sp-4)' }, ...rows)
}

function renderReference(container: HTMLElement, project: NonNullable<typeof store.current>, stats: PatternStats | null): void {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.style.display = 'none'

  const upload = h('button', { class: 'btn primary' }, h('span', { html: iconSvg('upload') }), '上传参考照片')
  upload.addEventListener('click', () => fileInput.click())

  const content = h('div', { class: 'col' })
  container.append(h('div', { class: 'row' }, upload, fileInput), content)

  if (project.referenceImage) {
    const img = document.createElement('img')
    img.className = 'compare-img'
    img.src = project.referenceImage
    content.append(img)
  } else {
    content.append(
      h(
        'div',
        { class: 'empty-state' },
        h('span', { class: 'empty-icon', html: iconSvg('compare') }),
        h('div', { class: 'empty-title' }, '尚未上传参考照片'),
        h('div', { class: 'empty-sub' }, '上传客户给的纹样照片，自动提取主色占比与纹路密度')
      )
    )
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      void store
        .save((p) => {
          p.referenceImage = dataUrl
        })
        .then(() => {
          toast('参考照片已保存到工艺档案')
          window.dispatchEvent(new HashChangeEvent('hashchange'))
        })
    }
    reader.readAsDataURL(file)
  })

  if (project.referenceImage && stats) {
    void analyzeImage(project.referenceImage)
      .then((refStats) => {
        content.append(refMetrics(refStats, stats))
      })
      .catch((err: unknown) => {
        toast(err instanceof Error ? err.message : '参考图分析失败', 'error')
      })
  }
}

function refMetrics(ref: ImageColorStat, stats: PatternStats): HTMLElement {
  const compare = compareColorRatios(stats, ref)
  const rows = [
    h(
      'div',
      { class: 'metric-row' },
      h('span', { class: 'metric-name' }, '纹路密度（参考）'),
      h('span', { class: 'metric-value' }, ref.edgeDensity.toFixed(3))
    ),
    h(
      'div',
      { class: 'metric-row' },
      h('span', { class: 'metric-name' }, '密度差异'),
      h('span', { class: 'metric-value' }, Math.abs(ref.edgeDensity - stats.patternDensity).toFixed(3))
    ),
    h(
      'div',
      { class: 'metric-row' },
      h('span', { class: 'metric-name' }, '主色占比平均偏差'),
      h('span', { class: 'metric-value' }, `${(compare.totalDiff * 100).toFixed(1)}%`)
    )
  ]
  for (const m of compare.matched) {
    rows.push(
      h(
        'div',
        { class: 'metric-row' },
        h(
          'span',
          { class: 'metric-name' },
          h('span', { class: 'color-dot', style: `background:${m.simColor}` }),
          '推演 vs ',
          h('span', { class: 'color-dot', style: `background:${m.refColor}` }),
          '参考'
        ),
        h('span', { class: 'metric-value' }, `${(m.simRatio * 100).toFixed(1)}% / ${(m.refRatio * 100).toFixed(1)}%`)
      )
    )
  }
  return h('div', { style: 'margin-top:var(--sp-4)' }, h('h3', {}, '对比结果'), ...rows)
}
