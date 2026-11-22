// 全局状态：当前作品、派生 Simulation、持久化
import { projectRepo } from '../sim/db.ts'
import { presetProjects } from '../sim/presets.ts'
import { DomainGrid } from '../sim/grid.ts'
import { Simulation } from '../sim/grind.ts'
import { domainModeFor } from '../sim/body.ts'
import type { Project } from '../sim/types.ts'

type Listener = () => void

class AppStore {
  projects: Project[] = []
  current: Project | null = null
  simulation: Simulation | null = null
  simSignature = ''
  private listeners = new Set<Listener>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn())
  }

  async init(): Promise<void> {
    this.projects = await projectRepo.list()
    if (this.projects.length === 0) {
      const presets = presetProjects()
      for (const p of presets) await projectRepo.put(p)
      this.projects = await projectRepo.list()
    }
    this.emit()
  }

  async createProject(): Promise<Project> {
    const now = Date.now()
    const project: Project = {
      id: now.toString(36),
      name: `新作品 ${this.projects.length + 1}`,
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
        seed: now % 100000,
        variation: 0.35
      },
      layers: [],
      strokes: [],
      polished: false,
      light: 'studio'
    }
    await projectRepo.put(project)
    this.projects = await projectRepo.list()
    this.emit()
    return project
  }

  async deleteProject(id: string): Promise<void> {
    await projectRepo.remove(id)
    if (this.current?.id === id) {
      this.current = null
      this.simulation = null
    }
    this.projects = await projectRepo.list()
    this.emit()
  }

  async selectProject(id: string): Promise<Project | null> {
    const project = await projectRepo.get(id)
    this.current = project ?? null
    this.simulation = null
    this.simSignature = ''
    this.emit()
    return this.current
  }

  // 保存并重建派生推演（参数变化时）
  async save(mutate?: (p: Project) => void): Promise<void> {
    if (!this.current) return
    if (mutate) mutate(this.current)
    await projectRepo.put(this.current)
    this.projects = await projectRepo.list()
    this.emit()
  }

  // 获取/重建 Simulation；签名包含所有影响几何与漆层的参数
  ensureSimulation(): Simulation | null {
    const p = this.current
    if (!p) return null
    const signature = JSON.stringify([
      p.body, p.bump,
      p.layers.map((l) => [l.color, l.thickness, l.shrinkage, l.flow])
    ])
    if (this.simulation && signature === this.simSignature) return this.simulation

    const mode = domainModeFor(p.body.shape)
    const radius = p.body.diameter / 2
    const grid = new DomainGrid(mode, radius, p.body.width, p.body.depth)
    this.simulation = new Simulation(grid, p.body, p.bump, p.layers)
    this.simulation.rebuild(p.strokes)
    this.simSignature = signature
    return this.simulation
  }

  // 打磨记录变化：增量同步并持久化
  async syncStrokes(): Promise<void> {
    if (!this.current || !this.simulation) return
    this.simulation.syncStrokes(this.current.strokes)
    await projectRepo.put(this.current)
    this.emit()
  }

  // 结构性参数变化后强制重建
  invalidate(): void {
    this.simSignature = ''
    this.simulation = null
  }
}

export const store = new AppStore()
