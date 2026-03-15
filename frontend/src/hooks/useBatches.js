import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useWebSocket } from './useWebSocket'

export function useBatches() {
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api.listBatches()
      setBatches(data)
    } catch (e) {
      console.error('Failed to load batches', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useWebSocket((msg) => {
    if (msg.event === 'batch_update') {
      const { batch_id, status, step, listing } = msg.data
      setBatches((prev) =>
        prev.map((b) => {
          if (b.id !== batch_id) return b
          const updated = { ...b, status, step: step ?? b.step }
          if (listing) {
            updated.listing_summary = { ...b.listing_summary, ...listing }
          }
          return updated
        })
      )
    }
  })

  return { batches, loading, refresh }
}
