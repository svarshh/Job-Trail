import './style.css'
import {
  deleteApplication,
  getHistory,
  getHistoryPage,
  getOptions,
  historySnapshotUrl,
  postApplication,
  resumeUrl,
  retryDetails,
  searchApplications,
  STATUSES,
  updateStatus,
  type Details,
  type SavedPage,
  type Status,
  type SavedPageWithText,
} from './api.ts'
import { createInsightsView } from './insights.ts'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header id="topbar">
    <h1>Job Path</h1>
    <nav class="tabs" aria-label="Views">
      <button type="button" class="tab" data-view="add" aria-current="page">Add</button>
      <button type="button" class="tab" data-view="history">My Jobs <span id="history-count" class="tab-count"></span></button>
      <button type="button" class="tab" data-view="insights">Insights</button>
    </nav>
  </header>

  <main>
    <div id="add-view">
    <section>
      <h2>Add an application</h2>
      <form id="link-form" class="stacked">
        <label>
          <span>Link <span class="required" aria-hidden="true">*</span></span>
          <input id="link-url" name="url" type="url" placeholder="https://example.com/job" required />
        </label>
        <label>
          <span>Company <small>optional</small></span>
          <input id="link-company" name="company" type="text" placeholder="Company Inc." />
        </label>
        <div class="field-grid">
          <label>
            <span>Location <small>optional</small></span>
            <input id="link-location" name="location" type="text" placeholder="Auto-detect" />
          </label>
          <label>
            <span>Level</span>
            <select id="link-level" name="level"></select>
          </label>
          <label>
            <span>Field</span>
            <select id="link-field" name="field"></select>
          </label>
          <label>
            <span>Work mode</span>
            <select id="link-work-mode" name="work_mode"></select>
          </label>
        </div>
        <label>
          <span>Status</span>
          <select id="link-status" name="status"></select>
        </label>
        <label>
          <span>Resume <small>optional, PDF. Leave empty to use your current resume.</small></span>
          <input id="link-resume" name="resume" type="file" accept="application/pdf,.pdf" />
        </label>
        <label>
          <span>Notes <small>optional</small></span>
          <textarea id="link-notes" name="notes" rows="3" placeholder="Recruiter contact, application question answers, etc."></textarea>
        </label>
        <button type="submit">Save application</button>
      </form>
      <pre id="link-result"></pre>
    </section>
    </div>

    <div id="history-view" hidden>
    <div class="history-layout">
    <section class="history-panel">
      <h2>My Jobs</h2>
      <input id="search" type="search" placeholder="Search postings…" aria-label="Search the text of saved postings" />
      <p id="history-status">Loading…</p>
      <ul id="history-list"></ul>
    </section>

    <p id="viewer-placeholder" class="viewer-placeholder">Click an application in the list to see its snapshot and details.</p>
    <section id="viewer" hidden>
      <div class="viewer-bar">
        <span id="viewer-title"></span>
        <div class="viewer-actions">
          <button id="viewer-mode" type="button">Show text</button>
          <button id="viewer-close" type="button">Close</button>
        </div>
      </div>
      <div id="viewer-progress"></div>
      <dl id="viewer-details" hidden></dl>
      <div id="viewer-snapshot"></div>
      <pre id="viewer-text" hidden></pre>
    </section>
    </div>
    </div>

    <div id="insights-view" hidden></div>
  </main>
