import React, { useEffect, useState, useRef } from 'react'
import { listVideos } from '../services/api'
import { Container, Group, Button, Text, Paper, Stack, Badge, ScrollArea, Title, Modal } from '@mantine/core'

export default function History() {
  const API_BASE = import.meta.env.VITE_API_BASE || ''
  const resolveUrl = (u) => {
    if (!u) return u
    if (/^https?:\/\//i.test(u)) return u
    return API_BASE + u
  }
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [downloadingId, setDownloadingId] = useState(null)
  const [viewItem, setViewItem] = useState(null)
  const videoRef = useRef(null)
  const [thumbCues, setThumbCues] = useState([]) // [{start,end,src}]
  const [preview, setPreview] = useState({ visible: false, x: 0, y: 0, src: null })
  const [thumbMap, setThumbMap] = useState({})

  // Setup HLS playback when a viewItem is opened
  useEffect(() => {
    const videoEl = videoRef.current
    if (!viewItem || !videoEl) return
    let hls
    let disposed = false

    const hlsUrl = resolveUrl(viewItem.hls_url)
    const mp4Url = resolveUrl(viewItem.mp4_url)

    async function setup() {
      // Prefer HLS if URL available
      if (hlsUrl) {
        try {
          const mod = await import('hls.js')
          const Hls = mod.default || mod
          if (Hls && Hls.isSupported()) {
            hls = new Hls({ maxBufferLength: 30 })
            hls.loadSource(hlsUrl)
            hls.attachMedia(videoEl)
            return
          }
        } catch (e) {
          // hls.js not installed or failed — fall back below
        }
        // Native HLS (Safari)
        if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = hlsUrl
          return
        }
      }
      // Fallback: MP4
      if (mp4Url) {
        videoEl.src = mp4Url
      }
    }

    setup()

    return () => {
      disposed = true
      if (hls) {
        try { hls.destroy() } catch {}
      }
      videoEl.pause()
      videoEl.removeAttribute('src')
      videoEl.load()
      setThumbCues([])
      setPreview({ visible: false, x: 0, y: 0, src: null })
    }
  }, [viewItem])

  // Load thumbnail VTT if available
  useEffect(() => {
    if (!viewItem?.thumb_vtt_url) return
    const controller = new AbortController()
    ;(async () => {
      try {
        const vttUrl = resolveUrl(viewItem.thumb_vtt_url)
        const base = vttUrl.substring(0, vttUrl.lastIndexOf('/'))
        const res = await fetch(vttUrl, { signal: controller.signal })
        if (!res.ok) throw new Error(`Failed to load VTT: ${res.status}`)
        const text = await res.text()
        const cues = []
        const lines = text.split(/\r?\n/)
        let i = 0
        // Skip header
        while (i < lines.length && lines[i].trim() === '') i++
        if (i < lines.length && lines[i].startsWith('WEBVTT')) i++
        while (i < lines.length) {
          // Skip empty
          while (i < lines.length && lines[i].trim() === '') i++
          if (i >= lines.length) break
          const timing = lines[i++].trim()
          const m = timing.match(/(\d\d:\d\d:\d\d[\.,]\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d[\.,]\d\d\d)/)
          if (!m) { continue }
          const start = parseVttTime(m[1])
          const end = parseVttTime(m[2])
          // Next non-empty is URL/filename
          while (i < lines.length && lines[i].trim() === '') i++
          if (i >= lines.length) break
          const name = lines[i++].trim()
          const src = /^https?:\/\//i.test(name) ? name : `${base}/${name}`
          cues.push({ start, end, src })
          // Skip until blank line
          while (i < lines.length && lines[i].trim() !== '') i++
        }
        setThumbCues(cues)
      } catch (e) {
        // Ignore VTT errors; preview is optional
        setThumbCues([])
      }
    })()
    return () => controller.abort()
  }, [viewItem?.thumb_vtt_url])

  function parseVttTime(t) {
    // HH:MM:SS.mmm
    const [hms, ms] = t.replace(',', '.').split('.')
    const [h, m, s] = hms.split(':').map(Number)
    return h * 3600 + m * 60 + Number(s) + (Number(ms) || 0) / 1000
  }

  function handleVideoMove(e) {
    if (!thumbCues.length) return
    const videoEl = videoRef.current
    if (!videoEl || !isFinite(videoEl.duration) || videoEl.duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const ratio = Math.min(Math.max(x / rect.width, 0), 1)
    const t = ratio * videoEl.duration
    // Find cue covering t; assuming sorted
    let cue = null
    // Fast index by Math.floor(t) since fps=1
    const idx = Math.max(0, Math.min(thumbCues.length - 1, Math.floor(t)))
    cue = thumbCues[idx]
    if (!cue || t < cue.start || t >= cue.end) {
      cue = thumbCues.find(c => t >= c.start && t < c.end) || null
    }
    if (cue) {
      const px = Math.min(Math.max(x - 60, 4), rect.width - 124)
      const py = Math.max(y - 100, 4)
      setPreview({ visible: true, x: px, y: py, src: cue.src })
    } else {
      setPreview(p => ({ ...p, visible: false }))
    }
  }

  function handleVideoLeave() {
    if (preview.visible) setPreview(p => ({ ...p, visible: false }))
  }

  function formatTimestamp(ts) {
    if (!ts && ts !== 0) return ''
    const num = Number(ts)
    const ms = num < 1e12 ? num * 1000 : num // support seconds or ms
    const d = new Date(ms)
    try {
      return d.toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      })
    } catch {
      return d.toISOString()
    }
  }

  // Retry functionality removed per request

  async function load(p = page) {
    try {
      setLoading(true)
      setError(null)
      const res = await listVideos(p, perPage)
      const list = res.items || []
      setItems(list)
      setPage(res.page || p)
      // Build per-item thumbnail from VTT (first cue image)
      try {
        const entries = await Promise.allSettled(
          list
            .filter(it => it.thumb_vtt_url)
            .map(async it => {
              const key = it.id || it.job_id
              const vttUrl = resolveUrl(it.thumb_vtt_url)
              const base = vttUrl.substring(0, vttUrl.lastIndexOf('/'))
              const r = await fetch(vttUrl)
              if (!r.ok) throw new Error('vtt')
              const text = await r.text()
              const lines = text.split(/\r?\n/)
              let i = 0
              while (i < lines.length && lines[i].trim() === '') i++
              if (i < lines.length && lines[i].startsWith('WEBVTT')) i++
              // find first cue
              while (i < lines.length) {
                while (i < lines.length && lines[i].trim() === '') i++
                if (i >= lines.length) break
                const timing = lines[i++].trim()
                if (!/-->/i.test(timing)) continue
                while (i < lines.length && lines[i].trim() === '') i++
                if (i >= lines.length) break
                const name = lines[i++].trim()
                const src = /^https?:\/\//i.test(name) ? name : `${base}/${name}`
                return [key, src]
              }
              return [key, null]
            })
        )
        const map = {}
        for (const e of entries) {
          if (e.status === 'fulfilled') {
            const [k, s] = e.value || []
            if (k && s) map[k] = s
          }
        }
        setThumbMap(map)
      } catch {}
    } catch (e) {
      setError(e.message || 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1) }, [])

  async function handleDownload(it) {
    if (!it?.mp4_url) return
    try {
      setDownloadingId(it.id || it.job_id)
      const res = await fetch(resolveUrl(it.mp4_url))
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const base = (it.id || it.job_id || 'video').toString()
      a.href = url
      a.download = `${base}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      alert(e.message || 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <Container size="lg" p="xs">
      <Modal opened={!!viewItem} onClose={() => setViewItem(null)} title="Preview" size="xl" centered>
        {viewItem && (
          <div style={{ position: 'relative' }} onMouseMove={handleVideoMove} onMouseLeave={handleVideoLeave}>
            <video ref={videoRef} controls style={{ width: '100%', borderRadius: 8 }}>
              {/* MP4 fallback source; HLS will attach programmatically */}
              {viewItem.mp4_url ? (
                <source src={resolveUrl(viewItem.mp4_url)} type="video/mp4" />
              ) : null}
            </video>
            {preview.visible && preview.src && (
              <div style={{ position: 'absolute', left: preview.x, top: preview.y, pointerEvents: 'none', background: 'rgba(0,0,0,0.6)', padding: 4, borderRadius: 6 }}>
                <img src={preview.src} alt="preview" style={{ width: 120, height: 'auto', display: 'block', borderRadius: 4 }} />
              </div>
            )}
          </div>
        )}
      </Modal>
      <Group justify="space-between" mb="sm">
        <Title order={3}>Generation history</Title>
        <Button size="xs" variant="default" onClick={() => load(1)} loading={loading}>
          Refresh
        </Button>
      </Group>

      {error && (
        <Paper p="sm" radius="md" withBorder mb="sm">
          <Text c="red">{error}</Text>
        </Paper>
      )}

      {!loading && items.length === 0 ? (
        <Text c="dimmed">No videos yet.</Text>
      ) : (
        <ScrollArea h={560} type="auto">
          <Stack gap="xs">
            {items.map((it) => (
              <Paper key={it.id || it.job_id} p="sm" radius="md" withBorder>
                <Group justify="space-between" align="flex-start">
                  <div
                    style={{ width: 120, height: 68, borderRadius: 8, overflow: 'hidden', background: '#f1f3f5', flex: '0 0 auto', position: 'relative', cursor: (it.hls_url || it.mp4_url) ? 'pointer' : 'default' }}
                    onClick={() => (it.hls_url || it.mp4_url) && setViewItem(it)}
                    aria-label="Play"
                    title="Play"
                  >
                    {thumbMap[(it.id || it.job_id)] ? (
                      <img src={thumbMap[(it.id || it.job_id)]} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>No preview</div>
                    )}
                    {(it.hls_url || it.mp4_url) && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(to bottom, rgba(0,0,0,0.0), rgba(0,0,0,0.25))' }}>
                        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
                          <circle cx="18" cy="18" r="18" fill="rgba(255,255,255,0.8)" />
                          <polygon points="14,11 26,18 14,25" fill="rgba(0,0,0,0.75)" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={500} truncate>
                      {it.prompt}
                    </Text>
                    <Group gap="sm">
                      <Badge variant="light" color={it.status === 'done' ? 'green' : it.status === 'error' ? 'red' : 'blue'}>
                        {it.status}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {Math.round(it.progress || 0)}%{it.created_at ? ` · ${formatTimestamp(it.created_at)}` : ''}
                      </Text>
                    </Group>
                  </Stack>
                  <Group gap="xs">
                    {it.mp4_url && (
                      <Button
                        variant="light"
                        onClick={() => handleDownload(it)}
                        loading={downloadingId === (it.id || it.job_id)}
                        disabled={downloadingId === (it.id || it.job_id)}
                      >
                        Download
                      </Button>
                    )}
                    {/* Retry removed */}
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Container>
  )
}

