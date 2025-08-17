const API_BASE = import.meta.env.VITE_API_BASE || ''

export async function authFetch(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {}
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  // No Authorization header needed
  const res = await fetch(API_BASE + path, { ...options, headers })
  return res
}

export async function login(username, password) {
  // Dummy login: always succeed
  return { user: { username } }
}

export async function register(username, password) {
  // Dummy register: always succeed
  return { user: { username } }
}

export async function improvePrompt(prompt) {
  const r = await authFetch('/api/improve', {
    method: 'POST',
    body: JSON.stringify({ prompt })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'Improve failed')
  return j
}

export async function composePrompt(base_improved, variant, mode='auto_refine') {
  const r = await authFetch('/api/compose', {
    method: 'POST',
    body: JSON.stringify({ base_improved, variant, mode })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'Compose failed')
  return j
}

export async function startGeneration({ prompt, composed_prompt, negative_prompt, hls }) {
  const r = await authFetch('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, composed_prompt, negative_prompt, hls })
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'Generation failed')
  return j
}

export async function jobStatus(job_id) {
  const r = await authFetch(`/api/status/${job_id}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'Status failed')
  return j
}

export async function listVideos(page=1, per_page=20) {
  const r = await authFetch(`/api/videos?page=${page}&per_page=${per_page}`)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'List failed')
  return j
}