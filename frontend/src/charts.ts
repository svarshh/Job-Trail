// charts for the Insights view: columns, horizontal bars, and donuts.
// labels from backend
// values are shown on the chart itself (legends, bar ends, column tops) wherever they fit.

export interface Row {
  label: string
  value: number
  note?: string
}

const SVG = 'http://www.w3.org/2000/svg'

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const el = document.createElementNS(SVG, tag)
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value))
  return el
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const plural = (n: number) => `${n} application${n === 1 ? '' : 's'}`

// One shared tooltip: value first (it's what the reader wants), label second.
const tooltip = el('div', 'chart-tooltip')
tooltip.hidden = true
document.body.append(tooltip)

function showTooltip(target: Element, value: string, label: string) {
  tooltip.replaceChildren(el('strong', '', value), el('span', '', label))
  tooltip.hidden = false
  const box = target.getBoundingClientRect()
  const tip = tooltip.getBoundingClientRect()
  const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8)
  tooltip.style.left = `${left + window.scrollX}px`
  tooltip.style.top = `${box.top + window.scrollY - tip.height - 8}px`
}

function hideTooltip() {
  tooltip.hidden = true
}

// Hover and keyboard focus show the same tooltip.
function withTooltip(target: Element, value: string, label: string) {
  target.setAttribute('tabindex', '0')
  target.setAttribute('aria-label', `${label}: ${value}`)
  target.addEventListener('pointerenter', () => showTooltip(target, value, label))
  target.addEventListener('focus', () => showTooltip(target, value, label))
  target.addEventListener('pointerleave', hideTooltip)
  target.addEventListener('blur', hideTooltip)
}

// A rect with only its top corners rounded (4px), square at the baseline.
function columnPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height)
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
}

// Clean axis maximum and ticks (1, 2, 5 × 10ⁿ steps), at least 1 so an empty chart still has a scale.
function niceTicks(max: number, count = 4) {
  const rough = Math.max(1, max) / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!
  const top = Math.max(step, Math.ceil(max / step) * step)
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
}

const MAX_LABELLED_COLUMNS = 12 // up to this many columns, each shows its count on top
const MIN_LABEL_SPACING = 56 // px per x-axis label, so neighbouring labels never touch

/** Vertical columns over time or ordered buckets, sized to the container and redrawn on resize.
 *  X labels are thinned out to whatever fits the current width; the last one is always shown. */
export function columnChart(container: HTMLElement, rows: Row[]) {
  const draw = () => {
    const width = container.clientWidth || 600
    const height = 200
    const pad = { top: 12, right: 8, bottom: 28, left: 32 }
    const plotW = width - pad.left - pad.right
    const plotH = height - pad.top - pad.bottom
    const ticks = niceTicks(Math.max(...rows.map((row) => row.value), 0))
    const top = ticks[ticks.length - 1]
    const band = plotW / Math.max(rows.length, 1)
    const barW = Math.max(2, Math.min(24, band - 2)) // capped at 24px, with a 2px gap between neighbours
    const every = Math.max(1, Math.ceil(MIN_LABEL_SPACING / band))
    const last = rows.length - 1
    // Every nth label, skipping any that would crowd the always-shown last one.
    const showLabel = (i: number) => i === last || (i % every === 0 && last - i >= every)

    const svg = svgEl('svg', { width, height, role: 'img', class: 'chart-svg' })
    for (const tick of ticks) {
      const y = pad.top + plotH - (tick / top) * plotH
      svg.append(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: tick ? 'grid' : 'axis' }))
      const label = svgEl('text', { x: pad.left - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' })
      label.textContent = String(tick)
      svg.append(label)
    }
    rows.forEach((row, i) => {
      const x = pad.left + i * band + (band - barW) / 2
      const h = (row.value / top) * plotH
      if (h > 0) {
        svg.append(svgEl('path', { d: columnPath(x, pad.top + plotH - h, barW, h), class: 'mark' }))
      }
      // With only a few columns, print each count on top; with many it would be clutter.
      if (rows.length <= MAX_LABELLED_COLUMNS && row.value > 0) {
        const value = svgEl('text', { x: x + barW / 2, y: pad.top + plotH - h - 5, 'text-anchor': 'middle', class: 'value' })
        value.textContent = String(row.value)
        svg.append(value)
      }
      // The hit area is the whole band, full height: much easier to hover than a thin bar.
      const hit = svgEl('rect', { x: pad.left + i * band, y: pad.top, width: band, height: plotH, class: 'hit' })
      withTooltip(hit, plural(row.value), row.note ? `${row.label} · ${row.note}` : row.label)
      svg.append(hit)
      if (showLabel(i)) {
        const text = svgEl('text', { x: pad.left + i * band + band / 2, y: height - 8, 'text-anchor': 'middle', class: 'tick' })
        text.textContent = row.label
        svg.append(text)
      }
    })
    container.replaceChildren(svg)
  }
  draw()
  new ResizeObserver(draw).observe(container)
}

