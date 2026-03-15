import { FieldInput } from './FieldInput'

const DOMESTIC_SERVICES = [
  { code: 'CanadaPostExpeditedParcel', label: 'Expedited Parcel', days: '2–8 days', tracked: true },
  { code: 'CanadaPostRegularParcel', label: 'Regular Parcel', days: '4–10 days', tracked: true },
  { code: 'CanadaPostXpresspost', label: 'Xpresspost', days: '1–5 days', tracked: true },
]

const USA_SERVICES = [
  { code: 'CanadaPostTrackedPacketUSA', label: 'Tracked Packet USA', days: '6–10 days', tracked: true },
  { code: 'CanadaPostExpeditedParcelUSA', label: 'Expedited Parcel USA', days: '4–7 days', tracked: true },
  { code: 'CanadaPostXpresspostUSA', label: 'Xpresspost USA', days: '2–3 days', tracked: true },
  { code: 'CanadaPostSmallPacketUSAAir', label: 'Small Packet USA Air', days: '8–12 days', tracked: false },
]

const INTL_SERVICES = [
  { code: 'CanadaPostTrackedPacketIntl', label: 'Tracked Packet Intl', days: '6–10 days', tracked: true },
  { code: 'CanadaPostIntlParcelAir', label: 'Intl Parcel Air', days: '4–7 days', tracked: true },
  { code: 'CanadaPostXpresspostIntl', label: 'Xpresspost Intl', days: '4–7 days', tracked: true },
  { code: 'CanadaPostSmallPacketIntlAir', label: 'Small Packet Intl Air', days: '4–10+ weeks', tracked: false },
]

function ZoneColumn({ title, flag, services, zone, data = {}, onChange }) {
  const selected = services.find((s) => s.code === data.service) || services[0]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 600, color: 'var(--text2)', fontSize: 13 }}>{flag} {title}</div>
      <div className="field">
        <label className="field-label">Service</label>
        <select
          className="field-input"
          value={data.service || services[0].code}
          onChange={(e) => onChange?.(zone, { ...data, service: e.target.value })}
        >
          {services.map((s) => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{selected.days}</div>
      <div className="field">
        <label className="field-label">
          <input
            type="checkbox"
            checked={!!data.free}
            onChange={(e) => onChange?.(zone, { ...data, free: e.target.checked })}
            style={{ marginRight: 4 }}
          />
          Free shipping
        </label>
      </div>
      {!data.free && (
        <div className="field">
          <label className="field-label">Price (CAD)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text3)', fontSize: 13 }}>CA$</span>
            <input
              className="field-input mono"
              type="number"
              step="0.01"
              value={data.price ?? ''}
              onChange={(e) => onChange?.(zone, { ...data, price: parseFloat(e.target.value) || 0 })}
              style={{ width: 80 }}
            />
          </div>
        </div>
      )}
      {!selected.tracked && (
        <div style={{ fontSize: 11, color: 'var(--red)' }}>⚠ No tracking — risky for eBay</div>
      )}
    </div>
  )
}

export function ShippingSection({ shipping = {}, onChange }) {
  const update = (zone, val) => onChange?.({ ...shipping, [zone]: val })
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, padding: 16 }}>
        <ZoneColumn title="Domestic" flag="🇨🇦" services={DOMESTIC_SERVICES} zone="domestic" data={shipping.domestic} onChange={update} />
        <ZoneColumn title="USA" flag="🇺🇸" services={USA_SERVICES} zone="usa" data={shipping.usa} onChange={update} />
        <ZoneColumn title="International" flag="🌍" services={INTL_SERVICES} zone="intl" data={shipping.intl} onChange={update} />
      </div>
      <div style={{ padding: '8px 16px 12px', fontSize: 11, color: 'var(--text3)', borderTop: '1px solid var(--border)' }}>
        Consumer prices before tax. 19.5% fuel surcharge applies. Verify at canadapost.ca/prices.
      </div>
    </div>
  )
}
