// 打磨推演页：磨具/压力控制、逐笔回放定位、确定性自检、推光与灯光
import { h, rangeInput, selectInput, toast } from '../dom.ts'
import { iconSvg } from '../icons.ts'
import { createStudioViewer, type ViewerHandle } from '../viewer.ts'
import { store } from '../../state/store.ts'
import { Simulation, TOOL_PARAMS } from '../../sim/grind.ts'
import { domainModeFor } from '../../sim/body.ts'
import { DomainGrid } from '../../sim/grid.ts'
import type { ToolType } from '../../sim/types.ts'

export function renderGrindPage(): HTMLElement {
  const project = store.current
  if (!project) {
    return h('div', { class: 'page-body' }, h('div', { class: 'empty-state card' }, h('div', { class: 'empty-title' }, '请先选择作品')))
  }

  const viewer = createStudioViewer()
  viewer.refresh()
  viewer.setGrindMode(true)

  const panel = h('div', { class: 'side-panel' })
  panel.append(buildToolCard(viewer), buildReplayCard(viewer), buildFinishCard(viewer))

  return h(
    'div',
    { class: 'page-body' },
    h('div', { class: 'studio-layout' }, h('div', { class: 'card viewer-panel' }, viewer.host), panel)
  )
}

function buildToolCard(viewer: ViewerHandle): HTMLElement {
  const project = store.current!
  let tool: ToolType = 'medium'
  let pressure = 0.6
  const pressureText = h('span', { class: 'value-hint' }, String(pressure))

  const hostExt = viewer.host as unknown as { setTool: (t: ToolType) => void; setPressure: (v: number) => void }
  hostExt.setTool(tool)
  hostExt.setPressure(pressure)

  const toolSelect = selectInput<ToolType>(
    tool,
    (Object.keys(TOOL_PARAMS) as ToolType[]).map((key) => ({
      value: key,
      label: `${TOOL_PARAMS[key].label}（半径 ${TOOL_PARAMS[key].radius}mm）`
    })),
    (v) => {
      tool = v
      hostExt.setTool(v)
    }
  )

  const pressureRange = rangeInput(pressure, 0.1, 1, 0.05, (v) => {
    pressure = v
    pressureText.textContent = v.toFixed(2)
    hostExt.setPressure(v)
  })

  const undo = h('button', { class: 'btn' }, '撤销上一笔')
  undo.addEventListener('click', async () => {
    if (project.strokes.length === 0) return
    project.strokes.pop()
    await store.save()
    rebuildAll(viewer)
    toast('已撤销上一笔')
  })

  const clear = h('button', { class: 'btn danger' }, h('span', { html: iconSvg('trash') }), '清空打磨')
  clear.addEventListener('click', async () => {
    if (!window.confirm('清空全部打磨记录？')) return
    project.strokes = []
    await store.save()
    rebuildAll(viewer)
  })

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, '磨具与下压力')),
    h(
      'div',
      { class: 'card-body col' },
      h('div', { class: 'field' }, h('label', {}, '磨具'), toolSelect),
      h('div', { class: 'field' }, h('label', {}, '下压力度'), h('div', { class: 'range-row' }, pressureRange, pressureText)),
      h('p', { class: 'muted' }, '在左侧画布按住左键拖动即可切削，松开自动记录为一笔'),
      h('div', { class: 'row' }, undo, clear)
    )
  )
}

