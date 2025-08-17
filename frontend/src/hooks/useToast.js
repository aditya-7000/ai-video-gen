import { useEffect, useRef, useState, useCallback } from 'react'
export function useInterval(cb, delay) {
  const ref = useRef()
  useEffect(()=>{ ref.current = cb }, [cb])
  useEffect(()=>{
    if (delay === null) return
    const id = setInterval(()=>ref.current && ref.current(), delay)
    return ()=>clearInterval(id)
  }, [delay])
}

export default function useToast(duration = 3000) {
  const [toast, setToast] = useState({ visible: false, message: '' })

  const showToast = useCallback((message) => {
    setToast({ visible: true, message })
    setTimeout(() => setToast({ visible: false, message: '' }), duration)
  }, [duration])

  return [toast, showToast]
}
