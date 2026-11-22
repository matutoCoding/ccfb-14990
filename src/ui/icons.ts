// 统一线性图标（1.75 线宽，currentColor 着色），禁止 emoji
const wrap = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

export const icons = {
  list: wrap('<circle cx="12" cy="7" r="3.2"/><path d="M5.5 19c.7-3.4 3.2-5 6.5-5s5.8 1.6 6.5 5"/>'),
  body: wrap('<ellipse cx="12" cy="12" rx="8.5" ry="5"/><ellipse cx="12" cy="12" rx="8.5" ry="2.2"/><path d="M3.5 12v3.2c0 1.7 3.8 3.1 8.5 3.1s8.5-1.4 8.5-3.1V12"/>'),
  layers: wrap('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  grind: wrap('<path d="M4 20 14.5 9.5"/><path d="m13 8 3-3 3 3-3 3"/><path d="M16 5l2.5-2.5a2.1 2.1 0 0 1 3 3L19 8"/>'),
  compare: wrap('<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/><path d="M7 8h.01M17 8h.01"/>'),
  sheet: wrap('<path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v4h4"/><path d="M9 11h6M9 15h6M9 19h4"/>'),
  empty: wrap('<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z"/><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7"/><path d="M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  trash: wrap('<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>'),
  play: wrap('<path d="M7 4.5v15l13-7.5-13-7.5Z"/>'),
  reset: wrap('<path d="M4 12a8 8 0 1 1 2.5 5.8"/><path d="M4 18v-5h5"/>'),
  print: wrap('<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="1.5"/><path d="M7 13h10v8H7v-8Z"/>'),
  upload: wrap('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  check: wrap('<path d="m5 12 4.5 4.5L19 7"/>')
}

export function iconSvg(name: keyof typeof icons): string {
  return icons[name]
}
