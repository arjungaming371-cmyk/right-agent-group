"use client"
import { useEffect, useRef, useState } from "react"
import { ClipboardList, FolderUp, FileText, FileUp, Phone, Plus, Play } from "lucide-react"
import { useToast } from "../ui/toast"

type UploadedFile = { id: string; filename: string; type: string; row_count: number; processed: number; status: string; created_at: string }
type Contact = { name: string; phone: string; language: string; product_interest: string; leadId: string }

export default function UploadView() {
  const toast = useToast()
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [queueForm, setQueueForm] = useState({ name: "", phone: "", language: "telugu", product_interest: "Home Loan", notes: "" })
  const [preview, setPreview] = useState<{ uploadId: string; contacts: Contact[] } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const csvRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  // Batch calling controls
  const [batchMode, setBatchMode] = useState<"sequential" | "parallel">("sequential")
  const [concurrency, setConcurrency] = useState(3)
  const [callLimit, setCallLimit] = useState(10)
  const [processing, setProcessing] = useState(false)
  const [queueCount, setQueueCount] = useState<number | null>(null)

  async function load() {
    const res = await fetch("/api/upload/list")
    if (res.ok) setFiles(await res.json())
    // ?count=pending — one tiny query instead of pulling 200 rows to count.
    const qRes = await fetch("/api/outbound?count=pending")
    if (qRes.ok) {
      const d = await qRes.json()
      setQueueCount(d.count ?? 0)
    }
  }

  useEffect(() => { load() }, [])

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
        toast.success(`${data.queued} contacts queued — use batch controls below to start calling`)
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
    const res = await fetch("/api/outbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(queueForm) })
    if (res.ok) { toast.success("Added to outbound queue"); setQueueForm({ name: "", phone: "", language: "telugu", product_interest: "Home Loan", notes: "" }); load() }
    else { const d = await res.json(); toast.error(d.error || "Could not add to queue") }
  }

  async function runBatch() {
    setProcessing(true)
    try {
      const res = await fetch("/api/outbound/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Concurrency now lives in dialer settings (Call Queue slider, 1-10).
        // The runner reads the persisted value; this only passes the batch size.
        body: JSON.stringify({ limit: callLimit }),
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

  const STATUS_STYLE: Record<string, { color: string }> = {
    done: { color: "var(--accent-green)" }, processing: { color: "var(--accent-yellow)" }, pending: { color: "var(--accent-blue)" }, failed: { color: "var(--accent-red)" },
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><ClipboardList size={16} strokeWidth={1.9} style={{ color: "var(--accent-violet)" }} /> Upload Contacts (CSV / Google Sheet)</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>Upload a CSV with columns: name, phone, language, product_interest, notes</div>
          <div style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 28, textAlign: "center", cursor: "pointer", marginBottom: 12 }} onClick={() => csvRef.current?.click()}>
            <FolderUp size={30} strokeWidth={1.4} style={{ marginBottom: 8, color: "var(--text-muted)" }} />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Click to upload CSV</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Supports .csv, .xlsx, .xls</div>
          </div>
          <input ref={csvRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => uploadFile(e, "contacts")} />
        </div>

        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><FileText size={16} strokeWidth={1.9} style={{ color: "var(--accent-cyan)" }} /> Upload AI Script / Document</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>Upload what AI should reference during calls — .txt, .pdf, .docx</div>
          <div style={{ border: "2px dashed var(--border)", borderRadius: 10, padding: 28, textAlign: "center", cursor: "pointer", marginBottom: 12 }} onClick={() => docRef.current?.click()}>
            <FileUp size={30} strokeWidth={1.4} style={{ marginBottom: 8, color: "var(--text-muted)" }} />
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Click to upload script</div>
          </div>
          <input ref={docRef} type="file" accept=".txt,.pdf,.docx,.doc" style={{ display: "none" }} onChange={(e) => uploadFile(e, "script")} />
        </div>
      </div>

      {/* Batch calling controls */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><Phone size={16} strokeWidth={1.9} style={{ color: "var(--accent-green)" }} /> Batch Calling</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          {queueCount !== null ? `${queueCount} contacts pending in the queue` : "Loading queue…"}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setBatchMode("sequential")} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", background: batchMode === "sequential" ? "rgba(59,130,246,0.15)" : "transparent", color: batchMode === "sequential" ? "var(--accent-blue)" : "var(--text-secondary)" }}>Call One By One</button>
          <button onClick={() => setBatchMode("parallel")} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border)", background: batchMode === "parallel" ? "rgba(59,130,246,0.15)" : "transparent", color: batchMode === "parallel" ? "var(--accent-blue)" : "var(--text-secondary)" }}>Call Multiple At A Time</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: batchMode === "parallel" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 16 }}>
          {batchMode === "parallel" && (
            <div>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Calls at once (1-10 — set the live value in Call Queue)</label>
              <input type="number" min={1} max={10} value={Math.min(concurrency, 10)} onChange={(e) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value))))} disabled />
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Exact number of calls to dial</label>
            <input type="number" min={1} value={callLimit} onChange={(e) => setCallLimit(Math.max(1, Number(e.target.value)))} />
          </div>
        </div>

        <button onClick={runBatch} disabled={processing || !queueCount} className="btn-primary" style={{ height: 40, padding: "0 24px", fontSize: 14 }}>
          <Play size={14} strokeWidth={2} fill="currentColor" /> {processing ? "Dialing…" : `Start Calling (${callLimit})`}
        </button>
      </div>

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
