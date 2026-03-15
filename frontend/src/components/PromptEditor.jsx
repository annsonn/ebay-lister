import { useState } from 'react'
import { api } from '../lib/api'

export function PromptEditor({ label, value, onChange, profileId, batchId }) {
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState(null)

  async function runTest() {
    if (!profileId || !batchId) return
    setTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      const r = await api.testPrompt(profileId, batchId)
      setTestResult(r)
    } catch (e) {
      setTestError(e.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label className="field-label">{label}</label>
        {profileId && batchId && (
          <button className="btn btn-sm btn-outline" onClick={runTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test with last batch'}
          </button>
        )}
      </div>
      <textarea
        className="field-input mono"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        rows={6}
        style={{ fontSize: 12 }}
      />
      {testError && (
        <div style={{ padding: 10, background: 'rgba(255,77,109,0.1)', borderRadius: 6, color: 'var(--red)', fontSize: 12 }}>
          {testError}
        </div>
      )}
      {testResult && (
        <div style={{ padding: 12, background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12 }}>
          <div style={{ color: 'var(--text3)', marginBottom: 6, fontWeight: 600 }}>CONFIDENCE: {testResult.confidence ?? 'N/A'}</div>
          <div style={{ color: 'var(--text3)', marginBottom: 4, fontSize: 11 }}>EXTRACTED DATA:</div>
          <pre style={{ color: 'var(--green)', fontFamily: 'DM Mono', fontSize: 11, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
            {JSON.stringify(testResult.extracted_data, null, 2)}
          </pre>
          <div style={{ color: 'var(--text3)', fontSize: 11, marginBottom: 4 }}>OCR TEXT:</div>
          <pre style={{ color: 'var(--text2)', fontFamily: 'DM Mono', fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {testResult.ocr_text}
          </pre>
        </div>
      )}
    </div>
  )
}
