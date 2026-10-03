// viewing insights, like the count distribution of what part of the day you apply, donut charts of application status and work mode, etc.
// all values computed by the backend 
import { barList, columnChart, donut, type Row } from './charts.ts'
import { getInsights, type Insights, type InsightsRange } from './api.ts'

const RANGES: [InsightsRange, string][] = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time'],
]

const STATUS_COLORS: Record<string, string> = {
  submitted: 'var(--status-submitted)',
  callback: 'var(--status-callback)',
  accepted: 'var(--status-accepted)',
  rejected: 'var(--status-rejected)',
}
const WORK_MODE_COLORS: Record<string, string> = {
  Remote: 'var(--series-1)',
  Hybrid: 'var(--series-2)',
  'On-site': 'var(--series-3)',
}

const NOT_DETECTED = 'Not detected' // backend class for applications not classified yet

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1)
const toRows = (items: { label: string; count: number; hours?: string }[], label = (s: string) => s): Row[] =>
  items.map((item) => ({ label: label(item.label), value: item.count, note: item.hours }))

let range: InsightsRange = '30'

export function createInsightsView() {
  const root = document.createElement('div')
  root.className = 'insights'

  const filters = document.createElement('div')
  filters.className = 'range-filter'
  filters.setAttribute('role', 'radiogroup')
  filters.setAttribute('aria-label', 'Date range')
  const buttons = RANGES.map(([key, label]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.setAttribute('role', 'radio')
    button.addEventListener('click', () => {
      range = key
      refresh()
    })
    filters.append(button)
    return [key, button] as const
  })

  const body = document.createElement('div')
  body.className = 'insights-body'
  root.append(filters, body)

  async function refresh() {
    for (const [key, button] of buttons) button.setAttribute('aria-checked', String(key === range))
    //  the previous charts are visible but dimmed while loading
    body.classList.add('loading')
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      render(body, await getInsights(range, tz))
    } catch (err) {
      const message = document.createElement('p')
      message.className = 'error'
      message.textContent = `Couldn't load insights: ${(err as Error).message}`
      body.replaceChildren(message)
    } finally {
      body.classList.remove('loading')
    }
  }

  return { root, refresh }
}

function render(body: HTMLElement, data: Insights) {
  const { totals } = data
  if (totals.all_time === 0) {
    const empty = document.createElement('p')
    empty.className = 'viewer-message'
    empty.textContent = 'No applications yet. Add one and your charts will show up here.'
    body.replaceChildren(empty)
    return
  }

  const kpis = document.createElement('div')
  kpis.className = 'kpis'
  kpis.append(
    statTile('Applications', String(totals.in_range), `${totals.all_time} all time`),
    statTile('Responses', String(totals.responses), 'callbacks and offers'),
    statTile(
      'Response rate',
      totals.response_rate === null ? '–' : `${Math.round(totals.response_rate * 100)}%`,
      'of applications in this range',
    ),
  )

  const perDay = toRows(data.per_day.map((d) => ({ label: d.date, count: d.count })))
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const dayRows = perDay.map((row) => ({ ...row, label: shortDate(row.label) }))

  const grid = document.createElement('div')
  grid.className = 'chart-grid'
  grid.append(
    card('Applications per day', 'How many you applied to each day', 'wide', (el) =>
      columnChart(el, dayRows),
    ),
    card('When you apply', 'By time of day, in your time zone', '', (el) =>
      columnChart(el, toRows(data.time_of_day)),
    ),
    card('Status', 'Where your applications stand', '', (el) =>
      donut(el, toRows(data.by_status, capitalize), {
        Submitted: STATUS_COLORS.submitted,
        Callback: STATUS_COLORS.callback,
        Accepted: STATUS_COLORS.accepted,
        Rejected: STATUS_COLORS.rejected,
      }),
    ),
    card('Work mode', 'Remote, hybrid, or on-site', '', (el) =>
      donut(el, toRows(data.by_work_mode), WORK_MODE_COLORS),
    ),
    card('Field', 'The kind of work, most common first', '', (el) =>
      barList(el, toRows(data.by_field), [NOT_DETECTED]),
    ),
    card('Level', 'Seniority of the roles', '', (el) =>
      barList(el, toRows(data.by_level), [NOT_DETECTED]),
    ),
  )
  body.replaceChildren(kpis, grid)
}

function statTile(label: string, value: string, note: string) {
  const tile = document.createElement('div')
  tile.className = 'stat-tile'
  const l = document.createElement('span')
  l.className = 'stat-label'
  l.textContent = label
  const v = document.createElement('strong')
  v.className = 'stat-value'
  v.textContent = value
  const n = document.createElement('small')
  n.textContent = note
  tile.append(l, v, n)
  return tile
}

function card(title: string, subtitle: string, size: string, draw: (el: HTMLElement) => void) {
  const section = document.createElement('section')
  section.className = `chart-card ${size}`
  const h = document.createElement('h3')
  h.textContent = title
  const sub = document.createElement('p')
  sub.className = 'chart-subtitle'
  sub.textContent = subtitle
  const plot = document.createElement('div')
  plot.className = 'chart-plot'
  section.append(h, sub, plot)
  requestAnimationFrame(() => draw(plot))
  return section
}
