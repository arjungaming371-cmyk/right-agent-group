"use client"

import { useState } from "react"
import { Calculator, ArrowRight, TrendingUp, DollarSign, Clock, Users, CheckCircle2 } from "lucide-react"
import Link from "next/link"

export default function RoiCalculator() {
  const [leadsPerMonth, setLeadsPerMonth] = useState<number>(2000)
  const [avgTicketSize, setAvgTicketSize] = useState<number>(500000) // ₹5 Lakhs avg loan
  const [commissionRate, setCommissionRate] = useState<number>(2.0) // 2% DSA payout

  // 1 human telecaller handles ~80 connected calls/day = ~1,600 calls/month
  const humanAgentsNeeded = Math.max(1, Math.ceil(leadsPerMonth / 1000))
  const humanSalaryPerAgent = 22000
  const humanOverheadPerAgent = 5000 // infrastructure, phone lines, seat cost
  const totalHumanCost = humanAgentsNeeded * (humanSalaryPerAgent + humanOverheadPerAgent)

  // AI calling cost: ~1.5 min connected call @ ₹5/min = ₹7.5 per connected lead
  const aiCallingCost = Math.round(leadsPerMonth * 7.5)
  const platformNumberCost = 649 // dedicated ExoPhone / Vobiz line
  const totalAiCost = aiCallingCost + platformNumberCost

  // Savings
  const monthlySavings = Math.max(0, totalHumanCost - totalAiCost)
  const annualSavings = monthlySavings * 12

  // Revenue boost: Priya calls within 10 seconds, converting ~25% more leads than human callers reaching leads after 3 hours
  const recoveredLoansPerMonth = Math.round(leadsPerMonth * 0.015) // +1.5% absolute conversion boost
  const additionalDisbursalVolume = recoveredLoansPerMonth * avgTicketSize
  const additionalCommission = Math.round(additionalDisbursalVolume * (commissionRate / 100))

  return (
    <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 clamp(18px, 4vw, 40px)" }}>
      <div
        className="rg-glass"
        style={{
          padding: "clamp(24px, 4vw, 40px)",
          borderRadius: 24,
          border: "1px solid rgba(56,189,248,0.2)",
          background: "linear-gradient(180deg, rgba(14,19,32,0.85) 0%, rgba(8,12,20,0.95) 100%)",
          boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8), 0 0 40px -10px rgba(56,189,248,0.1)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div className="rg-eyebrow" style={{ borderColor: "rgba(56,189,248,0.3)", background: "rgba(56,189,248,0.1)", color: "#38bdf8", marginBottom: 12 }}>
            <Calculator size={13} />
            Lender & DSA ROI Estimator
          </div>
          <h2 className="rg-h2" style={{ margin: "0 0 10px" }}>
            See How Much You Save & Disburse with Priya
          </h2>
          <p className="rg-lead" style={{ margin: "0 auto", maxWidth: 640 }}>
            Compare your current human telecalling payroll against 24/7 instant AI calling. No salaries, zero attrition, and zero missed loan leads.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 32, alignItems: "center" }}>
          {/* Controls / Sliders */}
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {/* Leads per month */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>Monthly Loan Leads</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>
                  {leadsPerMonth.toLocaleString("en-IN")} leads
                </span>
              </div>
              <input
                type="range"
                min={200}
                max={20000}
                step={100}
                value={leadsPerMonth}
                onChange={(e) => setLeadsPerMonth(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#38bdf8", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#727e9c", marginTop: 4 }}>
                <span>200 leads</span>
                <span>10,000</span>
                <span>20,000+</span>
              </div>
            </div>

            {/* Average Loan Ticket Size */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>Average Loan Amount</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#a5b0ff", fontVariantNumeric: "tabular-nums" }}>
                  ₹{(avgTicketSize / 100000).toFixed(1)} Lakhs
                </span>
              </div>
              <input
                type="range"
                min={100000}
                max={5000000}
                step={50000}
                value={avgTicketSize}
                onChange={(e) => setAvgTicketSize(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#8b7cff", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#727e9c", marginTop: 4 }}>
                <span>₹1 Lakh</span>
                <span>₹25 Lakhs</span>
                <span>₹50 Lakhs</span>
              </div>
            </div>

            {/* Commission Rate */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#fff" }}>Payout / DSA Commission</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#2dd4a0", fontVariantNumeric: "tabular-nums" }}>
                  {commissionRate}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5.0}
                step={0.25}
                value={commissionRate}
                onChange={(e) => setCommissionRate(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#2dd4a0", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "#727e9c", marginTop: 4 }}>
                <span>0.5% (Home Loans)</span>
                <span>2.0% (Personal)</span>
                <span>5.0% (Business/Unsecured)</span>
              </div>
            </div>

            {/* Micro Highlights */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgba(255,255,255,0.03)", padding: "12px 16px", borderRadius: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#c6cede" }}>
                <Clock size={14} color="#38bdf8" />
                <span>Response Speed: <strong>Instant (&lt;10s)</strong> vs 3.5 hrs manual delay</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#c6cede" }}>
                <Users size={14} color="#8b7cff" />
                <span>Equivalent Staff: Replaces <strong>{humanAgentsNeeded} human telecallers</strong></span>
              </div>
            </div>
          </div>

          {/* Results Card */}
          <div
            style={{
              background: "linear-gradient(135deg, rgba(20,28,48,0.9) 0%, rgba(10,15,28,0.95) 100%)",
              border: "1px solid rgba(139,124,255,0.3)",
              borderRadius: 20,
              padding: 26,
              boxShadow: "0 16px 40px -15px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#a5b0ff", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Net Financial Advantage
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "#fff", lineHeight: 1.1, marginBottom: 4 }}>
              ₹{monthlySavings.toLocaleString("en-IN")}{" "}
              <span style={{ fontSize: 14, color: "#9aa5bd", fontWeight: 500 }}>/ month saved</span>
            </div>
            <div style={{ fontSize: 13, color: "#2dd4a0", fontWeight: 600, marginBottom: 20 }}>
              ≈ ₹{annualSavings.toLocaleString("en-IN")} direct cost reduction per year
            </div>

            {/* Breakdown Comparison */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#9aa5bd" }}>Human Calling Floor ({humanAgentsNeeded} agents)</span>
                <span style={{ color: "#f43f5e", fontWeight: 600 }}>₹{totalHumanCost.toLocaleString("en-IN")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#9aa5bd" }}>Right Agent Group AI Calling</span>
                <span style={{ color: "#2dd4a0", fontWeight: 600 }}>₹{totalAiCost.toLocaleString("en-IN")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "#9aa5bd" }}>Cost per Connected Lead</span>
                <span style={{ color: "#38bdf8", fontWeight: 600 }}>₹7.50 only</span>
              </div>
            </div>

            {/* Revenue Upside */}
            <div
              style={{
                background: "rgba(45,212,160,0.08)",
                border: "1px solid rgba(45,212,160,0.25)",
                borderRadius: 14,
                padding: "14px 16px",
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#2dd4a0", marginBottom: 2 }}>
                <TrendingUp size={14} />
                Additional Revenue from &lt;10s Response
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
                +₹{additionalCommission.toLocaleString("en-IN")} / mo
              </div>
              <div style={{ fontSize: 11.5, color: "#c6cede", marginTop: 2 }}>
                From ~{recoveredLoansPerMonth} extra closed disbursals that normally drop off.
              </div>
            </div>

            {/* CTA */}
            <Link
              href="/demo"
              className="rg-btn rg-btn-primary"
              style={{ width: "100%", textDecoration: "none" }}
            >
              <span>Test Priya On Your Number Now</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
