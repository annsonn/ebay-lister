const BASE = import.meta.env.VITE_API_URL || ''
const WS_BASE = import.meta.env.VITE_WS_URL || ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { detail = (await res.json()).detail || detail } catch {}
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  createBatch: (formData) =>
    request('/api/batches', { method: 'POST', body: formData }),

  listBatches: () => request('/api/batches'),
  getBatch: (id) => request(`/api/batches/${id}`),

  listListings: (status, profileId) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (profileId) params.set('profile_id', profileId)
    const qs = params.toString()
    return request(`/api/listings${qs ? '?' + qs : ''}`)
  },

  getListing: (id) => request(`/api/listings/${id}`),

  updateListing: (id, data) =>
    request(`/api/listings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  approveListing: (id, data = {}) =>
    request(`/api/listings/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  reprocessListing: (id) =>
    request(`/api/listings/${id}/reprocess`, { method: 'POST' }),

  listProfiles: () => request('/api/profiles'),
  getProfile: (id) => request(`/api/profiles/${id}`),

  createProfile: (data) =>
    request('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  updateProfile: (id, data) =>
    request(`/api/profiles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  deleteProfile: (id) =>
    request(`/api/profiles/${id}`, { method: 'DELETE' }),

  duplicateProfile: (id) =>
    request(`/api/profiles/${id}/duplicate`, { method: 'POST' }),

  testPrompt: (profileId, batchId) =>
    request(`/api/profiles/${profileId}/test-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_id: batchId }),
    }),

  getSettings: () => request('/api/settings'),

  updateSettings: (data) =>
    request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  getOllamaModels: () => request('/api/ollama/models'),

  exportCSV: () => window.open(`${BASE}/api/export/csv`, '_blank'),

  photoUrl: (filename) => `${BASE}/api/photos/${filename}`,

  getEbaySession: () => request('/api/ebay/session'),

  connectEbayAccount: () =>
    request('/api/ebay/login', { method: 'POST' }),

  submitToEbay: (id) =>
    request(`/api/listings/${id}/submit-to-ebay`, { method: 'POST' }),
}

export function createWS(onMessage) {
  const wsBase = WS_BASE || (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host
  let ws = null
  let pingInterval = null
  let reconnectTimeout = null
  let closed = false

  function connect() {
    if (closed) return
    ws = new WebSocket(`${wsBase}/ws`)
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)) } catch {}
    }
    ws.onclose = () => {
      clearInterval(pingInterval)
      if (!closed) reconnectTimeout = setTimeout(connect, 3000)
    }
    ws.onopen = () => {
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 25000)
    }
  }

  connect()

  return () => {
    closed = true
    clearInterval(pingInterval)
    clearTimeout(reconnectTimeout)
    if (ws) ws.close()
  }
}
