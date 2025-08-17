import { useEffect, useRef, useState } from 'react'
import { composePrompt, jobStatus, startGeneration } from '../services/api'
import VideoPlayer from './VideoPlayer'

export default function VideoComposer({ initialPrompt='', onGenerated }) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [composed, setComposed] = useState('')
  const [variantText, setVariantText] = useState('')
  const [mode, setMode] = useState('auto_refine')
  const [negative, setNegative] = useState('')
  const [hls, setHls] = useState(true)
  const [loadingCompose, setLoadingCompose] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [progress, setProgress] = useState(0)
  const [mp4Url, setMp4Url] = useState(null)
  const [hlsUrl, setHlsUrl] = useState(null)

  const pollRef = useRef(null)

  async function doCompose(){
    setLoadingCompose(true)
    try {
      const { composed: out } = await composePrompt(composed, variantText, mode)
      setComposed(out)
    } catch (e) { alert(e.message || String(e)) } finally { setLoadingCompose(false) }
  }

  async function start(){
    if (!prompt && !composed) return alert('Enter or choose a prompt')
    try {
      const { job_id } = await startGeneration({ prompt, composed_prompt: composed, negative_prompt: negative || undefined, hls })
      setJobId(job_id); setStatus('queued'); setProgress(0)
      poll(job_id)
    } catch (e) { alert(e.message || String(e)) }
  }

  function poll(jid){
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async ()=>{
      try {
        const j = await jobStatus(jid)
        setStatus(j.status); setProgress(j.progress || 0)
        if (j.mp4_url) setMp4Url(j.mp4_url)
        if (j.hls_url) setHlsUrl(j.hls_url)
        if (j.status==='done' || j.status==='error') {
          clearInterval(pollRef.current)
          onGenerated && onGenerated()
        }
      } catch {}
    }, 2500)
  }

  useEffect(()=>()=>{ if (pollRef.current) clearInterval(pollRef.current) }, [])

  return (
    <div className="bg-white p-4 rounded shadow space-y-3">
      <h3 className="font-semibold">Compose & generate</h3>
      <div>
        <label className="text-sm">Raw prompt</label>
        <textarea rows={2} value={prompt} onChange={e=>setPrompt(e.target.value)} className="w-full border rounded p-2" />
      </div>
      <div>
        <label className="text-sm">Composed prompt (optional)</label>
        <textarea rows={2} value={composed} onChange={e=>setComposed(e.target.value)} className="w-full border rounded p-2" />
        <div className="flex gap-2 mt-2">
          <input value={variantText} onChange={e=>setVariantText(e.target.value)} placeholder="Variant detail (optional)" className="flex-1 border p-2 rounded" />
          <select value={mode} onChange={e=>setMode(e.target.value)} className="border rounded p-2">
            <option value="auto_refine">Auto refine</option>
            <option value="merge">Merge</option>
          </select>
          <button onClick={doCompose} disabled={loadingCompose} className="bg-indigo-600 text-white px-3 py-1 rounded">Compose</button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-sm">Negative prompt</label>
        <input value={negative} onChange={e=>setNegative(e.target.value)} placeholder="Optional (e.g. low quality)" className="border p-2 rounded flex-1" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={hls} onChange={e=>setHls(e.target.checked)} /> HLS</label>
        <button onClick={start} className="ml-auto bg-green-600 text-white px-3 py-1 rounded">Generate</button>
      </div>

      {jobId && (
        <div className="p-3 border rounded">
          <div className="text-sm">Job: {jobId}</div>
          <div className="w-full bg-gray-200 rounded h-3 mt-2">
            <div style={{width: `${progress}%`}} className="h-3 bg-blue-600 rounded" />
          </div>
          <div className="mt-2 text-sm">Status: {status} · Progress: {Math.round(progress)}%</div>
          <div className="mt-3 space-y-2">
            {mp4Url && (
              <div>
                <div className="text-xs text-gray-600 mb-1">MP4 ready</div>
                <a href={mp4Url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open MP4</a>
                <button className="ml-2 px-2 py-1 bg-blue-600 text-white rounded" onClick={async()=>{
                  const r = await fetch(mp4Url); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${jobId}.mp4`; document.body.appendChild(a); a.click(); a.remove();
                }}>Download</button>
              </div>
            )}
            {hlsUrl && (
              <div>
                <div className="text-xs text-gray-600 mb-1">HLS ready</div>
                <a href={hlsUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open playlist</a>
              </div>
            )}
          </div>
        </div>
      )}

      {(mp4Url || hlsUrl) && (
        <VideoPlayer mp4Url={mp4Url} hlsUrl={hlsUrl} />
      )}
    </div>
  )
}
