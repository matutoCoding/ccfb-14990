export type PageKey = 'list' | 'body' | 'layers' | 'grind' | 'compare' | 'sheet'

export interface PageRoute {
  hash: string
  key: PageKey
}
