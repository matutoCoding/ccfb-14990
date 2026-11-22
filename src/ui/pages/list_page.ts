// 作品列表页：按订单管理，卡片式入口
import { h, toast } from '../dom.ts'
import { icons, iconSvg } from '../icons.ts'
import { navigate } from '../../state/router.ts'
import { store } from '../../state/store.ts'
import type { Project } from '../../sim/types.ts'

export function renderListPage(): HTMLElement {
  const grid = h('div', { class: 'project-grid' })

  if (store.projects.length === 0) {
    grid.append(
      h(
        'div',
        { class: 'empty-state card' },
        h('span', { class: 'empty-icon', html: iconSvg('empty') }),
        h('div', { class: 'empty-title' }, '还没有任何作品档案'),
        h('div', { class: 'empty-sub' }, '新建一件作品，从胎体起底开始整套犀皮漆推演')
      )
    )
  }

  for (const project of store.projects) {
    grid.append(projectCard(project))
  }

  const createBtn = h('button', { class: 'btn primary' }, h('span', { html: iconSvg('plus') }), '新建作品')
  createBtn.addEventListener('click', async () => {
    const p = await store.createProject()
    toast(`已创建「${p.name}」`)
    navigate('#/body')
  })

  return h('div', { class: 'page-body' }, h('div', { class: 'row between' }, h('h2', {}, '作品列表'), createBtn), grid)
}

function projectCard(project: Project): HTMLElement {
  const layerNames = project.layers.map((l) => l.name).join('、') || '尚未髹漆'
  const shapeLabel: Record<string, string> = {
    disk: '圆盘',
    box: '方盒',
    bowl: '茶碗',
    obj: '导入模型'
  }

  const open = h('button', { class: 'btn sm primary' }, '进入工作台')
  open.addEventListener('click', async () => {
    await store.selectProject(project.id)
    navigate('#/body')
  })

  const del = h('button', { class: 'btn sm danger' }, h('span', { html: iconSvg('trash') }), '删除')
  del.addEventListener('click', async () => {
    if (!window.confirm(`确认删除「${project.name}」？该操作不可恢复`)) return
    await store.deleteProject(project.id)
    toast('作品已删除')
  })

  return h(
    'div',
    { class: 'card project-card' },
    h('div', { class: 'thumb', html: iconSvg('body') }),
    h(
      'div',
      { class: 'meta' },
      h('h3', {}, project.name),
      h('span', { class: 'tag' }, shapeLabel[project.body.shape] ?? '胎体'),
      h('span', { class: 'muted' }, `客户：${project.customer || '未填写'}`),
      h('span', { class: 'muted' }, `漆层 ${project.layers.length} 层 · 打磨 ${project.strokes.length} 笔`),
      h('span', { class: 'muted', title: layerNames }, layerNames),
      h('div', { class: 'row', style: 'margin-top:var(--sp-3)' }, open, del)
    )
  )
}

void icons