`

const form = document.querySelector<HTMLFormElement>('#link-form')!
const urlInput = document.querySelector<HTMLInputElement>('#link-url')!
const companyInput = document.querySelector<HTMLInputElement>('#link-company')!
const statusSelect = document.querySelector<HTMLSelectElement>('#link-status')!
const locationInput = document.querySelector<HTMLInputElement>('#link-location')!
const levelSelect = document.querySelector<HTMLSelectElement>('#link-level')!
const fieldSelect = document.querySelector<HTMLSelectElement>('#link-field')!
const workModeSelect = document.querySelector<HTMLSelectElement>('#link-work-mode')!
const resumeInput = document.querySelector<HTMLInputElement>('#link-resume')!
const notesInput = document.querySelector<HTMLTextAreaElement>('#link-notes')!
const resultEl = document.querySelector<HTMLPreElement>('#link-result')!
const viewerDetailsEl = document.querySelector<HTMLDListElement>('#viewer-details')!
const viewerPlaceholder = document.querySelector<HTMLParagraphElement>('#viewer-placeholder')!
const historyCountEl = document.querySelector<HTMLSpanElement>('#history-count')!
const viewerProgressEl = document.querySelector<HTMLDivElement>('#viewer-progress')!
const historyStatusEl = document.querySelector<HTMLParagraphElement>('#history-status')!
const historyListEl = document.querySelector<HTMLUListElement>('#history-list')!
const viewerEl = document.querySelector<HTMLElement>('#viewer')!
const viewerTitleEl = document.querySelector<HTMLSpanElement>('#viewer-title')!
const viewerTextEl = document.querySelector<HTMLPreElement>('#viewer-text')!
const viewerSnapshotEl = document.querySelector<HTMLDivElement>('#viewer-snapshot')!
const viewerModeButton = document.querySelector<HTMLButtonElement>('#viewer-mode')!

function setViewerMode(mode: 'snapshot' | 'text') {
  viewerSnapshotEl.hidden = mode !== 'snapshot'
  viewerTextEl.hidden = mode !== 'text'
  viewerModeButton.textContent = mode === 'snapshot' ? 'Show text' : 'Show snapshot'
}

viewerModeButton.addEventListener('click', () => {
  setViewerMode(viewerSnapshotEl.hidden ? 'snapshot' : 'text')
})

function viewerMessage(text: string, isError = false) {
  const p = document.createElement('p')
  p.className = isError ? 'viewer-message error' : 'viewer-message'
  p.textContent = text
  return p
}

// Long pages are saved as several snapshot chunks; stacked in order they read as one page.
function renderSnapshots(page: SavedPage, count: number) {
  if (count === 0) {
    viewerSnapshotEl.replaceChildren(
      viewerMessage('No snapshot for this posting. Add the link again to get one.'),
    )
    return
  }
  const images = Array.from({ length: count }, (_, i) => {
    const img = document.createElement('img')
    img.src = historySnapshotUrl(page.id, i + 1)
    img.alt = count === 1 ? 'Snapshot of the job posting' : `Snapshot part ${i + 1} of ${count}`
    return img
  })
  viewerSnapshotEl.replaceChildren(...images)
}

const statusLabel = (status: Status) => status[0].toUpperCase() + status.slice(1)

function statusOptions(selected: Status) {
  return STATUSES.map((status) => {
    const option = document.createElement('option')
    option.value = status
    option.textContent = statusLabel(status)
    option.selected = status === selected
    return option
  })
}

statusSelect.append(...statusOptions('submitted'))

// level, field, and work mode choices come from the backend, blank first option leaves the field for the LLM to fill in
function fillChoices(select: HTMLSelectElement, choices: string[]) {
  const auto = new Option('Auto-detect', '')
  select.replaceChildren(auto, ...choices.map((choice) => new Option(choice, choice)))
}

getOptions()
  .then((options) => {
    fillChoices(levelSelect, options.levels)
    fillChoices(fieldSelect, options.fields)
    fillChoices(workModeSelect, options.work_modes)
  })
  .catch(() => {
    for (const select of [levelSelect, fieldSelect, workModeSelect]) fillChoices(select, [])
  })

// colour-coded dropdown, so an application's status can be changed right from the history list
function statusPicker(page: SavedPage) {
  const select = document.createElement('select')
  select.className = 'status-picker'
  select.dataset.status = page.status
  select.setAttribute('aria-label', 'Application status')
  select.append(...statusOptions(page.status))
  select.addEventListener('change', async () => {
    const previous = page.status
    const next = select.value as Status
    select.dataset.status = next
    select.disabled = true
    try {
      page.status = (await updateStatus(page.id, next)).status
      insights.refresh() // counts by status changed
    } catch (err) {
      // list never shows a status that wasn't saved.
      select.value = previous
      select.dataset.status = previous
      select.title = `Couldn't update status: ${(err as Error).message}`
    } finally {
      select.disabled = false
    }
  })
  return select
}