/** Horizontal bars for categories, value at the tip. Good for many or long-named categories.
 *  Labels in `muted` (e.g. "Not detected") get a grey bar, so they don't read as real data. */
export function barList(container: HTMLElement, rows: Row[], muted: string[] = []) {
  const max = Math.max(...rows.map((row) => row.value), 1)
  const list = el('div', 'bar-list')
  for (const row of rows) {
    const line = el('div', 'bar-row')
    const track = el('div', 'bar-track')
    const bar = el('div', muted.includes(row.label) ? 'bar muted' : 'bar')
    bar.style.width = `${(row.value / max) * 100}%`
    bar.hidden = row.value === 0 // no sliver for zero; the 0 at the tip says it
    track.append(bar)
    withTooltip(line, plural(row.value), row.label)
    line.append(el('span', 'bar-label', row.label), track, el('span', 'bar-value', String(row.value)))
    list.append(line)
  }
  container.replaceChildren(list)
}

/** Part-to-whole for a few categories, with a legend that names every slice and its count. */
export function donut(container: HTMLElement, rows: Row[], colors: Record<string, string>) {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const size = 150
  const radius = 56 // ring centre line; outer edge = radius + thickness / 2 = 73, inside the 150px box
  const thickness = 34
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', class: 'chart-svg donut' })
  const center = size / 2

  if (total === 0) {
    svg.append(svgEl('circle', { cx: center, cy: center, r: radius, class: 'donut-empty', 'stroke-width': thickness }))
  } else {
    let angle = -Math.PI / 2
    for (const row of rows.filter((r) => r.value > 0)) {
      const sweep = (row.value / total) * Math.PI * 2
      const slice = svgEl('path', {
        d: arcPath(center, radius, thickness, angle, angle + sweep, rows.filter((r) => r.value > 0).length > 1),
        fill: colors[row.label] ?? 'var(--series-muted)',
        class: 'slice',
      })
      withTooltip(slice, plural(row.value), `${row.label} · ${Math.round((row.value / total) * 100)}%`)
      svg.append(slice)
      angle += sweep
    }
  }
  const middle = svgEl('text', { x: center, y: center + 6, 'text-anchor': 'middle', class: 'donut-total' })
  middle.textContent = String(total)
  svg.append(middle)

  const legend = el('ul', 'legend')
  for (const row of rows) {
    const item = el('li')
    const swatch = el('span', 'swatch')
    swatch.style.background = colors[row.label] ?? 'var(--series-muted)'
    const percent = total ? ` (${Math.round((row.value / total) * 100)}%)` : ''
    item.append(swatch, el('span', '', row.label), el('span', 'legend-value', `${row.value}${percent}`))
    legend.append(item)
  }
  const wrap = el('div', 'donut-wrap')
  wrap.append(svg, legend)
  container.replaceChildren(wrap)
}

// A ring segment, with a 2px gap at each end so neighbouring slices read as separate.
function arcPath(c: number, r: number, thickness: number, start: number, end: number, gap: boolean): string {
  const inner = r - thickness / 2
  const outer = r + thickness / 2
  const trim = gap ? Math.min(1 / outer, (end - start) / 4) : 0 // ~1px each side at the outer edge
  const a0 = start + trim
  const a1 = end - trim
  if (a1 - a0 >= Math.PI * 2 - 0.001) {
    // A full ring can't be drawn as one arc; use two halves.
    return arcPath(c, r, thickness, start, start + Math.PI, false) + arcPath(c, r, thickness, start + Math.PI, end, false)
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  const point = (radius: number, a: number) => `${c + radius * Math.cos(a)},${c + radius * Math.sin(a)}`
  return `M${point(outer, a0)} A${outer},${outer} 0 ${large} 1 ${point(outer, a1)} L${point(inner, a1)} A${inner},${inner} 0 ${large} 0 ${point(inner, a0)} Z`
}
