// client for the Flask backend. Paths are relative so the Vite proxy handles them in dev.

export const STATUSES = ['submitted', 'callback', 'accepted', 'rejected'] as const
export type Status = (typeof STATUSES)[number]

export interface SavedPage {
  id: string
  url: string
  final_url: string
  title: string | null
  saved_at: string
  resume_commit: string | null
  company: string | null
  status: Status
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

export const postApplication = ({ url, company, notes, status, resume }: NewApplication) => {
  const body = new FormData()
  body.append('url', url)
  if (company) body.append('company', company)
  if (notes) body.append('notes', notes)
  if (status) body.append('status', status)
  if (resume) body.append('resume', resume)
  return request<LinkResponse>('/link', { method: 'POST', body })
}

// sidebar history
export const getHistory = () => request<HistoryResponse>('/history')

export const getHistoryPage = (id: string) =>
  request<SavedPageWithText>(`/history/${encodeURIComponent(id)}`)

export const updateStatus = (id: string, status: Status) =>
  request<SavedPageWithText>(`/history/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })

// Snapshots are PNGs, viewer loads them  into <img> tags
export const historySnapshotUrl = (id: string, number: number) =>
  `/api/history/${encodeURIComponent(id)}/snapshot/${number}`

// Served as a PDF, so link to it and let the browser open it.
export const resumeUrl = (commit: string) => `/api/resume/${encodeURIComponent(commit)}`
