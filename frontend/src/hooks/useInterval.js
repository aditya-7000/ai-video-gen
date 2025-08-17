import { useEffect, useRef } from 'react'
export default function useInterval(cb, delay) {
  const ref = useRef()
  useEffect(()=>{ ref.current = cb }, [cb])
  useEffect(()=>{
    if (delay === null) return
    const id = setInterval(()=>ref.current && ref.current(), delay)
    return ()=>clearInterval(id)
  }, [delay])
}
