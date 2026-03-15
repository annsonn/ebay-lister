import { useEffect, useRef } from 'react'
import { createWS } from '../lib/api'

export function useWebSocket(onMessage) {
  const cbRef = useRef(onMessage)
  useEffect(() => { cbRef.current = onMessage }, [onMessage])

  useEffect(() => {
    const cleanup = createWS((msg) => cbRef.current(msg))
    return cleanup
  }, [])
}
