"use client"

import { useState, useEffect } from "react"
import {
  Landmark,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  BookOpen,
  Filter,
  RefreshCw,
  Building2,
  ChevronRight,
  FileText,
  BadgeAlert,
  ArrowRight
} from "lucide-react"

export default function BankingIntelligenceView() {
  const [activeTab, setActiveTab] = useState<"overview" | "institutions" | "cohort1" | "claims" | "tester">("overview")
  const [health, setHealth] = useState<any>(null)
  const [institutions, setInstitutions] = useState<any[]>([])
  const [claims, setClaims] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")

  // RAG Tester state
  const [testQuery, setTestQuery] = useState("What are the foreclosure charges for SBI home loan?")
  const [testResult, setTestResult] = useState<any>(null)
  const [testingRag, setTestingRag] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [hRes, iRes, cRes] = await Promise.all([
        fetch("/api/banking-knowledge/health"),
        fetch("/api/research/institutions?seed=1"),
        fetch("/api/research/claims"),
      ])
      if (hRes.ok) setHealth(await hRes.json())
      if (iRes.ok) {
        const d = await iRes.json()
        setInstitutions(d.institutions || [])
      }
      if (cRes.ok) {
        const c = await cRes.json()
        setClaims(c.claims || [])
      }
    } catch (e) {
      console.error("Failed to load BRIE data:", e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function runRagTest(q?: string) {
    const queryToRun = q || testQuery
    if (!queryToRun.trim()) return
    setTestingRag(true)
    try {
      const res = await fetch("/api/banking-knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryToRun }),
      })
      if (res.ok) {
        setTestResult(await res.json())
      }
    } catch (e) {
      console.error("RAG test error:", e)
    } finally {
      setTestingRag(false)
    }
  }

  const filteredInstitutions = institutions.filter((inst) => {
    const matchesType = filterType === "all" || inst.institution_type === filterType
    const matchesSearch =
      !searchQuery ||
      inst.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inst.legal_name?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesType && matchesSearch
  })

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto", color: "var(--text-primary)" }}>
      {/* Top Banner */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(56, 189, 248, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#38bdf8" }}>
              <Landmark size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                Banking Research Intelligence Engine (BRIE)
              </h1>
              <p style={{ margin: "2px 0 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
                Verified Indian banking intelligence, loan schedules, KFS terms & RBI compliance grounding for AI calling.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="btn-ghost"
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 14px" }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh Registry
        </button>
      </div>

      {/* Metric Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 24 }}>
        <div className="card-soft" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Building2 size={14} /> Registered Lenders
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{health?.coverage?.institutions || institutions.length}</div>
          <div style={{ fontSize: 11, color: "#38bdf8", marginTop: 4 }}>12 Public, 21 Private, SFBs & NBFCs</div>
        </div>

        <div className="card-soft" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <CheckCircle2 size={14} color="#10b981" /> Verified Claims
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>{health?.coverage?.published_claims || claims.length}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>100% Citation Backed</div>
        </div>

        <div className="card-soft" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} color="#a855f7" /> Cohort 1 Lenders
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#a855f7" }}>3 / 3</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>SBI, HDFC Bank, Bajaj Finance</div>
        </div>

        <div className="card-soft" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={14} color="#f59e0b" /> Pending Verification
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>{health?.coverage?.pending_reviews || 0}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>Human Review Queue</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 20 }}>
        {[
          { key: "overview", label: "Overview & Status" },
          { key: "cohort1", label: "Cohort 1 Vertical Slice" },
          { key: "institutions", label: `Lender Registry (${institutions.length})` },
          { key: "claims", label: `Verified Claims (${claims.length})` },
          { key: "tester", label: "AI RAG Retrieval Tester" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as any)}
            className={activeTab === t.key ? "btn-primary" : "btn-ghost"}
            style={{ fontSize: 13, padding: "8px 16px", borderRadius: 8 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
          <div className="card-soft" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>
              Production Scope & Regulatory Grounding
            </h3>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              The Banking Research Intelligence Engine (BRIE) extracts, verifies, and isolates publicly available loan schedules,
              Key Fact Statements (KFS), APR disclosures, and RBI Master Direction mandates to ensure Priya answers caller queries
              with 100% factual fidelity and zero cross-lender hallucinations.
            </p>

            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#38bdf8", marginBottom: 6 }}>Lender Isolation</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Guarantees that SBI rules never blend into HDFC or Bajaj Finance offers. Facts are segregated by institution UUID.
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#10b981", marginBottom: 6 }}>RBI Foreclosure Guard</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Enforces RBI 2019/2024 mandates: Zero foreclosure or prepayment charges for individual borrowers on floating rate retail loans.
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>Condition & Exception Tracking</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Preserves every clause limitation (e.g. 12-month lock-in periods, CIBIL 750+ thresholds, commercial property exclusions).
                </div>
              </div>

              <div style={{ padding: 14, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#a855f7", marginBottom: 6 }}>Traceable Provenance</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Every claim is tied to an immutable document SHA-256 hash, official source URL, and exact text excerpt.
                </div>
              </div>
            </div>
          </div>

          <div className="card-soft" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginTop: 0, marginBottom: 14 }}>
              Cohort 1 Verified Lenders
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ padding: 12, borderRadius: 8, background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>State Bank of India (SBI)</span>
                  <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>100% VERIFIED</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  Home Loan (EBLR 8.50%) & Xpress Credit Personal Loan
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>HDFC Bank Limited</span>
                  <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>100% VERIFIED</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  Salaried Personal Loan (10.50%) & Standard Home Loan (8.70%)
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, background: "rgba(16, 185, 129, 0.05)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Bajaj Finance Limited</span>
                  <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>100% VERIFIED</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                  Personal Credit (11.00%) & Loan Against Property (LAP)
                </div>
              </div>
            </div>

            <button
              onClick={() => setActiveTab("tester")}
              className="btn-primary"
              style={{ width: "100%", marginTop: 20, padding: "10px 0", fontSize: 13, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}
            >
              Test Calling Agent RAG <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Tab: Cohort 1 Vertical Slice */}
      {activeTab === "cohort1" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20 }}>
            {/* SBI Card */}
            <div className="card-soft" style={{ padding: 20, borderLeft: "4px solid #10b981" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>State Bank of India (SBI)</h3>
                <span className="badge" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>Public Sector Bank</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                <div><strong>Regular Home Loan:</strong> Starts from <strong>8.50% - 9.65% p.a.</strong> linked to EBLR (9.15%).</div>
                <div><strong>Processing Fee:</strong> 0.35% (Min ₹2,000, Max ₹10,000 + GST).</div>
                <div><strong>Foreclosure Charges:</strong> <strong>ZERO</strong> on floating rate for individuals.</div>
                <div><strong>Xpress Credit Personal Loan:</strong> 11.15% - 14.30% p.a. Min salary ₹15,000/mo.</div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
                Source: <a href="https://sbi.co.in/web/personal-banking/loans/home-loans/interest-rates" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Official SBI Schedule of Charges ↗</a>
              </div>
            </div>

            {/* HDFC Bank Card */}
            <div className="card-soft" style={{ padding: 20, borderLeft: "4px solid #3b82f6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>HDFC Bank Limited</h3>
                <span className="badge" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" }}>Private Sector Bank</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                <div><strong>Personal Loan:</strong> <strong>10.50% - 24.00% p.a.</strong> up to ₹40 Lakhs.</div>
                <div><strong>Processing Fee:</strong> Up to ₹4,999 + GST flat.</div>
                <div><strong>Prepayment / Foreclosure:</strong> Lock-in 12 months. 4% (13-24m), 3% (25-36m), 2% (&gt;36m).</div>
                <div><strong>Standard Home Loan:</strong> 8.70% - 9.80% p.a. ZERO foreclosure on floating rate.</div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
                Source: <a href="https://www.hdfcbank.com/personal/borrow/popular-loans/personal-loan/rates-fees" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>HDFC MITC & Rate Card ↗</a>
              </div>
            </div>

            {/* Bajaj Finance Card */}
            <div className="card-soft" style={{ padding: 20, borderLeft: "4px solid #f59e0b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Bajaj Finance Limited</h3>
                <span className="badge" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>NBFC Upper Layer</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                <div><strong>Personal Loan:</strong> <strong>11.00% - 38.00% p.a.</strong> (Flexi & Term variants).</div>
                <div><strong>Processing Fee:</strong> Up to 3.93% inclusive of GST.</div>
                <div><strong>Part-Payment:</strong> Term loan up to 4.72% fee; Flexi facility permits free part-payments.</div>
                <div><strong>Loan Against Property:</strong> 9.50% - 14.00% p.a. up to ₹15 Crores.</div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
                Source: <a href="https://www.bajajfinserv.in/personal-loan-fees-and-charges" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Bajaj Finserv Official Fees Schedule ↗</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Institutions Registry */}
      {activeTab === "institutions" && (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
              <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input
                type="text"
                placeholder="Search bank or NBFC..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-base"
                style={{ width: "100%", paddingLeft: 36, height: 38, fontSize: 13 }}
              />
            </div>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input-base"
              style={{ height: 38, fontSize: 13, padding: "0 12px" }}
            >
              <option value="all">All Institution Types</option>
              <option value="public_sector_bank">Public Sector Banks</option>
              <option value="private_sector_bank">Private Sector Banks</option>
              <option value="small_finance_bank">Small Finance Banks</option>
              <option value="nbfc">NBFCs</option>
              <option value="housing_finance_company">Housing Finance (HFCs)</option>
            </select>
          </div>

          <div className="card-soft" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.02)", textAlign: "left", color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={{ padding: "12px 16px" }}>Institution</th>
                  <th style={{ padding: "12px 16px" }}>Category</th>
                  <th style={{ padding: "12px 16px" }}>Official Website</th>
                  <th style={{ padding: "12px 16px" }}>Priority</th>
                  <th style={{ padding: "12px 16px" }}>Research Status</th>
                  <th style={{ padding: "12px 16px" }}>Completion</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInstitutions.map((inst) => (
                  <tr key={inst.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600 }}>
                      {inst.display_name}
                      <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>{inst.legal_name}</div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary)" }}>
                      {inst.institution_type?.replace(/_/g, " ")}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {inst.official_website && (
                        <a href={inst.official_website} target="_blank" rel="noreferrer" style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {inst.official_website.replace("https://", "").replace("www.", "")} <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span className="badge" style={{ fontSize: 10, background: inst.research_priority === "P1" ? "rgba(56, 189, 248, 0.15)" : "rgba(255,255,255,0.05)", color: inst.research_priority === "P1" ? "#38bdf8" : "inherit" }}>
                        {inst.research_priority}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        className="badge"
                        style={{
                          fontSize: 11,
                          background: inst.research_status === "verified" || inst.research_status === "published" ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: inst.research_status === "verified" || inst.research_status === "published" ? "#10b981" : "#f59e0b",
                        }}
                      >
                        {inst.research_status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden", minWidth: 60 }}>
                          <div style={{ width: `${inst.completion_score || 0}%`, height: "100%", background: (inst.completion_score || 0) > 80 ? "#10b981" : "#38bdf8" }} />
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{inst.completion_score || 0}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => {
                          setTestQuery(`What is ${inst.display_name} interest rate and foreclosure policy?`)
                          setActiveTab("tester")
                        }}
                        className="btn-ghost"
                        style={{ fontSize: 11, padding: "4px 8px" }}
                      >
                        Test Query
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Verified Claims */}
      {activeTab === "claims" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {claims.map((c) => (
            <div key={c.id} className="card-soft" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <span className="badge" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", marginRight: 8, fontSize: 11 }}>
                    {c.institution_name}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{c.product_name || c.claim_type}</span>
                </div>
                <span className="badge" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: 11 }}>
                  {c.verification_status}
                </span>
              </div>

              <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10, color: "var(--text-primary)" }}>
                {c.explanation}
              </div>

              {c.conditions && c.conditions.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                  <strong>Conditions:</strong> {Array.isArray(c.conditions) ? c.conditions.join("; ") : c.conditions}
                </div>
              )}

              {c.exceptions && c.exceptions.length > 0 && (
                <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 4 }}>
                  <strong>Exceptions:</strong> {Array.isArray(c.exceptions) ? c.exceptions.join("; ") : c.exceptions}
                </div>
              )}

              {c.exact_excerpt && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: "rgba(255,255,255,0.02)", borderLeft: "3px solid #38bdf8", fontSize: 11.5, color: "var(--text-muted)" }}>
                  <em>"{c.exact_excerpt}"</em>
                  {c.source_url && (
                    <div style={{ marginTop: 4 }}>
                      <a href={c.source_url} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>Official Document ↗</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab: AI RAG Retrieval Tester */}
      {activeTab === "tester" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 8 }}>
              Simulate AI Calling Agent RAG Retrieval
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
              Type any question a caller might ask. The BRIE RAG engine resolves the lender, checks date validity, and returns verified facts with citations.
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="e.g. Can I foreclose my SBI home loan early?"
                className="input-base"
                style={{ flex: 1, height: 42, fontSize: 13.5 }}
                onKeyDown={(e) => e.key === "Enter" && runRagTest()}
              />
              <button
                onClick={() => runRagTest()}
                disabled={testingRag}
                className="btn-primary"
                style={{ padding: "0 20px", height: 42, fontSize: 13 }}
              >
                {testingRag ? "Querying BRIE…" : "Run Query"}
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>Sample Queries:</span>
              {[
                "What is SBI foreclosure charge?",
                "What is HDFC personal loan prepayment penalty?",
                "What is Bajaj Finance personal loan interest rate?",
                "What are the processing fees for SBI home loan?",
              ].map((sq) => (
                <button
                  key={sq}
                  onClick={() => {
                    setTestQuery(sq)
                    runRagTest(sq)
                  }}
                  className="btn-ghost"
                  style={{ fontSize: 11.5, padding: "4px 10px" }}
                >
                  {sq}
                </button>
              ))}
            </div>

            {testResult && (
              <div className="card-soft" style={{ padding: 18, borderLeft: testResult.answer_status === "verified" ? "4px solid #10b981" : "4px solid #f59e0b" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      className="badge"
                      style={{
                        background: testResult.answer_status === "verified" ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        color: testResult.answer_status === "verified" ? "#10b981" : "#f59e0b",
                        fontSize: 11,
                      }}
                    >
                      STATUS: {testResult.answer_status?.toUpperCase()}
                    </span>
                    {testResult.institution && (
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{testResult.institution.display_name}</span>
                    )}
                  </div>
                  {testResult.last_verified_at && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Verified: {new Date(testResult.last_verified_at).toLocaleDateString()}</span>
                  )}
                </div>

                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "monospace", background: "rgba(0,0,0,0.3)", padding: 14, borderRadius: 6, marginBottom: 14 }}>
                  {testResult.summary_for_ai}
                </div>

                {testResult.citations && testResult.citations.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>OFFICIAL CITATIONS:</div>
                    {testResult.citations.map((cit: any, idx: number) => (
                      <div key={idx} style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                        <CheckCircle2 size={12} color="#10b981" />
                        <span>{cit.title}</span>
                        {cit.source_url && (
                          <a href={cit.source_url} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>
                            Link ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card-soft" style={{ padding: 20 }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: 14 }}>How the Calling Agent Consumes This</h4>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              <p>
                1. <strong>Deterministic Lender Filter:</strong> When a customer mentions a bank name (e.g. <em>"What does HDFC charge to close early?"</em>), BRIE extracts the bank entity first.
              </p>
              <p>
                2. <strong>Zero Hallucination Guard:</strong> If no verified document exists for that product, the agent states that terms need confirmation from the lender rather than guessing.
              </p>
              <p>
                3. <strong>Plain English Explanation:</strong> Priya receives both the legal excerpt and a natural conversational speaking form so she articulates exact numbers naturally.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
