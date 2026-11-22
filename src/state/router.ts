// hash 路由：#/list、#/body、#/layers、#/grind、#/compare、#/sheet
import type { PageRoute } from './routes.ts'

const ROUTES: PageRoute[] = [
  { hash: '#/list', key: 'list' },
  { hash: '#/body', key: 'body' },
  { hash: '#/layers', key: 'layers' },
  { hash: '#/grind', key: 'grind' },
  { hash: '#/compare', key: 'compare' },
  { hash: '#/sheet', key: 'sheet' }
]

export function currentRoute(): PageRoute['key'] {
  const found = ROUTES.find((r) => location.hash.startsWith(r.hash))
  return found?.key ?? 'list'
}

export function navigate(hash: string): void {
  location.hash = hash
}

export function onRouteChange(fn: () => void): () => void {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

export { ROUTES }