// detail rows shown in the viewer in order. values the user didn't manually enter are marked "auto" .
const DETAIL_ROWS: [keyof Details, string][] = [
  ['role', 'Role'],
  ['location', 'Location'],
  ['level', 'Level'],
  ['field', 'Field'],
  ['work_mode', 'Work mode'],
  ['salary', 'Salary'],
  ['summary', 'Summary'],
]

function detailRow(label: string, value: Node | string, auto = false) {
  const dt = document.createElement('dt')
  dt.textContent = label
  const dd = document.createElement('dd')
  dd.append(value)
  if (auto) {
    const tag = document.createElement('span')
    tag.className = 'auto-tag'
    tag.textContent = 'auto'
    tag.title = 'Detected from the posting'
    dd.append(' ', tag)
  }
  return [dt, dd]
}

// where the LLM is with this posting and a button to (re)try when it isn't done.
function detailsProgress(page: SavedPageWithText) {
  const messages = {
    pending: 'Reading the posting for details… this can take a minute.',
    failed: "Couldn't read details from the posting. Is Ollama running?",
    none: "Details haven't been read from this posting yet.",
  }
  if (page.details_status === 'done') return []
  const wrap = document.createElement('div')
  wrap.className = 'details-progress'
  wrap.append(messages[page.details_status ?? 'none'])
  if (page.details_status !== 'pending') {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = page.details_status === 'failed' ? 'Retry' : 'Read details'
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        renderDetails(await retryDetails(page.id))
        loadHistory()
      } catch (err) {
        button.disabled = false
        button.title = (err as Error).message
      }
    })
    wrap.append(' ', button)
  }
  return [wrap]
}

// all details about the open application, blank rows not shown 
function renderDetails(page: SavedPageWithText) {
  const details = page.details ?? {}
  const entered = new Set(page.entered)
  const nodes = [
    ...(page.company ? detailRow('Company', page.company) : []),
    ...DETAIL_ROWS.flatMap(([key, label]) => {
      const value = details[key]
      return value && typeof value === 'string' ? detailRow(label, value, !entered.has(key)) : []
    }),
    ...(details.requirements?.length ? detailRow('Requirements', requirementsList(details.requirements)) : []),
    ...detailRow('Link', externalLink(page.url)),
    ...(page.notes ? detailRow('Notes', page.notes) : []),
  ]
  viewerDetailsEl.replaceChildren(...nodes)
  viewerDetailsEl.hidden = false
  viewerProgressEl.replaceChildren(...detailsProgress(page))
}

function requirementsList(requirements: string[]) {
  const ul = document.createElement('ul')
  ul.append(
    ...requirements.map((requirement) => {
      const li = document.createElement('li')
      li.textContent = requirement
      return li
    }),
  )
  return ul
}

function externalLink(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  a.textContent = url
  return a
}

// The posting open in the viewer, highlighted in the history list.
let activePageId: string | null = null

function setActivePage(id: string | null) {
  activePageId = id
  for (const li of historyListEl.querySelectorAll<HTMLLIElement>('li')) {
    li.classList.toggle('active', li.dataset.id === id)
  }
}

async function showPage(page: SavedPage) {
  showView('history')
  viewerPlaceholder.hidden = true
  setActivePage(page.id)
  viewerTitleEl.textContent = page.title ?? page.url
  viewerDetailsEl.hidden = true
  viewerProgressEl.replaceChildren()
  viewerSnapshotEl.replaceChildren(viewerMessage('Loading…'))
  viewerTextEl.classList.remove('error')
  viewerTextEl.textContent = 'Loading…'
  setViewerMode('snapshot')
  viewerEl.hidden = false
  viewerEl.scrollIntoView({ behavior: 'smooth' })
  try {
    const details = await getHistoryPage(page.id)
    renderDetails(details)
    renderSnapshots(page, details.snapshots)
    viewerTextEl.textContent = details.text || 'No text was found on this page.'
  } catch (err) {
    const message = (err as Error).message
    viewerSnapshotEl.replaceChildren(viewerMessage(message, true))
    viewerTextEl.textContent = message
    viewerTextEl.classList.add('error')
  }
}

function closeViewer() {
  viewerEl.hidden = true
  viewerPlaceholder.hidden = false
  setActivePage(null)
  viewerSnapshotEl.replaceChildren()
  viewerTextEl.textContent = ''
}

