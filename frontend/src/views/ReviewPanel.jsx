import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { PhotoStrip } from '../components/PhotoStrip'
import { FieldInput } from '../components/FieldInput'
import { ShippingSection } from '../components/ShippingSection'
import { Toast } from '../components/Toast'

const CONDITIONS = ['New', 'Used', 'Not specified']

export function ReviewPanel({ listing: initialListing, photos = [], onApprove, onReprocess, profile }) {
  const [fields, setFields] = useState({})
  const [modified, setModified] = useState(new Set())
  const [activePhoto, setActivePhoto] = useState(0)
  const [toast, setToast] = useState(null)
  const [approving, setApproving] = useState(false)
  const [ebaySubmitting, setEbaySubmitting] = useState(false)
  const [ebayDraftUrl, setEbayDraftUrl] = useState(null)

  useEffect(() => {
    if (initialListing) {
      setFields({ ...initialListing })
      setModified(new Set())
    }
  }, [initialListing?.id])

  function change(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }))
    setModified((prev) => new Set([...prev, key]))
  }

  function changeExtracted(key, value) {
    setFields((prev) => ({
      ...prev,
      extracted_data: { ...(prev.extracted_data || {}), [key]: value },
    }))
    setModified((prev) => new Set([...prev, 'extracted_data']))
  }

  function reset() {
    setFields({ ...initialListing })
    setModified(new Set())
  }

  async function approve() {
    setApproving(true)
    try {
      const updates = {}
      modified.forEach((k) => { updates[k] = fields[k] })
      await api.approveListing(initialListing.id, updates)
      setToast({ message: 'Listing approved!', type: 'success' })
      onApprove?.()
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    } finally {
      setApproving(false)
    }
  }

  async function reprocess() {
    try {
      await api.reprocessListing(initialListing.id)
      onReprocess?.()
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    }
  }

  async function submitToEbay() {
    setEbaySubmitting(true)
    setEbayDraftUrl(null)
    try {
      await api.submitToEbay(initialListing.id)
      // Draft URL arrives via WebSocket (ebay_submit_done); poll listing as fallback
      const updated = await api.getListing(initialListing.id)
      if (updated.ebay_url) setEbayDraftUrl(updated.ebay_url)
      setToast({ message: 'eBay draft saved! Click the link to review and publish.', type: 'success' })
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    } finally {
      setEbaySubmitting(false)
    }
  }

  if (!initialListing) return null
  const extracted = fields.extracted_data || {}
  const profileFields = profile?.prompt_fields || []
  const isApproved = fields.status === 'approved'
  const existingEbayUrl = fields.ebay_url || ebayDraftUrl
  const existingEbayStatus = fields.ebay_submit_status

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}

      {/* Modified notice */}
      {modified.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(77,166,255,0.08)', border: '1px solid var(--blue)', borderRadius: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--blue)' }}>Fields modified — save as-is or re-run research.</span>
          <button className="btn btn-blue btn-sm" onClick={reprocess}>Re-run Research</button>
        </div>
      )}

      {/* Top section */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <PhotoStrip photos={photos} activeIndex={activePhoto} onSelect={setActivePhoto} />
        {photos[activePhoto] && (
          <div style={{ width: 170, height: 170, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--surface2)' }}>
            <img src={api.photoUrl(photos[activePhoto].filename)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            style={{ fontFamily: 'Bebas Neue', fontSize: 22, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', outline: 'none', width: '100%', padding: '4px 0' }}
            value={fields.title || ''}
            onChange={(e) => change('title', e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {extracted.exclusive && <span className="badge badge-needs_review">{extracted.exclusive}</span>}
            {extracted.edition && extracted.edition !== 'Standard' && <span className="badge badge-approved">{extracted.edition}</span>}
            <span className="badge badge-queued">{fields.condition}</span>
            {extracted.box_number && <span className="badge badge-queued mono">#{extracted.box_number}</span>}
          </div>
          {/* Confidence */}
          {fields.confidence != null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
                <span>CONFIDENCE</span><span style={{ color: fields.confidence >= 70 ? 'var(--green)' : 'var(--red)' }}>{fields.confidence}%</span>
              </div>
              <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${fields.confidence}%`, background: fields.confidence >= 70 ? 'var(--green)' : 'var(--red)', borderRadius: 2 }} />
              </div>
            </div>
          )}
          {/* Price */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text3)', fontSize: 13 }}>CA$</span>
            <input
              style={{ fontFamily: 'Bebas Neue', fontSize: 28, color: 'var(--gold)', background: 'transparent', border: 'none', outline: 'none', width: 100 }}
              type="number"
              step="0.01"
              value={fields.price || ''}
              onChange={(e) => change('price', parseFloat(e.target.value) || 0)}
            />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              ${fields.price_low?.toFixed(2)} – ${fields.price_high?.toFixed(2)} sold
            </span>
          </div>
        </div>
      </div>

      {/* Market Research */}
      <div className="card">
        <div className="card-header"><span className="card-title">MARKET RESEARCH</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1, background: 'var(--border)' }}>
          {[
            { label: 'Avg Sold', value: `CA$${fields.price_avg?.toFixed(2)}` },
            { label: 'Price Range', value: `$${fields.price_low?.toFixed(2)}–$${fields.price_high?.toFixed(2)}` },
            { label: 'Recent Sales', value: fields.recent_sales },
            { label: 'Sell-through', value: `${fields.sell_through}%` },
            { label: 'Your Price', value: `CA$${fields.price?.toFixed(2)}`, highlight: true },
          ].map((stat) => (
            <div key={stat.label} style={{ background: 'var(--surface)', padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.08em', marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontFamily: 'Bebas Neue', fontSize: 18, color: stat.highlight ? 'var(--gold)' : 'var(--text)' }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Identification */}
      {profileFields.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">IDENTIFICATION</span></div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {profileFields.filter((f) => f.key !== 'upc').map((f) => (
              <FieldInput
                key={f.key}
                label={f.label}
                field={f.key}
                value={extracted[f.key] ?? ''}
                onChange={changeExtracted}
                required={f.required}
                recommended={f.recommended}
                mono={f.mono}
                hint={f.hint}
                options={f.options}
                type={f.type === 'number' ? 'number' : 'text'}
                modified={modified.has('extracted_data')}
              />
            ))}
          </div>
        </div>
      )}

      {/* Listing Details */}
      <div className="card">
        <div className="card-header"><span className="card-title">LISTING DETAILS</span></div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <FieldInput label="Condition" field="condition" value={fields.condition} onChange={change} options={CONDITIONS} required modified={modified.has('condition')} />
          <FieldInput label="Quantity" field="quantity" value={fields.quantity} onChange={change} type="number" required modified={modified.has('quantity')} />
          <FieldInput label="Category ID" field="category_id" value={fields.category_id} onChange={change} required mono modified={modified.has('category_id')} />
          <FieldInput label="SKU" field="sku" value={fields.sku} onChange={change} mono modified={modified.has('sku')} />
          <FieldInput label="UPC" field="upc" value={fields.upc || ''} onChange={change} mono recommended modified={modified.has('upc')} />
          <FieldInput label="Best Offer" field="best_offer" value={fields.best_offer ? 'TRUE' : 'FALSE'} onChange={(k, v) => change(k, v === 'TRUE')} options={['TRUE', 'FALSE']} modified={modified.has('best_offer')} />
          <FieldInput label="Auto-Accept (CA$)" field="best_offer_accept" value={fields.best_offer_accept} onChange={change} type="number" modified={modified.has('best_offer_accept')} />
          <FieldInput label="Auto-Decline (CA$)" field="best_offer_decline" value={fields.best_offer_decline} onChange={change} type="number" modified={modified.has('best_offer_decline')} />
          {fields.condition === 'Used' && (
            <FieldInput label="Condition Note" field="condition_note" value={fields.condition_note || ''} onChange={change} multiline span2 modified={modified.has('condition_note')} />
          )}
          <FieldInput label="Description" field="description" value={fields.description} onChange={change} multiline span2 modified={modified.has('description')} />
        </div>
      </div>

      {/* Shipping */}
      <div className="card">
        <div className="card-header"><span className="card-title">SHIPPING</span></div>
        <ShippingSection shipping={fields.shipping || {}} onChange={(v) => change('shipping', v)} />
      </div>

      {/* Package */}
      <div className="card">
        <div className="card-header"><span className="card-title">PACKAGE DIMENSIONS</span></div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <FieldInput label="Length (cm)" field="pkg_length_cm" value={fields.pkg_length_cm} onChange={change} type="number" modified={modified.has('pkg_length_cm')} />
          <FieldInput label="Width (cm)" field="pkg_width_cm" value={fields.pkg_width_cm} onChange={change} type="number" modified={modified.has('pkg_width_cm')} />
          <FieldInput label="Depth (cm)" field="pkg_depth_cm" value={fields.pkg_depth_cm} onChange={change} type="number" modified={modified.has('pkg_depth_cm')} />
          <FieldInput label="Weight (g)" field="weight_grams" value={fields.weight_grams} onChange={change} type="number" modified={modified.has('weight_grams')} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, paddingTop: 4, paddingBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-gold btn-lg" onClick={approve} disabled={approving} style={{ flex: 1 }}>
          {approving ? <><div className="spinner spinner-sm" style={{ borderTopColor: '#000' }} /> Saving…</> : '✓ Approve & Save'}
        </button>
        <button className="btn btn-blue" onClick={reprocess}>⟳ Re-run Research</button>
        <button className="btn btn-outline" onClick={reset} disabled={modified.size === 0}>↺ Reset</button>
        {isApproved && (
          <button
            className="btn btn-green"
            onClick={submitToEbay}
            disabled={ebaySubmitting || existingEbayStatus === 'submitting'}
            title="Open Chromium, fill the eBay listing form, and save a draft"
          >
            {(ebaySubmitting || existingEbayStatus === 'submitting')
              ? <><div className="spinner spinner-sm" /> Submitting…</>
              : existingEbayUrl ? '✓ Re-list on eBay' : '↑ List on eBay'}
          </button>
        )}
      </div>

      {/* eBay draft link */}
      {existingEbayUrl && (
        <div style={{ paddingBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>eBay draft:</span>
          <a
            href={existingEbayUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 13, color: 'var(--green)', wordBreak: 'break-all' }}
          >
            {existingEbayUrl}
          </a>
        </div>
      )}
      {existingEbayStatus === 'error' && !existingEbayUrl && (
        <div style={{ paddingBottom: 16, fontSize: 12, color: 'var(--red)' }}>
          eBay submission failed. Check that Chromium is installed and you are connected (Settings → General).
        </div>
      )}
    </div>
  )
}
