"use client"
import { useEffect, useRef, useState } from "react"
import { BookOpen, Plus, Pencil, Trash2, X, Check, FileUp, FileText, Link2, RefreshCw } from "lucide-react"
import { useToast } from "../ui/toast"
import { Skeleton } from "../ui/skeleton"

type Entry = {
  id: string
  title: string
  content: string
  category: string | null
  is_active: boolean
  source_type: "manual" | "csv" | "pdf" | "url"
  source_url: string | null
  source_filename: string | null
  last_fetched_at: string | null
  created_at: string
  updated_at: string
}

const EMPTY_FORM = { title: "", content: "", category: "" }

const SOURCE_BADGE: Record<Entry["source_type"], { label: string; color: string }> = {
  manual: { label: "Manual", color: "var(--text-secondary)" },
  csv: { label: "CSV", color: "var(--accent-cyan)" },
  pdf: { label: "PDF", color: "var(--accent-red)" },
  url: { label: "URL", color: "var(--accent-green)" },
}

export default function KnowledgeBaseView({ role }: { role: "admin" | "agent" | "viewer" | "developer" }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const csvInputRef = useRef<HTMLInputElement>(null)
  const pdfInputRef = useRef<HTMLInputElement>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [pdfUploading, setPdfUploading] = useState(false)
  const [urlInput, setUrlInput] = useState("")
  const [urlFetching, setUrlFetching] = useState(false)
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/knowledge-base")
      if (res.ok) setEntries(await res.json())
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(entry: Entry) {
    setForm({ title: entry.title, content: entry.content, category: entry.category || "" })
    setEditingId(entry.id)
    setShowForm(true)
  }

  async function save() {
    if (!form.title.trim() || !form.content.trim()) return
    setSaving(true)
    try {
      const res = editingId
        ? await fetch("/api/knowledge-base", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: editingId, ...form }),
          })
        : await fetch("/api/knowledge-base", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          })
      if (res.ok) {
        toast.success(editingId ? "Entry updated" : "Entry added")
        setShowForm(false)
        await load()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || "Save failed")
      }
    } catch {
      toast.error("Save failed")
    }
    setSaving(false)
  }

  async function toggleActive(entry: Entry) {
    try {
      const res = await fetch("/api/knowledge-base", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, is_active: !entry.is_active }),
      })
      if (res.ok) await load()
      else toast.error("Could not update")
    } catch {
      toast.error("Could not update")
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/knowledge-base?id=${id}`, { method: "DELETE" })
      if (res.ok) { toast.success("Entry removed"); await load() }
      else toast.error("Could not remove")
    } catch {
      toast.error("Could not remove")
    }
    setConfirmDelete(null)
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file later
    if (!file) return
    setCsvUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/knowledge-base/upload-csv", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (res.ok) { toast.success(`Imported ${d.created} of ${d.total} rows from ${file.name}`); await load() }
      else toast.error(d.error || "CSV import failed")
    } catch {
      toast.error("CSV import failed")
    }
    setCsvUploading(false)
  }

  async function handlePdfFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setPdfUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/knowledge-base/upload-pdf", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (res.ok) { toast.success(`Extracted ${d.created} section(s) from ${file.name}`); await load() }
      else toast.error(d.error || "PDF import failed")
    } catch {
      toast.error("PDF import failed")
    }
    setPdfUploading(false)
  }

  async function fetchUrl(url: string, isRefresh = false) {
    if (!url.trim()) return
    if (isRefresh) setRefreshingUrl(url); else setUrlFetching(true)
    try {
      const res = await fetch("/api/knowledge-base/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(d.refreshed ? "Page refreshed" : "Page added to knowledge base")
        if (!isRefresh) setUrlInput("")
        await load()
      } else {
        toast.error(d.error || "Could not fetch that page")
      }
    } catch {
      toast.error("Could not fetch that page")
    }
    if (isRefresh) setRefreshingUrl(null); else setUrlFetching(false)
  }

  const activeCount = entries.filter((e) => e.is_active).length

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: "14px 20px" }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "var(--accent-blue)", display: "flex", alignItems: "center", gap: 6 }}>
          <BookOpen size={14} strokeWidth={2} /> How this works
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Add facts here — documents needed, minimum/maximum loan amounts, eligibility, processing time — and Priya searches this on every single turn of a call or WhatsApp chat, not just the opening. She uses matches naturally without reading them out verbatim or mentioning "knowledge base." Inactive entries are never searched. This is keyword search, not AI-semantic search — word entries the way customers actually ask (include "get", "apply", "eligible", not just formal terms).
        </div>
      </div>

      {canEdit && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Bulk Import</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input ref={csvInputRef} type="file" accept=".csv,.txt" onChange={handleCsvFile} style={{ display: "none" }} />
            <button onClick={() => csvInputRef.current?.click()} disabled={csvUploading} className="btn-ghost" style={{ height: 34 }}>
              <FileUp size={14} strokeWidth={2} /> {csvUploading ? "Importing…" : "Upload CSV"}
            </button>

            <input ref={pdfInputRef} type="file" accept=".pdf" onChange={handlePdfFile} style={{ display: "none" }} />
            <button onClick={() => pdfInputRef.current?.click()} disabled={pdfUploading} className="btn-ghost" style={{ height: 34 }}>
              <FileText size={14} strokeWidth={2} /> {pdfUploading ? "Extracting…" : "Upload PDF"}
            </button>

            <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 220 }}>
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://your-site.com/faq"
                style={{ flex: 1, height: 34, fontSize: 12.5 }}
                onKeyDown={(e) => { if (e.key === "Enter") fetchUrl(urlInput) }}
              />
              <button onClick={() => fetchUrl(urlInput)} disabled={urlFetching || !urlInput.trim()} className="btn-ghost" style={{ height: 34 }}>
                <Link2 size={14} strokeWidth={2} /> {urlFetching ? "Fetching…" : "Fetch URL"}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
            CSV needs title/question + content/answer columns. PDF is split into sections automatically. A fetched URL can be re-fetched later with the refresh button on its entry below to pick up page changes.
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{entries.length} entries · {activeCount} active</div>
        {canEdit && (
          <button onClick={openAdd} className="btn-primary" style={{ height: 34 }}>
            <Plus size={15} strokeWidth={2.2} /> Add Entry
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
            <Skeleton w={200} h={16} />
            <div style={{ marginTop: 8 }}><Skeleton w="100%" h={12} /></div>
          </div>
        ))}
        {!loading && entries.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13, padding: 40, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12 }}>
            No entries yet. Add the questions customers ask most, or bulk-import a CSV/PDF/URL above.
          </div>
        )}
        {entries.map((entry) => {
          const badge = SOURCE_BADGE[entry.source_type] || SOURCE_BADGE.manual
          return (
            <div key={entry.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, opacity: entry.is_active ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{entry.title}</div>
                  {entry.category && (
                    <span style={{ fontSize: 10.5, background: "rgba(139,124,255,0.12)", color: "var(--accent-violet)", borderRadius: 6, padding: "2px 8px" }}>{entry.category}</span>
                  )}
                  <span style={{ fontSize: 10.5, background: `${badge.color}1f`, color: badge.color, borderRadius: 6, padding: "2px 8px" }}>{badge.label}</span>
                  {!entry.is_active && (
                    <span style={{ fontSize: 10.5, background: "rgba(148,163,184,0.15)", color: "var(--text-secondary)", borderRadius: 6, padding: "2px 8px" }}>Inactive</span>
                  )}
                </div>
                {canEdit && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {entry.source_type === "url" && entry.source_url && (
                      <button
                        onClick={() => fetchUrl(entry.source_url as string, true)}
                        disabled={refreshingUrl === entry.source_url}
                        className="icon-btn"
                        title="Re-fetch this page"
                        style={{ width: 28, height: 28 }}
                      >
                        <RefreshCw size={13} strokeWidth={2} className={refreshingUrl === entry.source_url ? "spin" : ""} />
                      </button>
                    )}
                    <button onClick={() => toggleActive(entry)} className="icon-btn" title={entry.is_active ? "Deactivate" : "Activate"} style={{ width: 28, height: 28 }}>
                      {entry.is_active ? <X size={13} strokeWidth={2} /> : <Check size={13} strokeWidth={2} />}
                    </button>
                    <button onClick={() => openEdit(entry)} className="icon-btn" title="Edit" style={{ width: 28, height: 28 }}>
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    {confirmDelete === entry.id ? (
                      <button onClick={() => remove(entry.id)} style={{ fontSize: 11, background: "rgba(239,68,68,0.15)", color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0 10px" }}>
                        Confirm?
                      </button>
                    ) : (
                      <button onClick={() => setConfirmDelete(entry.id)} className="icon-btn" title="Delete" style={{ width: 28, height: 28 }}>
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{entry.content}</div>
              {entry.source_url && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, wordBreak: "break-all" }}>
                  {entry.source_url}{entry.last_fetched_at ? ` · fetched ${new Date(entry.last_fetched_at).toLocaleString()}` : ""}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 520, maxWidth: "100%" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{editingId ? "Edit Entry" : "Add Knowledge Base Entry"}</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Question / Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Minimum loan amount"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Answer / Facts *</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="e.g. The minimum home loan amount is ₹5,00,000 and maximum is ₹75,00,000, subject to eligibility."
                rows={5}
                style={{ width: "100%", background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", borderRadius: 8, padding: 10, fontSize: 13, resize: "vertical" }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>Category (optional)</label>
              <input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Home Loan, Eligibility, Documents"
              />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: 10, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)" }}>Cancel</button>
              <button onClick={save} disabled={saving || !form.title.trim() || !form.content.trim()} className="btn-primary" style={{ flex: 1, height: 40 }}>
                {saving ? "Saving…" : editingId ? "Save Changes" : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