document.querySelector('#viewer-close')!.addEventListener('click', closeViewer)

// Delete asks first: the button swaps for a Confirm / Cancel prompt, and only Confirm deletes.
function deleteControl(page: SavedPage) {
  const control = document.createElement('div')
  control.className = 'delete-control'

  const button = (text: string, className: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    b.textContent = text
    b.addEventListener('click', onClick)
    return b
  }

  const showDelete = (error?: string) => {
    const del = button('Delete', 'delete-button', askToConfirm)
    del.setAttribute('aria-label', `Delete ${page.title ?? 'this application'}`)
    control.replaceChildren(del)
    if (error) {
      const message = document.createElement('small')
      message.className = 'error'
      message.textContent = `Couldn't delete: ${error}`
      control.append(message)
    }
  }

  const askToConfirm = () => {
    const question = document.createElement('span')
    question.className = 'delete-question'
    question.textContent = 'Delete this application?'
    const confirm = button('Confirm', 'delete-confirm', async () => {
      confirm.disabled = true
      cancel.disabled = true
      confirm.textContent = 'Deleting…'
      try {
        await deleteApplication(page.id)
        if (activePageId === page.id) closeViewer()
        loadHistory()
      } catch (err) {
        showDelete((err as Error).message)
      }
    })
    const cancel = button('Cancel', 'delete-cancel', () => showDelete())
    control.replaceChildren(question, confirm, cancel)
    cancel.focus() // the safe choice gets focus, so Enter doesn't delete by accident
  }

  // Escape backs out of the prompt.
  control.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && control.querySelector('.delete-cancel')) showDelete()
  })

  showDelete()
  return control
}
function renderHistoryItem(page: SavedPage) {
  const li = document.createElement('li')
  li.dataset.id = page.id
  li.classList.toggle('active', page.id === activePageId)
  li.tabIndex = 0
  li.addEventListener('click', (e) => {
    if ((e.target as Element).closest('button, a, select')) return
    showPage(page)
  })
  li.addEventListener('keydown', (e) => {
    if (e.target === li && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      showPage(page)
    }
  })

  const info = document.createElement('div')
  const details = page.details ?? {}
  const title = document.createElement('strong')
  title.textContent = details.role ?? page.title ?? '(untitled)'
  const meta = document.createElement('small')
  meta.textContent = [page.company, details.location ?? new URL(page.final_url).hostname, new Date(page.saved_at).toLocaleDateString()]
    .filter(Boolean)
    .join(' · ')
  info.append(title, meta, historyTags(page))

  const view = document.createElement('button')
  view.type = 'button'
  view.textContent = 'View'
  view.addEventListener('click', () => showPage(page))

  const actions = document.createElement('div')
  actions.className = 'history-actions'
  actions.append(statusPicker(page), resumeLink(page), view, deleteControl(page))

  li.append(info, actions)
  return li
}

// Level, field, and work mode as small tags, or where the LLM is with them.
function historyTags(page: SavedPage) {
  const tags = document.createElement('div')
  tags.className = 'tags'
  if (page.details_status === 'pending') {
    tags.append(tag('Reading posting…', 'tag muted'))
  } else if (page.details_status === 'failed') {
    tags.append(tag("Couldn't read details", 'tag muted'))
  }
  const details = page.details ?? {}
  for (const value of [details.level, details.field, details.work_mode]) {
    if (value) tags.append(tag(value))
  }
  return tags
}

function tag(text: string, className = 'tag') {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  return span
}

// Opens the resume exactly as it was when this link was saved.
function resumeLink(page: SavedPage) {
  if (!page.resume_commit) {
    const none = document.createElement('small')
    none.textContent = 'No resume'
    none.title = 'No resume had been uploaded when this link was saved.'
    return none
  }
  const link = document.createElement('a')
  link.className = 'button-link'
  link.href = resumeUrl(page.resume_commit)
  link.target = '_blank'
  link.rel = 'noopener'
  link.textContent = 'Resume'
  link.title = `Resume version ${page.resume_commit.slice(0, 7)}`
  return link
}

