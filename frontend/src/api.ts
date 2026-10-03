// client for the Flask backend. Paths are relative so the Vite proxy handles them in dev.

export const STATUSES = ['submitted', 'callback', 'accepted', 'rejected'] as const
export type Status = (typeof STATUSES)[number]

// what the LLM read from the posting if user left blank and what user entered if they manually did so.
export interface Details {
  role: string | null
  company: string | null
  location: string | null
  level: string | null
  field: string | null
  work_mode: string | null
  salary: string | null
  requirements: string[]
  summary: string | null
}

// pending/done/failed while and after the LLM reads the posting; null if it never has.
export type DetailsStatus = 'pending' | 'done' | 'failed' | null

// The choices the form offers; the LLM picks from the same lists.
export interface Options {
  levels: string[]
  fields: string[]
  work_modes: string[]
}

export interface SavedPage {
  id: string
  url: string
  final_url: string
  title: string | null
  saved_at: string
  resume_commit: string | null
  company: string | null
  status: Status
  details: Partial<Details> | null
  details_status: DetailsStatus
  // user entered fields 
  entered: string[]
}

export interface SavedPageWithText extends SavedPage {
  text: string | null
  notes: string | null
  snapshots: number // how many chunks for the snapshot
}

export interface LinkResponse extends SavedPage {
  text: string
}

export interface HistoryResponse {
  pages: SavedPage[]
}

export interface NewApplication {
  url: string
  company?: string
  location?: string
  level?: string
  field?: string
  work_mode?: string
  notes?: string
  status?: Status
  resume?: File
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers }
  const res = await fetch(`/api${path}`, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
  return body as T
}

// Sent as a form so a resume PDF can come along. blank fields except resume are filled by llm
export const postApplication = ({ resume, ...fields }: NewApplication) => {
  const body = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    if (value) body.append(name, value)
  }
  if (resume) body.append('resume', resume)
  return request<LinkResponse>('/link', { method: 'POST', body })
}

export const getOptions = () => request<Options>('/options')

// chart data computed by the backend for a date range, in the user's time zone.
export type InsightsRange = '7' | '30' | '90' | 'all'

interface Count {
  label: string
  count: number
}

export interface Insights {
  range: { key: InsightsRange; start: string; end: string }
  totals: { all_time: number; in_range: number; responses: number; response_rate: number | null }
  per_day: { date: string; count: number }[]
  time_of_day: (Count & { hours: string })[]
  by_status: Count[]
  by_work_mode: Count[]
  by_level: Count[]
  by_field: Count[]
}

export const getInsights = (range: InsightsRange, tz: string) =>
  request<Insights>(`/insights?${new URLSearchParams({ range, tz })}`)

// sidebar history
export const getHistory = () => request<HistoryResponse>('/history')

// Search the text of every saved posting
export interface SearchResult extends SavedPage {
  matches: number
  snippets: [string, string, string][]
}

export const searchApplications = (q: string) =>
  request<{ results: SearchResult[] }>(`/search?${new URLSearchParams({ q })}`)

export const getHistoryPage = (id: string) =>
  request<SavedPageWithText>(`/history/${encodeURIComponent(id)}`)

export const updateStatus = (id: string, status: Status) =>
  request<SavedPageWithText>(`/history/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })

// delete application and images ( resume version stays in the resume repo).
export const deleteApplication = (id: string) =>
  request<void>(`/history/${encodeURIComponent(id)}`, { method: 'DELETE' })

// has the LLM read the posting again
export const retryDetails = (id: string) =>
  request<SavedPageWithText>(`/history/${encodeURIComponent(id)}/details`, { method: 'POST' })

// Snapshots are PNGs, viewer loads them  into <img> tags
export const historySnapshotUrl = (id: string, number: number) =>
  `/api/history/${encodeURIComponent(id)}/snapshot/${number}`

// Served as a PDF, so link to it and let the browser open it.
export const resumeUrl = (commit: string) => `/api/resume/${encodeURIComponent(commit)}`
