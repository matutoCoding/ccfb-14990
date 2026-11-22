// 极简 DOM 构建工具，避免引入框架
export type NodeLike = Node | string | number | false | null | undefined

export function h(
  tag: string,
  props: Record<string, unknown> = {},
  ...children: NodeLike[]
): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') {
      el.className = String(value)
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value)
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (key === 'html') {
      el.innerHTML = String(value)
    } else {
      el.setAttribute(key, String(value))
    }
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

export function clear(el: HTMLElement): void {
  el.replaceChildren()
}

export function mount(el: HTMLElement, ...nodes: NodeLike[]): void {
  el.replaceChildren()
  for (const node of nodes) {
    if (node === false || node === null || node === undefined) continue
    el.append(node instanceof Node ? node : document.createTextNode(String(node)))
  }
}

export function field(
  label: string,
  control: HTMLElement,
  hint?: string
): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), control, hint ? h('span', { class: 'value-hint' }, hint) : null)
}

export function rangeInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void
): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.addEventListener('input', () => onInput(Number(input.value)))
  return input
}

export function numberInput(value: number, onInput: (v: number) => void): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(value)
  input.addEventListener('change', () => onInput(Number(input.value)))
  return input
}

export function textInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  input.addEventListener('input', () => onInput(input.value))
  return input
}

export function selectInput<T extends string>(
  value: T,
  options: Array<{ value: T; label: string }>,
  onChange: (v: T) => void
): HTMLSelectElement {
  const select = document.createElement('select')
  for (const opt of options) {
    const o = document.createElement('option')
    o.value = opt.value
    o.textContent = opt.label
    if (opt.value === value) o.selected = true
    select.append(o)
  }
  select.addEventListener('change', () => onChange(select.value as T))
  return select
}

export function colorInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'color'
  input.value = value
  input.addEventListener('input', () => onChange(input.value))
  return input
}

export function toast(message: string, type: 'info' | 'error' = 'info'): void {
  let host = document.querySelector<HTMLDivElement>('.toast-host')
  if (!host) {
    host = document.createElement('div')
    host.className = 'toast-host'
    document.body.append(host)
  }
  const item = document.createElement('div')
  item.className = `toast ${type === 'error' ? 'error' : ''}`
  item.textContent = message
  host.append(item)
  window.setTimeout(() => item.remove(), 3200)
}