const POLL_MS = 4000
let pollTimer: number | undefined
let lastDetailsStatus = new Map<string, SavedPage['details_status']>()
let lastHistorySignature = ''

async function loadHistory() {
  historyStatusEl.classList.remove('error')
  window.clearTimeout(pollTimer)
  try {
    const { pages } = await getHistory()
    if (searchQuery()) runSearch() // keep showing search results, refreshed
    else historyListEl.replaceChildren(...pages.map(renderHistoryItem))
    historyStatusEl.textContent = pages.length ? '' : 'No saved postings yet.'
    historyStatusEl.hidden = pages.length > 0
    historyCountEl.textContent = pages.length ? String(pages.length) : ''

    
    const signature = JSON.stringify(pages.map((page) => [page.id, page.status, page.details_status]))
    if (signature !== lastHistorySignature) {
      lastHistorySignature = signature
      insights.refresh()
    }

    const active = pages.find((page) => page.id === activePageId)
    if (active && active.details_status !== lastDetailsStatus.get(active.id) && !viewerEl.hidden) {
      getHistoryPage(active.id).then(renderDetails).catch(() => {})
    }
    lastDetailsStatus = new Map(pages.map((page) => [page.id, page.details_status]))

    if (pages.some((page) => page.details_status === 'pending')) {
      pollTimer = window.setTimeout(loadHistory, POLL_MS)
    }
  } catch (err) {
    historyStatusEl.textContent = (err as Error).message
    historyStatusEl.classList.add('error')
    historyStatusEl.hidden = false
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  resultEl.classList.remove('error')

  const resume = resumeInput.files?.[0]
  if (resume && resume.type !== 'application/pdf') {
    resultEl.textContent = 'The resume must be a PDF.'
    resultEl.classList.add('error')
    return
  }

  // Loading the page, taking its snapshot, and reading it takes a few seconds.
  resultEl.textContent = 'Saving… this takes a few seconds.'
  try {
    const data = await postApplication({
      url: urlInput.value,
      company: companyInput.value,
      location: locationInput.value,
      level: levelSelect.value,
      field: fieldSelect.value,
      work_mode: workModeSelect.value,
      notes: notesInput.value,
      status: statusSelect.value as Status,
      resume,
    })
    resultEl.textContent = `Saved: ${data.title ?? data.url}. It's in My Jobs; details are being read in the background…`
    form.reset()
    loadHistory()
  } catch (err) {
    resultEl.textContent = (err as Error).message
    resultEl.classList.add('error')
  }
})


// 3 tabs 
// add to add a new application
// history: show previous jobs as "my jobs"
// insights: visualization category based
type View = 'add' | 'history' | 'insights'
const views: Record<View, HTMLDivElement> = {
  add: document.querySelector<HTMLDivElement>('#add-view')!,
  history: document.querySelector<HTMLDivElement>('#history-view')!,
  insights: document.querySelector<HTMLDivElement>('#insights-view')!,
}
const insights = createInsightsView()
views.insights.append(insights.root)

function showView(view: View) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page')
    else tab.removeAttribute('aria-current')
  }
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  tab.addEventListener('click', () => showView(tab.dataset.view as View))
}

const searchInput = document.querySelector<HTMLInputElement>('#search')!
const searchQuery = () => searchInput.value.trim()
let searchTimer: number | undefined

async function runSearch() {
  if (!searchQuery()) return loadHistory()
  try {
    const { results } = await searchApplications(searchQuery())
    historyListEl.replaceChildren(
      ...results.map((result) => {
        const li = renderHistoryItem(result)
        for (const [before, match, after] of result.snippets) {
          const snippet = document.createElement('p')
          snippet.className = 'snippet'
          const mark = document.createElement('mark')
          mark.textContent = match
          snippet.append(before, mark, after)
          li.querySelector('div')!.append(snippet)
        }
        return li
      }),
    )
    historyStatusEl.textContent = results.length ? '' : `No postings mention "${searchQuery()}".`
    historyStatusEl.hidden = results.length > 0
  } catch (err) {
    historyStatusEl.textContent = (err as Error).message
    historyStatusEl.hidden = false
  }
}

searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(runSearch, 250) // wait for a pause in typing
})

loadHistory()
