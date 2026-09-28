"use client"

// PUBLIC EMI calculator for the landing page. The marketing copy above it
// says "EMI math is computed, never guessed" — this widget is that promise
// in UI form. It runs the EXACT same lib/finance.ts functions the call AI
// uses (calculateEMI + amortizationSchedule), client-side, so the number a
// visitor plays with here is byte-identical to what Priya quotes on a live
// call. No fetch, no API round-trip: pure arithmetic is instant and cannot
// go down.

import { useMemo, useState } from "react"
import { calculateEMI, amortizationSchedule, flatToReducingAPR, formatINR } from "@/lib/finance"
import { pctOf } from "@/lib/maths"

const PANEL: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
  padding: "clamp(20px, 4vw, 32px)",
}

const LABEL: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  fontSize: 13,
  color: "#9aa5bd",
  marginBottom: 10,
}

const RANGE: React.CSSProperties = {
  width: "100%",
  accentColor: "#6d5cff",
  cursor: "pointer",
  height: 22,
}

function fmtYears(m: number) {
  const y = Math.floor(m / 12)
  const r = m % 12
  return r ? `${y}y ${r}m` : `${y}y`
}

export default function EmiCalculator() {
  const [amount, setAmount] = useState(2_000_000)
  const [years, setYears] = useState(20)
  const [rate, setRate] = useState(7.25)
  const [flat, setFlat] = useState<string>("")

  const tenureMonths = Math.round(years * 12)

  const calc = useMemo(() => amortizationSchedule(amount, rate, tenureMonths), [amount, rate, tenureMonths])
  const emi = calc.emi
  const interestShare = pctOf(calc.totalInterest, calc.totalPayable)
  const flatReducing = useMemo(() => {
    const f = parseFloat(flat)
    return Number.isFinite(f) && f > 0 ? flatToReducingAPR(f, tenureMonths) : null
  }, [flat, tenureMonths])

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 18, alignItems: "stretch" }}>
      {/* ---- Inputs ---- */}
      <div style={PANEL}>
        <div style={LABEL}>
          <span>Loan amount</span>
          <span style={{ color: "#e6eaf2", fontWeight: 700, fontSize: 16 }}>{formatINR(amount)}</span>
        </div>
        <input type="range" min={50_000} max={20_000_000} step={50_000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={RANGE} aria-label="Loan amount" />

        <div style={{ ...LABEL, marginTop: 22 }}>
          <span>Tenure</span>
          <span style={{ color: "#e6eaf2", fontWeight: 700, fontSize: 16 }}>{fmtYears(tenureMonths)}</span>
        </div>
        <input type="range" min={1} max={30} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} style={RANGE} aria-label="Tenure in years" />

        <div style={{ ...LABEL, marginTop: 22 }}>
          <span>Interest rate (reducing, % p.a.)</span>
          <span style={{ color: "#e6eaf2", fontWeight: 700, fontSize: 16 }}>{rate.toFixed(2)}%</span>
        </div>
        <input type="range" min={5} max={20} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} style={RANGE} aria-label="Interest rate" />

        <div style={{ ...LABEL, marginTop: 22 }}>
          <span>Bank quoted a flat rate? Cross-check it</span>
          {flatReducing !== null && (
            <span style={{ color: "#7dd3fc", fontWeight: 700, fontSize: 14 }}>{flat}% flat ≈ {flatReducing}% reducing</span>
          )}
        </div>
        <input
          type="number"
          min={0}
          max={40}
          step={0.5}
          value={flat}
          onChange={(e) => setFlat(e.target.value)}
          placeholder="e.g. 12"
          aria-label="Flat rate to convert"
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 10,
            padding: "10px 14px",
            color: "#e6eaf2",
            fontSize: 14,
            outline: "none",
          }}
        />
        <div style={{ fontSize: 11.5, color: "#6b7590", marginTop: 14, lineHeight: 1.5 }}>
          A flat rate charges interest on the FULL principal for the whole tenure. The reducing equivalent is always higher — this is the gap lenders don&apos;t volunteer.
        </div>
      </div>

      {/* ---- Results ---- */}
      <div style={{ ...PANEL, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 12.5, color: "#9aa5bd", letterSpacing: 0.4, textTransform: "uppercase" }}>Monthly EMI</div>
        <div style={{ fontSize: "clamp(34px, 5vw, 44px)", fontWeight: 800, fontVariantNumeric: "tabular-nums", background: "linear-gradient(135deg, #a5b0ff, #7dd3fc)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", lineHeight: 1.15 }}>
          {formatINR(emi)}
        </div>

        {/* principal vs interest split bar */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width: `${100 - interestShare}%`, background: "linear-gradient(90deg, #6d5cff, #4f46e5)" }} />
            <div style={{ width: `${interestShare}%`, background: "linear-gradient(90deg, #f59e0b, #f97316)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9aa5bd", marginTop: 8 }}>
            <span>Principal {formatINR(amount)}</span>
            <span style={{ color: "#fbbf24" }}>Interest {formatINR(calc.totalInterest)} ({interestShare}%)</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7590" }}>Total payable</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatINR(calc.totalPayable)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#6b7590" }}>Payments</div>
            <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{tenureMonths} months</div>
          </div>
        </div>

        {/* yearly schedule */}
        <div style={{ marginTop: 18, flex: 1, minHeight: 0, overflowY: "auto", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "#6b7590", textAlign: "right" }}>
                <th style={{ padding: "8px 12px", fontWeight: 500, textAlign: "left" }}>Year</th>
                <th style={{ padding: "8px 12px", fontWeight: 500 }}>Principal</th>
                <th style={{ padding: "8px 12px", fontWeight: 500 }}>Interest</th>
                <th style={{ padding: "8px 12px", fontWeight: 500 }}>Balance</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: "tabular-nums", textAlign: "right", color: "#c6cddd" }}>
              {calc.yearly.map((y) => (
                <tr key={y.year} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "7px 12px", textAlign: "left", color: "#9aa5bd" }}>{y.year}</td>
                  <td style={{ padding: "7px 12px" }}>{formatINR(y.principalPaid)}</td>
                  <td style={{ padding: "7px 12px", color: "#fbbf24" }}>{formatINR(y.interestPaid)}</td>
                  <td style={{ padding: "7px 12px" }}>{formatINR(y.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "#6b7590", marginTop: 10 }}>
          Real reducing-balance math — the same engine that powers Priya&apos;s live answers. Estimate only; final rates depend on your profile.
        </div>
      </div>
    </div>
  )
}
