import './styles/tokens.css'
import './styles/app.css'
import { h, mount, toast } from './ui/dom.ts'
import { iconSvg, icons } from './ui/icons.ts'
import { currentRoute, navigate, onRouteChange, ROUTES } from './state/router.ts'
import type { PageKey } from './state/routes.ts'
import { store } from './state/store.ts'
import { renderListPage } from './ui/pages/list_page.ts'
import { renderBodyPage } from './ui/pages/body_page.ts'
import { renderLayersPage } from './ui/pages/layers_page.ts'
import { renderGrindPage } from './ui/pages/grind_page.ts'
import { renderComparePage } from './ui/pages/compare_page.ts'
import { renderSheetPage } from './ui/pages/sheet_page.ts'

const PAGE_TITLES: Record<PageKey, string> = {
  list: '作品列表',
  body: '胎体与起底',
  layers: '髹漆层',
  grind: '打磨推演',
  compare: '纹样比对',
  sheet: '工艺单'
}

const NAV_ICONS: Record<PageKey, keyof typeof icons> = {
  list: 'list',
  body: 'body',
  layers: 'layers',
  grind: 'grind',
  compare: 'compare',
  sheet: 'sheet'
}

function renderApp(): void {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return
  const route = currentRoute()

  const navItems = ROUTES.map((r) => {
    const item = h(
      'div',
      {
        class: `nav-item ${route === r.key ? 'active' : ''}`,
        role: 'button'
      },
      h('span', { class: 'nav-icon', html: iconSvg(NAV_ICONS[r.key]) }),
      h('span', {}, PAGE_TITLES[r.key])
    )
    item.addEventListener('click', () => navigate(r.hash))
    return item
  })

  const sidebar = h(
    'aside',
    { class: 'sidebar' },
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand-title' }, '犀皮漆推演台'),
      h('div', { class: 'brand-sub' }, '髹饰工艺数字孪生')
    ),
    ...navItems
  )

  let page: HTMLElement
  try {
    if (route === 'body') page = renderBodyPage()
    else if (route === 'layers') page = renderLayersPage()
    else if (route === 'grind') page = renderGrindPage()
    else if (route === 'compare') page = renderComparePage()
    else if (route === 'sheet') page = renderSheetPage()
    else page = renderListPage()
  } catch (err) {
    console.error(err)
    page = h(
      'div',
      { class: 'page-body' },
      h('div', { class: 'card empty-state' }, h('div', { class: 'empty-title danger-text' }, '页面渲染失败'), h('div', { class: 'empty-sub' }, err instanceof Error ? err.message : String(err)))
    )
  }

  const header = h(
    'header',
    { class: 'page-header' },
    h('h2', {}, PAGE_TITLES[route]),
    h('span', { class: 'muted' }, store.current ? `当前作品：${store.current.name}` : '未选择作品')
  )

  mount(app, h('div', { class: 'app-shell' }, sidebar, h('main', { class: 'main' }, header, page)))
}

async function bootstrap(): Promise<void> {
  try {
    await store.init()
    if (!location.hash) location.hash = '#/list'
    renderApp()
    onRouteChange(renderApp)
    store.subscribe(() => {
      if (currentRoute() === 'list') renderApp()
    })
  } catch (err) {
    console.error(err)
    toast(err instanceof Error ? err.message : '系统初始化失败', 'error')
  }
}

void bootstrap()
