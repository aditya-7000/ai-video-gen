import { useEffect, useRef } from 'react'
import Hls from 'hls.js'

export default function VideoPlayer({ mp4Url, hlsUrl }) {
  const ref = useRef()
  useEffect(()=>{
    const video = ref.current
    if (!video) return
    if (hlsUrl) {
      if (Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource(hlsUrl)
        hls.attachMedia(video)
        video.play().catch(()=>{})
        return ()=>hls.destroy()
      } else {
        video.src = hlsUrl
        video.play().catch(()=>{})
      }
    } else if (mp4Url) {
      video.src = mp4Url
    }
  }, [mp4Url, hlsUrl])

  return (
    <div className="bg-black rounded overflow-hidden">
      <video ref={ref} controls className="w-full" style={{height: 360}} />
    </div>
  )
}