// 共享 3D 工作台：承载渲染器、相机、打磨交互与帧循环
import { h, mount } from './dom.ts'
import { LacquerRenderer } from '../gl/renderer.ts'
import { OrbitControls } from '../gl/orbit.ts'
import { store } from '../state/store.ts'
import { TOOL_PARAMS } from '../sim/grind.ts'
import { modeLabel, lightLabel } from '../gl/shaders.ts'
import type { GrindStroke, LightPreset, RenderMode, StrokePoint, ToolType } from '../sim/types.ts'
import { uid } from '../sim/rng.ts'
import { toast } from './dom.ts'

export interface ViewerHandle {
  host: HTMLElement
  refresh: () => void
  setMode: (mode: RenderMode) => void
  setLight: (light: LightPreset) => void
  setGrindMode: (on: boolean) => void
  renderer: () => LacquerRenderer | null
}

export function createStudioViewer(): ViewerHandle {
  const canvas = document.createElement('canvas')
  const status = h('div', { class: 'viewer-status' }, '初始化中…')
  const toolbar = h('div', { class: 'viewer-toolbar' })
  const host = h('div', { class: 'canvas-host' }, toolbar, canvas, status)

  let renderer: LacquerRenderer | null = null
  let controls: OrbitControls | null = null
  let raf = 0
  let activeStroke: GrindStroke | null = null
  let tool: ToolType = 'medium'
  let pressure = 0.6
  // 打磨模式状态独立保存，controls 延迟创建时同步过去
  let grindActive = false

  const modeButtons: Array<{ mode: RenderMode; label: string }> = [
    { mode: 'craft', label: modeLabel('craft') },
    { mode: 'layer', label: modeLabel('layer') },
    { mode: 'grind', label: modeLabel('grind') },
    { mode: 'heat', label: modeLabel('heat') }
  ]

  function rebuild(): void {
    const project = store.current
    if (!project) {
      status.textContent = '请先选择作品'
      return
    }
    const sim = store.ensureSimulation()
    if (!sim) return
    if (!renderer) {
      renderer = LacquerRenderer.create(canvas, sim.grid)
      controls = new OrbitControls(canvas, renderer.camera, sim.grid)
      controls.grindMode = grindActive
      controls.onGrindStart = startStroke
      controls.onGrindPoint = addPoint
      controls.onGrindEnd = endStroke
      loop()
    }
    renderer.setLayerCount(project.layers.length)
    renderer.uploadStatic(
      sim.bodyHeight,
      sim.originalSurface,
      sim.layerThickness,
      project.layers,
      project.body.wallThickness
    )
    renderer.uploadGrind(sim.ground, sim.remaining)
    renderer.light = project.light
    updateStatus()
  }

  function updateStatus(): void {
    const sim = store.simulation
    const project = store.current
    if (!sim || !project) return
    const breach = (sim.breachRatio() * 100).toFixed(2)
    const thin = (sim.thinRatio() * 100).toFixed(1)
    status.textContent = `磨穿 ${breach}% · 薄漆预警 ${thin}% · 打磨记录 ${project.strokes.length} 笔`
  }

  function loop(): void {
    renderer?.draw()
    raf = requestAnimationFrame(loop)
  }

  function startStroke(): void {
    const project = store.current
    if (!project) return
    const params = TOOL_PARAMS[tool]
    activeStroke = {
      id: uid(),
      tool,
      radius: params.radius,
      pressure,
      cutRate: params.cutRate,
      points: [],
      order: project.strokes.length
    }
  }

  function addPoint(p: StrokePoint): void {
    if (!activeStroke) return
    const last = activeStroke.points[activeStroke.points.length - 1]
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.004) return
    activeStroke.points.push(p)
    const project = store.current
    const sim = store.simulation
    if (!project || !sim) return
    // 实时切削：临时挂到 store 上做增量推演，松手时落库
    sim.syncStrokes([...project.strokes, activeStroke])
    renderer?.uploadGrind(sim.ground, sim.remaining)
    updateStatus()
  }

  async function endStroke(): Promise<void> {
    const project = store.current
    if (!project || !activeStroke) return
    if (activeStroke.points.length > 0) {
      project.strokes.push(activeStroke)
      await store.syncStrokes()
      const sim = store.ensureSimulation()
      if (sim && renderer) renderer.uploadGrind(sim.ground, sim.remaining)
      toast(`已记录第 ${project.strokes.length} 笔打磨`)
    }
    activeStroke = null
    updateStatus()
  }

  // 工具栏：渲染模式
  const modeSeg = h('div', { class: 'segmented' })
  for (const item of modeButtons) {
    const btn = h('button', { type: 'button' }, item.label)
    btn.addEventListener('click', () => {
      if (!renderer) return
      renderer.renderMode = item.mode
      modeSeg.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
    })
    if (item.mode === 'craft') btn.classList.add('active')
    modeSeg.append(btn)
  }

  // 灯光切换
  const lightSeg = h('div', { class: 'segmented' })
  const lights: LightPreset[] = ['studio', 'warm', 'daylight']
  for (const l of lights) {
    const btn = h('button', { type: 'button' }, lightLabel(l))
    btn.addEventListener('click', async () => {
      if (!renderer) return
      renderer.light = l
      lightSeg.querySelectorAll('button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      await store.save((p) => {
        p.light = l
      })
    })
    lightSeg.append(btn)
  }

  const grindToggle = h('button', { class: 'btn' }, '视角旋转')
  const applyGrindUI = (on: boolean): void => {
    grindActive = on
    if (controls) controls.grindMode = on
    grindToggle.dataset.on = on ? '1' : '0'
    grindToggle.textContent = on ? '打磨中（左键切削）' : '视角旋转'
    grindToggle.classList.toggle('primary', on)
  }
  grindToggle.addEventListener('click', () => {
    applyGrindUI(grindToggle.dataset.on !== '1')
  })

  toolbar.append(modeSeg, lightSeg, grindToggle)

  const handle: ViewerHandle = {
    host,
    refresh: rebuild,
    setMode(mode) {
      if (!renderer) return
      renderer.renderMode = mode
    },
    setLight(light) {
      if (!renderer) return
      renderer.light = light
    },
    setGrindMode(on) {
      applyGrindUI(on)
    },
    renderer: () => renderer
  }

  // 磨具参数由外部页面通过这两个函数注入
  ;(host as unknown as { setTool: (t: ToolType) => void }).setTool = (t) => {
    tool = t
  }
  ;(host as unknown as { setPressure: (v: number) => void }).setPressure = (v) => {
    pressure = v
  }

  void mount
  void raf
  return handle
}
