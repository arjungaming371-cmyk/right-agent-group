"use client"
import { useEffect, useRef, useState } from "react"
import { ClipboardList, FolderUp, FileText, FileUp, PhoneCall, Play, Plus, RotateCcw, Square } from "lucide-react"
import { useToast } from "../ui/toast"

type UploadedFile = { id: string; filename: string; type: string; row_count: number; processed: number; status: string; created_at: string }
type Contact = { name: string; phone: string; language: string; product_interest: string; leadId: string }

// Live snapshot of a bulk campaign — mirrors lib/bulk-dialer.ts BulkRunSnapshot.
type BulkRun = {
  runId: string
  running: boolean
  stopRequested: boolean
  reason: string | null
  startedAt: number
  finishedAt: number | null
  claimed: number
  called: number
  failed: number
  skipped: number
  waves: number
  concurrency: number
  current: string[]
}
type QueueRowView = { id: string; name: string | null; phone: string; language: string | null; status: string; created_at: string }

const BULK_POLL_MS = 2500

export default function UploadView() {
  const toast = useToast()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [queueForm, setQueueForm] = useState({ name: "", phone: "", language: "telugu", product_interest: "Home Loan", notes: "" })
  const [preview, setPreview] = useState<{ uploadId: string; contacts: Contact[] } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const csvRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  // Batch calling controls (legacy "dial exactly N" one-shot)
  const [batchMode, setBatchMode] = useState<"sequential" | "parallel">("sequential")
  const [concurrency, setConcurrency] = useState(3)
  const [callLimit, setCallLimit] = useState(10)
  const [processing, setProcessing] = useState(false)
  const [queueCount, setQueueCount] = useState<number | null>(null)

  // Bulk campaign console (entire-queue runner)
  const [bulkMode, setBulkMode] = useState<"next" | "all">("all")
  const [bulkConcurrency, setBulkConcurrency] = useState(3)
  const [run, setRun] = useState<BulkRun | null>(null)
  const [queueCounts, setQueueCounts] = useState<Record<string, number>>({})
  const [queueRows, setQueueRows] = useState<QueueRowView[]>([])
  const [startBulk, setStartBulk] = useState(false)

  async function load() {
    const res = await fetch("/api/upload/list")
    if (res.ok) setFiles(await res.json())
    const qRes = await fetch("/api/outbound")
    if (qRes.ok) {
      const rows = await qRes.json()
      setQueueCount(rows.filter((r: any) => r.status === "pending").length)
      setQueueRows(rows)
    }
    await refreshBulkStatus()
  }

  // Live campaign status + DB queue counts + queue rows. Called on mount
  // and on every poll tick while a campaign is running.
  async function refreshBulkStatus() {
    try {
      const res = await fetch("/api/outbound/process")
      if (res.ok) {
        const data = await res.json()
        setRun(data.run)
        setQueueCounts(data.queue || {})
      }
      const qRes = await fetch("/api/outbound")
      if (qRes.ok) setQueueRows(await qRes.json())
    } catch { /* transient network blip — next poll will catch up */ }
  }

  useEffect(() => { load() }, [])

  // While a bulk campaign is running, poll status every 2.5s so the
  // progress bar, counters and queue table stay live.
  useEffect(() => {
    if (!run?.running) return
    const t = setInterval(refreshBulkStatus, BULK_POLL_MS)
    return () => clearInterval(t)
  }, [run?.running, run?.runId])

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>, type: string) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("type", type)
      const res = await fetch("/api/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (res.ok) {
        load()
        if (type === "contacts" && data.contacts?.length > 0) {
          setPreview({ uploadId: data.uploadId, contacts: data.contacts })
        } else {
          toast.success(`Uploaded — ${data.rowCount ?? ""} items processed`)
        }
      } else {
        toast.error(`Upload failed: ${data.error}`)
      }
    } catch {
      // Network failure — surface it, the busy state must always reset.
      toast.error("Upload failed — check your connection and try again")
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  async function confirmQueueing() {
    if (!preview) return
    setConfirming(true)
    try {
      const res = await fetch("/api/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: preview.contacts }),
      })
      const data = await res.json()
      if (res.ok) {
        const skippedNote = data.skipped ? ` — ${data.skipped} duplicate${data.skipped > 1 ? "s" : ""} skipped` : ""
        toast.success(`${data.queued} contacts queued${skippedNote} — use batch controls below to start calling`)
        load()
      } else {
        toast.error(data.error || "Queueing failed")
      }
    } catch {
      // Network failure — surface it, the busy state must always reset.
      toast.error("Queueing failed — check your connection and try again")
    } finally {
      setConfirming(false)
      setPreview(null)
    }
  }

  function cancelPreview() { setPreview(null) }

  async function addToQueue() {
    // FIX (2026-09-26): this form used to POST the single contact directly,
    // and the API's single-contact mode dials IMMEDIATELY — an agent filling
    // in "Add to Queue" made Priya call the customer right now, mid-typing,
    // with zero review. It now goes through the same queue-only batch path as
    // the CSV confirm: nothing dials until "Start Calling" below.
    const res = await fetch("/api/outbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: [{
        name: queueForm.name,
        phone: queueForm.phone,
        language: queueForm.language,
        product_interest: queueForm.product_interest,
        notes: queueForm.notes,
      }] }),
    })
    const d = await res.json()
    if (res.ok) {
      if (d.queued > 0) {
        toast.success(`Added to outbound queue${d.skipped ? " — was already queued, no duplicate created" : ""}`)
        setQueueForm({ name: "", phone: "", language: "telugu", product_interest: "Home Loan", notes: "" })
      } else {
        toast.error("Already in the queue — each number can wait in the queue only once")
      }
      load()
    }
    else { toast.error(d.error || "Could not add to queue") }
  }

  async function runBatch() {
    setProcessing(true)
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: batchMode === "sequential" ? 1 : concurrency, limit: callLimit }),
      })
      const data = await res.json()
      if (res.ok) toast.success(`Dialed ${data.called}/${data.total} calls (${data.failed} failed)`)
      else toast.error(data.error || "Batch calling failed")
    } catch {
      // Network failure — surface it, the busy state must always reset.
      toast.error("Batch calling failed — check your connection and try again")
    } finally {
      setProcessing(false)
      load()
    }
  }

  // ---- Bulk campaign (entire queue) -------------------------------------
  async function startBulkCampaign() {
    setStartBulk(true)
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", concurrency: bulkConcurrency }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`Bulk campaign started — Priya is dialing the entire queue, ${data.concurrency} call${data.concurrency > 1 ? "s" : ""} at a time`)
        await refreshBulkStatus()
      } else {
        toast.error(data.error || "Could not start the bulk campaign")
      }
    } catch {
      toast.error("Could not start the bulk campaign — check your connection and try again")
    } finally {
      setStartBulk(false)
    }
  }

  async function stopBulkCampaign() {
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      })
      const data = await res.json()
      if (res.ok && data.stopped) toast.success("Stopping after the current calls finish — remaining numbers stay pending")
      else if (res.ok) toast.error("No campaign is running")
      else toast.error(data.error || "Could not stop the campaign")
      await refreshBulkStatus()
    } catch {
      toast.error("Could not stop the campaign — check your connection and try again")
    }
  }

  async function retryFailed() {
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-failed" }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.reset} failed number${data.reset === 1 ? "" : "s"} moved back to pending — hit Call Entire Queue to dial them`)
        await refreshBulkStatus()
      } else toast.error(data.error || "Could not retry failed numbers")
    } catch {
      toast.error("Could not retry failed numbers — check your connection and try again")
    }
  }

  const STATUS_STYLE: Record<string, { color: string }> = {
    done: { color: "var(--accent-green)" }, processing: { color: "var(--accent-yellow)" }, pending: { color: "var(--accent-blue)" }, failed: { color: "var(--accent-red)" },
  }

  // Queue-status pill colors — outbound_queue statuses are free-form
  // strings (pending/dialing/called/failed/skipped_<compliance code>).
  function queueStatusColor(status: string) {
    if (status === "called") return "var(--accent-green)"
    if (status === "failed") return "var(--accent-red)"
    if (status === "pending") return "var(--accent-blue)"
    if (status === "dialing") return "var(--accent-yellow)"
    return "var(--text-muted)" // skipped_*
  }
  function queueStatusLabel(status: string) {
    if (status.startsWith("skipped_")) return `skipped (${status.slice(8).replace(/_/g, " ")})`
    return status
  }

  const qPending = queueCounts["pending"] ?? 0
  const qDialing = queueCounts["dialing"] ?? 0
  const qCalled = queueCounts["called"] ?? 0
  const qFailed = queueCounts["failed"] ?? 0
  const qSkipped = Object.entries(queueCounts).filter(([k]) => k.startsWith("skipped")).reduce((a, [, n]) => a + n, 0)

  const bulkProcessed = run ? run.called + run.failed + run.skipped : 0
  const bulkRemaining = qPending + qDialing
  const bulkPct = bulkProcessed + bulkRemaining > 0 ? Math.round((bulkProcessed / (bulkProcessed + bulkRemaining)) * 100) : 0
  const bulkElapsed = run?.startedAt ? Math.max(0, Math.floor(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)) : 0
  const showBulkProgress = !!run && (run.running || run.reason !== null)
  const BULK_REASON_TEXT: Record<string, string> = {
    drained: "Queue drained — every number was dialed",
    stopped: "Stopped — remaining numbers are still pending for the next run",
  }
  const bulkReason = run?.reason
    ? BULK_REASON_TEXT[run.reason] ?? (run.reason.startsWith("quota:") ? `Branch call cap reached — ${run.reason.slice(7)}` : run.reason)
    : null

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={16} strokeWidth={1.9} style={{ color: "var(--accent-violet)" }} /> Upload Contacts (CSV)</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>Upload a CSV with columns: name, phone, language, product_interest, notes</div>
          <div style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 28, textAlign: "center", cursor: "pointer", marginBottom: 12 }} onClick={() => csvRef.current?.click()}>
            <FolderUp size={30} strokeWidth={1.4} style={{ marginBottom: 8, color: "var(--text-muted)" }} />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Click to upload CSV</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Supports .csv — from Excel or Google Sheet: File → Download / Save As → CSV</div>
          </div>
          <input ref={csvRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => uploadFile(e, "contacts")} />
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><FileText size={16} strokeWidth={1.9} style={{ color: "var(--accent-cyan)" }} /> Upload AI Script / Document</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>Stored in the Knowledge Base — Priya references it live on calls. Word files: save as PDF first</div>
          <div style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 28, textAlign: "center", cursor: "pointer", marginBottom: 12 }} onClick={() => docRef.current?.click()}>
            <FileUp size={30} strokeWidth={1.4} style={{ marginBottom: 8, color: "var(--text-muted)" }} />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Click to upload script</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Supports .txt, .csv, .pdf</div>
          </div>
          <input ref={docRef} type="file" accept=".txt,.csv,.pdf" style={{ display: "none" }} onChange={(e) => uploadFile(e, "script")} />
        </div>
      </div>

      {/* Bulk calling console */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><PhoneCall size={16} strokeWidth={1.9} style={{ color: "var(--accent-green)" }} /> Bulk Calling</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          {queueCounts && Object.keys(queueCounts).length > 0
            ? <span>
                <b style={{ color: "var(--accent-blue)" }}>{qPending}</b> pending ·{" "}
                <b style={{ color: "var(--accent-green)" }}>{qCalled}</b> called ·{" "}
                <b style={{ color: "var(--accent-red)" }}>{qFailed}</b> failed ·{" "}
                <b style={{ color: "var(--text-muted)" }}>{qSkipped}</b> skipped (DND / compliance)
              </span>
            : queueCount !== null ? `${queueCount} contacts pending in the queue` : "Loading queue…"}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setBulkMode("all")} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", background: bulkMode === "all" ? "rgba(59,130,246,0.15)" : "transparent", color: bulkMode === "all" ? "var(--accent-blue)" : "var(--text-secondary)" }}>Call Entire Queue</button>
          <button onClick={() => setBulkMode("next")} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", background: bulkMode === "next" ? "rgba(59,130,246,0.15)" : "transparent", color: bulkMode === "next" ? "var(--accent-blue)" : "var(--text-secondary)" }}>Next N Numbers</button>
        </div>

        {bulkMode === "all" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end", marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Calls at once (1–10)</label>
                <input type="number" min={1} max={10} value={bulkConcurrency} onChange={(e) => setBulkConcurrency(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ maxWidth: 120 }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={startBulkCampaign} disabled={startBulk || !!run?.running || (Object.keys(queueCounts).length > 0 && qPending === 0)} className="btn-primary" style={{ height: 40, padding: "0 24px", fontSize: 14 }}>
                  <Play size={14} strokeWidth={2} fill="currentColor" /> {run?.running ? "Campaign Running…" : `Call Entire Queue (${qPending})`}
                </button>
                {run?.running && (
                  <button onClick={stopBulkCampaign} style={{ height: 40, padding: "0 20px", borderRadius: 8, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--accent-red)" }}>
                    <Square size={13} strokeWidth={2} fill="currentColor" /> Stop
                  </button>
                )}
                {qFailed > 0 && !run?.running && (
                  <button onClick={retryFailed} style={{ height: 40, padding: "0 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                    <RotateCcw size={13} strokeWidth={2} /> Retry {qFailed} failed
                  </button>
                )}
              </div>
            </div>

            {showBulkProgress && run && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, background: "var(--bg-secondary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                  <span>
                    {run.running
                      ? `Dialing${run.stopRequested ? " — stopping after current calls" : ""} · ${bulkProcessed} done · ${bulkRemaining} left`
                      : `Finished in ${bulkElapsed}s · ${bulkProcessed} processed`}
                  </span>
                  <span>{bulkPct}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                  <div style={{ width: `${bulkPct}%`, height: "100%", borderRadius: 4, background: "var(--accent-green)", transition: "width 0.6s ease" }} />
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 13, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>{run.called} called</span>
                  <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>{run.failed} failed</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{run.skipped} skipped</span>
                  <span style={{ color: "var(--text-muted)" }}>{bulkElapsed}s · {run.waves} wave{run.waves === 1 ? "" : "s"} · {run.concurrency} at a time</span>
                </div>
                {run.current.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>On the line now:</span>
                    {run.current.slice(0, 6).map((p) => (
                      <span key={p} style={{ fontSize: 12, fontFamily: "monospace", padding: "2px 8px", borderRadius: 6, background: "var(--bg-card)", border: "1px solid var(--border)" }}>{p}</span>
                    ))}
                    {run.current.length > 6 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>+{run.current.length - 6} more</span>}
                  </div>
                )}
                {!run.running && bulkReason && (
                  <div style={{ marginTop: 10, fontSize: 13, color: run.reason === "drained" ? "var(--accent-green)" : "var(--accent-yellow)" }}>
                    {bulkReason}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => setBatchMode("sequential")} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", background: batchMode === "sequential" ? "rgba(59,130,246,0.15)" : "transparent", color: batchMode === "sequential" ? "var(--accent-blue)" : "var(--text-secondary)" }}>Call One By One</button>
              <button onClick={() => setBatchMode("parallel")} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", background: batchMode === "parallel" ? "rgba(59,130,246,0.15)" : "transparent", color: batchMode === "parallel" ? "var(--accent-blue)" : "var(--text-secondary)" }}>Call Multiple At A Time</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: batchMode === "parallel" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 16 }}>
              {batchMode === "parallel" && (
                <div>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Calls at once</label>
                  <input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value))))} />
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Exact number of calls to dial</label>
                <input type="number" min={1} value={callLimit} onChange={(e) => setCallLimit(Math.max(1, Number(e.target.value)))} />
              </div>
            </div>

            <button onClick={runBatch} disabled={processing || !queueCount || !!run?.running} className="btn-primary" style={{ height: 40, padding: "0 24px", fontSize: 14 }}>
              <Play size={14} strokeWidth={2} fill="currentColor" /> {processing ? "Dialing…" : `Start Calling (${callLimit})`}
            </button>
            {run?.running && <div style={{ fontSize: 12, color: "var(--accent-yellow)", marginTop: 8 }}>A bulk campaign is running — wait for it to finish or stop it first.</div>}
          </>
        )}
      </div>

      {/* Queue table — live status of every number waiting / dialed */}
      {queueRows.length > 0 && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Outbound Queue</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400 }}>latest {queueRows.length} · updates live during a campaign</span>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-card)" }}>
                  {["Name", "Phone", "Language", "Status", "Queued"].map((h) => (
                    <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queueRows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td style={{ padding: "10px 20px", fontSize: 13, fontWeight: 500 }}>{r.name || "—"}</td>
                    <td style={{ padding: "10px 20px", fontSize: 13, fontFamily: "monospace" }}>{r.phone}</td>
                    <td style={{ padding: "10px 20px", fontSize: 13, textTransform: "capitalize", color: "var(--text-secondary)" }}>{r.language || "—"}</td>
                    <td style={{ padding: "10px 20px" }}>
                      <span style={{ color: queueStatusColor(r.status), fontSize: 12, fontWeight: 600, textTransform: r.status.startsWith("skipped_") ? "none" : "capitalize" }}>{queueStatusLabel(r.status)}</span>
                    </td>
                    <td style={{ padding: "10px 20px", fontSize: 12, color: "var(--text-muted)" }}>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual single entry */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><Plus size={16} strokeWidth={2.1} style={{ color: "var(--accent-yellow)" }} /> Add Single Number to Queue</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          {[["name", "Full Name *"], ["phone", "Phone Number *"]].map(([k, l]) => (
            <div key={k}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>{l}</label>
              <input value={(queueForm as any)[k]} onChange={(e) => setQueueForm({ ...queueForm, [k]: e.target.value })} placeholder={k === "phone" ? "+91 98765 43210" : ""} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Language</label>
            <select value={queueForm.language} onChange={(e) => setQueueForm({ ...queueForm, language: e.target.value })}>
              <option value="telugu">Tenglish</option><option value="hindi">Hinglish</option><option value="english">English</option>
            </select>
          </div>
        </div>
        <button onClick={addToQueue} disabled={!queueForm.name || !queueForm.phone} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "10px 24px", fontWeight: 600, fontSize: 14, opacity: !queueForm.name || !queueForm.phone ? 0.5 : 1 }}>
          Add to Queue
        </button>
      </div>

      {files.length > 0 && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 15 }}>Uploaded Files</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["File", "Type", "Contacts", "Processed", "Status", "Uploaded"].map((h) => (
                  <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const st = STATUS_STYLE[f.status] ?? { color: "var(--text-muted)" }
                return (
                  <tr key={f.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td style={{ padding: "12px 20px", fontSize: 13, fontWeight: 500 }}>{f.filename}</td>
                    <td style={{ padding: "12px 20px", fontSize: 13, color: "var(--text-secondary)", textTransform: "capitalize" }}>{f.type}</td>
                    <td style={{ padding: "12px 20px", fontSize: 13 }}>{f.row_count}</td>
                    <td style={{ padding: "12px 20px", fontSize: 13 }}>{f.processed}/{f.row_count}</td>
                    <td style={{ padding: "12px 20px" }}><span style={{ color: st.color, fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>{f.status}</span></td>
                    <td style={{ padding: "12px 20px", fontSize: 12, color: "var(--text-muted)" }}>{new Date(f.created_at).toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {uploading && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 20px", fontSize: 14, display: "flex", alignItems: "center", gap: 10, zIndex: 100 }}>
          <div style={{ width: 16, height: 16, border: "2px solid var(--accent-blue)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          Uploading file…
        </div>
      )}

      {preview && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 600, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Review Before Queueing</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
              {preview.contacts.length} contacts found. Confirm to add them to the outbound queue — no calls happen yet, use Batch Calling above to start dialing.
            </div>
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-card)" }}>
                    {["Name", "Phone", "Language", "Product"].map((h) => <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.contacts.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td style={{ padding: "8px 14px", fontSize: 13 }}>{c.name}</td>
                      <td style={{ padding: "8px 14px", fontSize: 13, fontFamily: "monospace" }}>{c.phone}</td>
                      <td style={{ padding: "8px 14px", fontSize: 13, textTransform: "capitalize" }}>{c.language}</td>
                      <td style={{ padding: "8px 14px", fontSize: 13 }}>{c.product_interest}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={cancelPreview} disabled={confirming} style={{ flex: 1, padding: 12, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", fontWeight: 600 }}>Cancel</button>
              <button onClick={confirmQueueing} disabled={confirming} className="btn-primary" style={{ flex: 1, height: 44 }}>
                {confirming ? "Queueing…" : `Queue All ${preview.contacts.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
