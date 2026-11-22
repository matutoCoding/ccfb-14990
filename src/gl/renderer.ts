// WebGL2 渲染器：高度场纹理驱动的位移表面，打磨只上传 ground 纹理
import { FRAGMENT_SHADER, MAX_LAYERS, VERTEX_SHADER } from './shaders.ts'
import { GRID_N } from '../sim/grid.ts'
import type { DomainGrid } from '../sim/grid.ts'
import type { LacquerLayer, LightPreset, RenderMode } from '../sim/types.ts'
import { THIN_WARN } from '../sim/grind.ts'

function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ]
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('无法创建着色器')
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error('着色器编译失败: ' + log)
  }
  return shader
}

export interface CameraState {
  yaw: number
  pitch: number
  distance: number
  targetY: number
}

export class LacquerRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private skirtVao: WebGLVertexArrayObject | null = null
  private skirtIndexCount = 0
  private indexCount: number
  private textures: Record<'body' | 'ground' | 'surface' | 'remaining', WebGLTexture>
  private layerTex: WebGLTexture
  private uniformLoc: Record<string, WebGLUniformLocation | null> = {}

  renderMode: RenderMode = 'craft'
  light: LightPreset = 'studio'
  polished = false
  camera: CameraState = { yaw: 0.6, pitch: 0.62, distance: 520, targetY: 0 }

  private constructor(canvas: HTMLCanvasElement, private grid: DomainGrid) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
    if (!gl) throw new Error('当前浏览器不支持 WebGL2')
    this.gl = gl

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!program) throw new Error('无法创建着色器程序')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(program))
    }
    this.program = program
    gl.useProgram(program)

    const { vao, indexCount } = this.buildMesh()
    this.vao = vao
    this.indexCount = indexCount

    this.textures = {
      body: this.createFloatTexture(),
      ground: this.createFloatTexture(),
      surface: this.createFloatTexture(),
      remaining: this.createFloatTexture()
    }
    this.layerTex = this.createLayerTexture()
    this.collectUniforms()

    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.clearColor(0.94, 0.95, 0.96, 1)
  }

  static create(canvas: HTMLCanvasElement, grid: DomainGrid): LacquerRenderer {
    return new LacquerRenderer(canvas, grid)
  }

  private collectUniforms(): void {
    const gl = this.gl
    const names = [
      'u_mode', 'u_radius', 'u_width', 'u_depth', 'u_wall', 'u_vertScale', 'u_skirt',
      'u_bodyHeight', 'u_ground', 'u_surface', 'u_layerTex', 'u_remaining',
      'u_layerCount', 'u_renderMode', 'u_polished', 'u_light',
      'u_cameraPos', 'u_viewProj', 'u_thinWarn'
    ]
    for (const name of names) {
      this.uniformLoc[name] = gl.getUniformLocation(this.program, name)
    }
    const colorLoc = gl.getUniformLocation(this.program, 'u_layerColors[0]')
    this.uniformLoc['u_layerColors0'] = colorLoc
  }

  private createFloatTexture(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('纹理创建失败')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, GRID_N, GRID_N, 0, gl.RED, gl.FLOAT, null)
    return tex
  }

  private createLayerTexture(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('层纹理创建失败')
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY, 0, gl.R32F, GRID_N, GRID_N, MAX_LAYERS,
      0, gl.RED, gl.FLOAT, null
    )
    return tex
  }

  private upload2D(tex: WebGLTexture, data: Float32Array): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_N, GRID_N, gl.RED, gl.FLOAT, data)
  }

  // 工作面网格（位移 + 法线全在着色器）；侧壁/底盖走独立世界坐标 VAO
  private buildMesh(): { vao: WebGLVertexArrayObject; indexCount: number } {
    const gl = this.gl
    const n = GRID_N
    const polar = this.grid.mode === 'polar'
    const verts: number[] = []
    const indices: number[] = []

    if (polar) {
      // 极域：i=0 用单一极点顶点，i>=1 正常环；中心扇形单独构建避免退化
      verts.push(0, 0)
      for (let i = 1; i < n; i++) {
        for (let j = 0; j < n; j++) {
          verts.push(i / (n - 1), j / (n - 1))
        }
      }
      const ring = (i: number, j: number): number => 1 + (i - 1) * n + j
      // 中心扇形：极点 0 到第一环 i=1
      for (let j = 0; j < n - 1; j++) {
        indices.push(0, ring(1, j + 1), ring(1, j))
      }
      indices.push(0, ring(1, 0), ring(1, n - 1))
      // 环带
      for (let i = 1; i < n - 1; i++) {
        for (let j = 0; j < n - 1; j++) {
          const a = ring(i, j)
          const b = ring(i + 1, j)
          const c = ring(i + 1, j + 1)
          const d = ring(i, j + 1)
          indices.push(a, b, d, b, c, d)
        }
        const a = ring(i, n - 1)
        const b = ring(i + 1, n - 1)
        const c = ring(i + 1, 0)
        const d = ring(i, 0)
        indices.push(a, b, d, b, c, d)
      }
    } else {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) verts.push(i / (n - 1), j / (n - 1))
      }
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n - 1; j++) {
          const a = i * n + j
          const b = (i + 1) * n + j
          const c = (i + 1) * n + j + 1
          const d = i * n + j + 1
          indices.push(a, b, d, b, c, d)
        }
      }
    }

    const vao = gl.createVertexArray()
    if (!vao) throw new Error('VAO 创建失败')
    gl.bindVertexArray(vao)
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(this.program, 'a_uv')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const skirtPosLoc = gl.getAttribLocation(this.program, 'a_skirtPos')
    gl.disableVertexAttribArray(skirtPosLoc)
    gl.vertexAttrib3f(skirtPosLoc, 0, 0, 0)
    const ibo = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    return { vao, indexCount: indices.length }
  }

  // 侧壁 + 底盖：CPU 直接给世界坐标 xyz + uv，绕开着色器高度场采样
  private buildSkirtMesh(surface: Float32Array, wallThickness: number): void {
    const gl = this.gl
    const n = GRID_N
    const polar = this.grid.mode === 'polar'
    const verts: number[] = []
    const indices: number[] = []

    // 边界环用 (i,j) 对表达，与工作面网格的索引体系解耦
    const boundaryIJ: Array<[number, number]> = []
    if (polar) {
      for (let j = 0; j < n; j++) boundaryIJ.push([n - 1, j])
    } else {
      for (let j = 0; j < n; j++) boundaryIJ.push([0, j])
      for (let i = 1; i < n; i++) boundaryIJ.push([i, n - 1])
      for (let j = n - 2; j >= 0; j--) boundaryIJ.push([n - 1, j])
      for (let i = n - 2; i >= 1; i--) boundaryIJ.push([i, 0])
    }

    const xyAt = (i: number, j: number): [number, number] => this.grid.planarXY(i, j)
    const surfaceAt = (i: number, j: number): number => surface[i * n + j]

    // 极域外缘高度做环形邻域平滑，避免单格突变把侧壁顶点戳出盘面
    const smoothEdge = (j: number): number => {
      if (!polar) return surfaceAt(n - 1, j)
      let sum = 0
      const radius = 2
      for (let d = -radius; d <= radius; d++) {
        const jj = (j + d + n) % n
        sum += surfaceAt(n - 1, jj)
      }
      return sum / (radius * 2 + 1)
    }

    let edgeMin = Infinity
    for (const [, j] of boundaryIJ.slice(0, n)) edgeMin = Math.min(edgeMin, smoothEdge(j))
    if (!polar) {
      for (const [i, j] of boundaryIJ) edgeMin = Math.min(edgeMin, surfaceAt(i, j))
    }

    // 上沿环
    for (const [i, j] of boundaryIJ) {
      const [x, y] = xyAt(i, j)
      const h = polar ? smoothEdge(j) : surfaceAt(i, j)
      verts.push(x, h, y, i / (n - 1), j / (n - 1))
    }
    // 下沿环
    const lowerStart = boundaryIJ.length
    for (const [i, j] of boundaryIJ) {
      const [x, y] = xyAt(i, j)
      verts.push(x, edgeMin - wallThickness, y, i / (n - 1), j / (n - 1))
    }
    // 侧壁
    for (let q = 0; q < boundaryIJ.length; q++) {
      const next = (q + 1) % boundaryIJ.length
      indices.push(q, next, lowerStart + q, next, lowerStart + next, lowerStart + q)
    }

    // 底盖：外环 + 内环（r=12%），两环之间封水平圆面；内环之内留空，被工作面完全遮挡
    const capRingStart = verts.length / 5
    for (const [i, j] of boundaryIJ) {
      const [x, y] = xyAt(i, j)
      verts.push(x, edgeMin - wallThickness, y, i / (n - 1), j / (n - 1))
    }
    const innerStart = verts.length / 5
    const innerRatio = 0.12
    for (const [, j] of boundaryIJ) {
      const theta = (j / n) * Math.PI * 2
      const rr = polar ? this.grid.radius * innerRatio : 0
      const px = polar ? rr * Math.cos(theta) : 0
      const pz = polar ? rr * Math.sin(theta) : 0
      verts.push(px, edgeMin - wallThickness, pz, innerRatio, j / n)
    }
    for (let q = 0; q < boundaryIJ.length; q++) {
      const next = (q + 1) % boundaryIJ.length
      indices.push(capRingStart + q, capRingStart + next, innerStart + q)
      indices.push(capRingStart + next, innerStart + next, innerStart + q)
    }
    // 矩形域补中心扇形封口
    if (!polar) {
      const capCenter = verts.length / 5
      verts.push(0, edgeMin - wallThickness, 0, 0, 0)
      for (let q = 0; q < boundaryIJ.length; q++) {
        const next = (q + 1) % boundaryIJ.length
        indices.push(capCenter, innerStart + next, innerStart + q)
      }
    }
    void polar

    if (this.skirtVao) gl.deleteVertexArray(this.skirtVao)
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('裙边 VAO 创建失败')
    gl.bindVertexArray(vao)
    const vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW)
    const uvLoc = gl.getAttribLocation(this.program, 'a_uv')
    const posLoc = gl.getAttribLocation(this.program, 'a_skirtPos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(uvLoc)
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12)
    const ibo = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
    this.skirtVao = vao
    this.skirtIndexCount = indices.length
  }

  uploadStatic(
    body: Float32Array,
    surface: Float32Array,
    layerThickness: Float32Array[],
    layers: LacquerLayer[],
    wallThickness: number
  ): void {
    const gl = this.gl
    this.upload2D(this.textures.body, body)
    this.upload2D(this.textures.surface, surface)

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layerTex)
    const empty = new Float32Array(GRID_N * GRID_N)
    for (let li = 0; li < MAX_LAYERS; li++) {
      const data = li < layerThickness.length ? layerThickness[li] : empty
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, 0, 0, li, GRID_N, GRID_N, 1,
        gl.RED, gl.FLOAT, data
      )
    }

    gl.useProgram(this.program)
    const colors = new Float32Array(MAX_LAYERS * 3)
    for (let li = 0; li < MAX_LAYERS; li++) {
      const rgb = li < layers.length ? hexToRgb01(layers[li].color) : [0.5, 0.5, 0.5]
      colors.set(rgb, li * 3)
    }
    gl.uniform3fv(this.uniformLoc['u_layerColors0'], colors)
    gl.uniform1f(this.uniformLoc['u_wall'], wallThickness)
    this.buildSkirtMesh(surface, wallThickness)
  }

  // 打磨后增量上传：只传 ground 与 remaining 两张纹理
  uploadGrind(ground: Float32Array, remaining: Float32Array): void {
    this.upload2D(this.textures.ground, ground)
    this.upload2D(this.textures.remaining, remaining)
  }

  private viewProj(): { matrix: Float32Array; cameraPos: [number, number, number] } {
    const c = this.camera
    const cp = Math.cos(c.pitch)
    const eye: [number, number, number] = [
      c.distance * cp * Math.sin(c.yaw),
      c.distance * Math.sin(c.pitch) + c.targetY,
      c.distance * cp * Math.cos(c.yaw)
    ]
    const target: [number, number, number] = [0, c.targetY, 0]
    const up: [number, number, number] = [0, 1, 0]
    const matrix = perspectiveLookAt(eye, target, up)
    return { matrix, cameraPos: eye }
  }

  draw(): void {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    const { matrix, cameraPos } = this.viewProj()
    const u = this.uniformLoc
    gl.uniform1i(u['u_mode'], this.grid.mode === 'polar' ? 0 : 1)
    gl.uniform1f(u['u_radius'], this.grid.radius)
    gl.uniform1f(u['u_width'], this.grid.width)
    gl.uniform1f(u['u_depth'], this.grid.depth)
    // 毫米高度差较小，垂直方向放大便于观察起伏
    gl.uniform1f(u['u_vertScale'], 1)
    gl.uniform1i(u['u_layerCount'], this.boundLayerCount())
    gl.uniform1i(u['u_renderMode'], this.modeIndex())
    gl.uniform1i(u['u_polished'], this.polished ? 1 : 0)
    gl.uniform1i(u['u_light'], this.lightIndex())
    gl.uniform1f(u['u_thinWarn'], THIN_WARN)
    gl.uniform3f(u['u_cameraPos'], cameraPos[0], cameraPos[1], cameraPos[2])
    gl.uniformMatrix4fv(u['u_viewProj'], false, matrix)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.body)
    gl.uniform1i(u['u_bodyHeight'], 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.ground)
    gl.uniform1i(u['u_ground'], 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.surface)
    gl.uniform1i(u['u_surface'], 2)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.layerTex)
    gl.uniform1i(u['u_layerTex'], 3)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, this.textures.remaining)
    gl.uniform1i(u['u_remaining'], 4)

    // 工作面
    gl.uniform1i(u['u_skirt'], 0)
    gl.bindVertexArray(this.vao)
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0)

    // 侧壁与底盖
    if (this.skirtVao && this.skirtIndexCount > 0) {
      gl.uniform1i(u['u_skirt'], 1)
      gl.bindVertexArray(this.skirtVao)
      gl.drawElements(gl.TRIANGLES, this.skirtIndexCount, gl.UNSIGNED_INT, 0)
    }
    gl.bindVertexArray(null)
  }

  private boundLayerCount(): number {
    return Math.min(MAX_LAYERS, Math.max(0, this.layerCountCache))
  }

  private layerCountCache = 0
  setLayerCount(count: number): void {
    this.layerCountCache = count
  }

  private modeIndex(): number {
    return ({ craft: 0, layer: 1, grind: 2, heat: 3 } as const)[this.renderMode]
  }

  private lightIndex(): number {
    return ({ studio: 0, warm: 1, daylight: 2 } as const)[this.light]
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteProgram(this.program)
    Object.values(this.textures).forEach((t) => gl.deleteTexture(t))
    gl.deleteTexture(this.layerTex)
    gl.deleteVertexArray(this.vao)
    if (this.skirtVao) gl.deleteVertexArray(this.skirtVao)
  }
}

