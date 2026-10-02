import './style.css'
import {
  getHistory,
  getHistoryPage,
  historySnapshotUrl,
  postApplication,
  resumeUrl,
  STATUSES,
  updateStatus,
  type SavedPage,
  type Status,
  type SavedPageWithText,
} from './api.ts'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header id="topbar">
    <h1>Job Tracker</h1>
  </header>

  <aside id="sidebar">
    <h2>History</h2>
    <p id="history-status">Loading…</p>
    <ul id="history-list"></ul>
  </aside>

  <main>
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

    <section id="viewer" hidden>
      <div class="viewer-bar">
        <span id="viewer-title"></span>
        <div class="viewer-actions">
          <button id="viewer-mode" type="button">Show text</button>
          <button id="viewer-close" type="button">Close</button>
        </div>
      </div>
      <dl id="viewer-details" hidden></dl>
      <div id="viewer-snapshot"></div>
      <pre id="viewer-text" hidden></pre>
    </section>
  </main>
`

const form = document.querySelector<HTMLFormElement>('#link-form')!
const urlInput = document.querySelector<HTMLInputElement>('#link-url')!
const companyInput = document.querySelector<HTMLInputElement>('#link-company')!
const statusSelect = document.querySelector<HTMLSelectElement>('#link-status')!
const resumeInput = document.querySelector<HTMLInputElement>('#link-resume')!
const notesInput = document.querySelector<HTMLTextAreaElement>('#link-notes')!
const resultEl = document.querySelector<HTMLPreElement>('#link-result')!
const viewerDetailsEl = document.querySelector<HTMLDListElement>('#viewer-details')!
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

// A colour-coded dropdown, so an application's status can be changed right from the sidebar.
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
    } catch (err) {
      // Put it back so the sidebar never shows a status that wasn't saved.
      select.value = previous
      select.dataset.status = previous
      select.title = `Couldn't update status: ${(err as Error).message}`
    } finally {
      select.disabled = false
    }
  })
  return select
}

// Company, link, and notes for the open application; rows left blank are skipped.
function renderDetails(page: SavedPageWithText) {
  const rows: [string, Node | string | null][] = [
    ['Company', page.company],
    ['Link', externalLink(page.url)],
    ['Notes', page.notes],
  ]
  const nodes = rows.flatMap(([label, value]) => {
    if (!value) return []
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.append(value)
    return [dt, dd]
  })
  viewerDetailsEl.replaceChildren(...nodes)
  viewerDetailsEl.hidden = nodes.length === 0
}

function externalLink(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  a.textContent = url
  return a
}

// The posting open in the viewer, highlighted in the sidebar.
let activePageId: string | null = null

function setActivePage(id: string | null) {
  activePageId = id
  for (const li of historyListEl.querySelectorAll<HTMLLIElement>('li')) {
    li.classList.toggle('active', li.dataset.id === id)
  }
}

async function showPage(page: SavedPage) {
  setActivePage(page.id)
  viewerTitleEl.textContent = page.title ?? page.url
  viewerDetailsEl.hidden = true
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

document.querySelector('#viewer-close')!.addEventListener('click', () => {
  viewerEl.hidden = true
  setActivePage(null)
  viewerSnapshotEl.replaceChildren()
  viewerTextEl.textContent = ''
})

// Titles come from other sites, so build the list with textContent rather than innerHTML.
function renderHistoryItem(page: SavedPage) {
  const li = document.createElement('li')
  li.dataset.id = page.id
  li.classList.toggle('active', page.id === activePageId)

  const info = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = page.title ?? '(untitled)'
  const meta = document.createElement('small')
  meta.textContent = [page.company, new URL(page.final_url).hostname, new Date(page.saved_at).toLocaleString()]
    .filter(Boolean)
    .join(' · ')
  info.append(title, meta)

  const view = document.createElement('button')
  view.type = 'button'
  view.textContent = 'View'
  view.addEventListener('click', () => showPage(page))

  const actions = document.createElement('div')
  actions.className = 'history-actions'
  actions.append(statusPicker(page), resumeLink(page), view)

  li.append(info, actions)
  return li
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

async function loadHistory() {
  historyStatusEl.classList.remove('error')
  try {
    const { pages } = await getHistory()
    historyListEl.replaceChildren(...pages.map(renderHistoryItem))
    historyStatusEl.textContent = pages.length ? '' : 'No saved postings yet.'
    historyStatusEl.hidden = pages.length > 0
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
      notes: notesInput.value,
      status: statusSelect.value as Status,
      resume,
    })
    resultEl.textContent = `Saved: ${data.title ?? data.url}`
    form.reset()
    loadHistory()
  } catch (err) {
    resultEl.textContent = (err as Error).message
    resultEl.classList.add('error')
  }
})

loadHistory()