function buildReplayCard(viewer: ViewerHandle): HTMLElement {
  const project = store.current!
  const strokeCount = h('span', { class: 'value-hint' }, `共 ${project.strokes.length} 笔`)
  const stepText = h('span', { class: 'value-hint' }, '当前 0 笔')
  let playback = 0

  // 回放用独立 Simulation，避免破坏实时推演状态
  function replaySim(): Simulation {
    const p = store.current!
    const mode = domainModeFor(p.body.shape)
    const grid = new DomainGrid(mode, p.body.diameter / 2, p.body.width, p.body.depth)
    return new Simulation(grid, p.body, p.bump, p.layers)
  }

  function applyToStep(step: number): void {
    const sim = replaySim()
    const sorted = [...project.strokes].sort((a, b) => a.order - b.order).slice(0, step)
    sim.rebuild(sorted)
    const renderer = viewer.renderer()
    renderer?.uploadGrind(sim.ground, sim.remaining)
    stepText.textContent = `当前 ${step} 笔`
  }

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = String(project.strokes.length)
  slider.step = '1'
  slider.value = '0'
  slider.addEventListener('input', () => {
    if (playback) {
      window.clearInterval(playback)
      playback = 0
    }
    applyToStep(Number(slider.value))
  })

  const play = h('button', { class: 'btn' }, h('span', { html: iconSvg('play') }), '逐步回放')
  play.addEventListener('click', () => {
    if (playback) window.clearInterval(playback)
    let step = Number(slider.value)
    playback = window.setInterval(() => {
      step++
      if (step > project.strokes.length) {
        window.clearInterval(playback)
        playback = 0
        return
      }
      slider.value = String(step)
      applyToStep(step)
    }, 700)
  })

  const backLive = h('button', { class: 'btn' }, h('span', { html: iconSvg('reset') }), '回到实时态')
  backLive.addEventListener('click', () => {
    if (playback) window.clearInterval(playback)
    const sim = store.ensureSimulation()
    if (sim) viewer.renderer()?.uploadGrind(sim.ground, sim.remaining)
    slider.value = String(project.strokes.length)
    stepText.textContent = `当前 ${project.strokes.length} 笔`
  })

  // 定位"磨乱的刀"：找到第一笔导致磨穿的记录
  const locate = h('button', { class: 'btn' }, '定位磨穿首笔')
  locate.addEventListener('click', () => {
    const sim = replaySim()
    const sorted = [...project.strokes].sort((a, b) => a.order - b.order)
    let found = -1
    for (let q = 0; q < sorted.length; q++) {
      sim.applyStroke(sorted[q])
      if (sim.breachRatio() > 0) {
        found = q + 1
        break
      }
    }
    if (found < 0) {
      toast('目前没有任何一笔造成磨穿')
      return
    }
    slider.value = String(found)
    applyToStep(found)
    toast(`第 ${found} 笔首次磨穿胎体，已定位到该步骤`, 'error')
  })

  // 确定性自检：两次独立重建，校验和必须相同
  const check = h('button', { class: 'btn' }, h('span', { html: iconSvg('check') }), '一致性自检')
  check.addEventListener('click', () => {
    const a = replaySim()
    const b = replaySim()
    a.rebuild([...project.strokes])
    b.rebuild([...project.strokes].map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })))
    const same = a.checksum() === b.checksum()
    if (same) toast(`两次推演校验和一致：${a.checksum()}`)
    else toast('校验和不一致，推演存在不确定性', 'error')
  })

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, '打磨回放'), strokeCount),
    h(
      'div',
      { class: 'card-body col' },
      slider,
      h('div', { class: 'row between' }, stepText),
      h('div', { class: 'row wrap' }, play, backLive, locate, check)
    )
  )
}

function buildFinishCard(viewer: ViewerHandle): HTMLElement {
  const project = store.current!
  const polishBtn = h('button', { class: project.polished ? 'btn primary' : 'btn' }, project.polished ? '推光已完成（点击撤销）' : '完成推光')
  polishBtn.addEventListener('click', async () => {
    await store.save((p) => {
      p.polished = !p.polished
    })
    const renderer = viewer.renderer()
    if (renderer) renderer.polished = store.current!.polished
    polishBtn.classList.toggle('primary', store.current!.polished)
    polishBtn.textContent = store.current!.polished ? '推光已完成（点击撤销）' : '完成推光'
  })

  const sim = store.ensureSimulation()
  const stats = sim
    ? h(
        'div',
        { class: 'col' },
        h('div', { class: 'metric-row' }, h('span', { class: 'metric-name' }, '磨穿面积'), h('span', { class: 'metric-value danger-text' }, `${(sim.breachRatio() * 100).toFixed(2)}%`)),
        h('div', { class: 'metric-row' }, h('span', { class: 'metric-name' }, '薄漆预警'), h('span', { class: 'metric-value' }, `${(sim.thinRatio() * 100).toFixed(1)}%`))
      )
    : null

  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, '推光与质检')),
    h('div', { class: 'card-body col' }, polishBtn, stats, h('p', { class: 'muted' }, '推光后漆面高光增强，可在画布顶部切换三种灯光观察'))
  )
}

function rebuildAll(viewer: ViewerHandle): void {
  store.invalidate()
  const sim = store.ensureSimulation()
  if (sim) viewer.renderer()?.uploadGrind(sim.ground, sim.remaining)
}