// 列主序透视 + lookAt
function perspectiveLookAt(
  eye: [number, number, number],
  target: [number, number, number],
  up: [number, number, number]
): Float32Array {
  const fov = (45 * Math.PI) / 180
  const aspect = 1
  const near = 1
  const far = 4000
  const f = 1 / Math.tan(fov / 2)
  const proj = new Float32Array(16)
  proj[0] = f / aspect
  proj[5] = f
  proj[10] = (far + near) / (near - far)
  proj[11] = -1
  proj[14] = (2 * far * near) / (near - far)

  const z = normalize3(sub3(eye, target))
  const x = normalize3(cross3(up, z))
  const y = cross3(z, x)
  const view = new Float32Array(16)
  view[0] = x[0]; view[1] = y[0]; view[2] = z[0]; view[3] = 0
  view[4] = x[1]; view[5] = y[1]; view[6] = z[1]; view[7] = 0
  view[8] = x[2]; view[9] = y[2]; view[10] = z[2]; view[11] = 0
  view[12] = -dot3(x, eye)
  view[13] = -dot3(y, eye)
  view[14] = -dot3(z, eye)
  view[15] = 1
  return mul4(proj, view)
}

function sub3(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross3(a: number[], b: number[]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}
function normalize3(a: number[]): [number, number, number] {
  const len = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / len, a[1] / len, a[2] / len]
}
function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}
