import { useState } from 'react'
import { improvePrompt } from '../services/api'

export default function PromptImprover({ onChoose }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [improved, setImproved] = useState(null)
  const [variants, setVariants] = useState([])

  async function improve(){
    if (!input.trim()) return alert('Enter a prompt first')
    setLoading(true)
    try {
      const data = await improvePrompt(input)
      setImproved(data.auto_improved)
      setVariants(data.variants || [])
    } catch (e) {
      alert(e.message || String(e))
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-white rounded p-4 shadow">
      <h3 className="font-semibold mb-2">Prompt improvement</h3>
      <textarea placeholder="Describe the scene..." value={input} onChange={e=>setInput(e.target.value)} className="w-full border rounded p-2 mb-2" rows={3} />
      <div className="flex gap-2 mb-3">
        <button onClick={improve} className="bg-green-600 text-white px-3 py-1 rounded" disabled={loading}>{loading ? 'Improving...' : 'Improve'}</button>
        <button onClick={()=>{ setInput(''); setImproved(null); setVariants([]) }} className="px-3 py-1 border rounded">Clear</button>
        {improved && (
          <button onClick={()=>onChoose && onChoose(improved)} className="ml-auto bg-blue-600 text-white px-3 py-1 rounded">Use improved</button>
        )}
      </div>
      {improved && (
        <div className="mb-3">
          <div className="text-xs text-gray-600 mb-1">Auto improved prompt</div>
          <div className="p-3 bg-gray-50 rounded border">{improved}</div>
        </div>
      )}
      {variants?.length>0 && (
        <div>
          <div className="text-sm font-medium mb-2">Variants</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {variants.map((v,i)=> (
              <div key={i} className="p-3 bg-gray-50 rounded border">
                <div className="text-sm font-semibold">{v.concise}</div>
                <div className="text-xs mt-1 mb-2 text-gray-700">{v.expanded}</div>
                <div className="flex gap-2">
                  <button onClick={()=>onChoose && onChoose(v.expanded)} className="text-sm bg-blue-600 text-white px-2 py-1 rounded">Use</button>
                  <button onClick={()=>navigator.clipboard?.writeText(v.expanded)} className="text-sm border px-2 py-1 rounded">Copy</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}