// 轨道相机控制 + 参数域拾取：左键在打磨模式下切削，其余情况旋转视角
import type { CameraState } from './renderer.ts'
import type { DomainGrid } from '../sim/grid.ts'
import type { StrokePoint } from '../sim/types.ts'

export class OrbitControls {
  private dragging = false
  private lastX = 0
  private lastY = 0
  // 视角旋转与打磨切削的切换由外部决定
  grindMode = false
  onGrindPoint: ((p: StrokePoint) => void) | null = null
  onGrindStart: (() => void) | null = null
  onGrindEnd: (() => void) | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: CameraState,
    private grid: DomainGrid
  ) {
    canvas.addEventListener('pointerdown', this.handleDown)
    window.addEventListener('pointermove', this.handleMove)
    window.addEventListener('pointerup', this.handleUp)
    canvas.addEventListener('wheel', this.handleWheel, { passive: false })
    canvas.addEventListener('contextmenu', this.preventMenu)
  }

  private preventMenu = (e: Event): void => e.preventDefault()

  private handleDown = (e: PointerEvent): void => {
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (this.grindMode && e.button === 0) {
      this.canvas.setPointerCapture?.(e.pointerId)
      this.onGrindStart?.()
      this.emitPoint(e)
    }
  }

  private handleMove = (e: PointerEvent): void => {
    if (!this.dragging) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY

    if (this.grindMode && e.buttons === 1) {
      this.emitPoint(e)
      return
    }
    this.camera.yaw += dx * 0.006
    this.camera.pitch = Math.min(1.45, Math.max(0.08, this.camera.pitch + dy * 0.006))
  }

  private handleUp = (e: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    if (this.grindMode) this.onGrindEnd?.()
    void e
  }

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const factor = Math.exp(e.deltaY * 0.001)
    this.camera.distance = Math.min(1400, Math.max(120, this.camera.distance * factor))
  }

  // 屏幕坐标 -> 射线 -> 在胎体平均高度平面求交 -> 参数域 uv
  private emitPoint(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2

    const c = this.camera
    const cp = Math.cos(c.pitch)
    const eye: [number, number, number] = [
      c.distance * cp * Math.sin(c.yaw),
      c.distance * Math.sin(c.pitch) + c.targetY,
      c.distance * cp * Math.cos(c.yaw)
    ]
    // 视线方向：从相机指向目标，再按屏幕 NDC 偏出射线
    const forward = normalize([-eye[0], c.targetY - eye[1], -eye[2]])
    const right = normalize(cross(forward, [0, 1, 0]))
    const up = cross(right, forward)
    const fovScale = Math.tan((45 * Math.PI) / 180 / 2)
    const rayDir = normalize([
      forward[0] + right[0] * ndcX * fovScale + up[0] * ndcY * fovScale,
      forward[1] + right[1] * ndcX * fovScale + up[1] * ndcY * fovScale,
      forward[2] + right[2] * ndcX * fovScale + up[2] * ndcY * fovScale
    ])

    // 与平均高度水平面求交
    const planeY = c.targetY
    if (Math.abs(rayDir[1]) < 1e-6) return
    const t = (planeY - eye[1]) / rayDir[1]
    if (t <= 0) return
    const hitX = eye[0] + rayDir[0] * t
    const hitZ = eye[2] + rayDir[2] * t
    const [u, v] = this.grid.uvFromXY(hitX, hitZ)
    this.onGrindPoint?.({ x: u, y: v })
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handleDown)
    window.removeEventListener('pointermove', this.handleMove)
    window.removeEventListener('pointerup', this.handleUp)
    this.canvas.removeEventListener('wheel', this.handleWheel)
    this.canvas.removeEventListener('contextmenu', this.preventMenu)
  }
}

function normalize(a: number[]): [number, number, number] {
  const len = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / len, a[1] / len, a[2] / len]
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}
