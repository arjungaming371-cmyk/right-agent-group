"use client"

// WhatsApp module — rebuilt to look and behave like the REAL WhatsApp Web.
//
// Everything you can click is wired to the Cloud API / database:
//   • chat list: search, All/Unread/Favourites/Groups chips, Archived screen,
//     pin / mute / archive menus, unread badges, tick-marked previews
//   • chat: bubbles with tails + grouping, TODAY/YESTERDAY pills, encryption
//     notice, unread separator, reply-with-quote (context.message_id),
//     reactions (Meta type:"reaction"), photo/video/document attachments
//     (Meta media upload + authenticated proxy), forward, in-chat search,
//     scroll-to-bottom FAB, online / last-seen header, AI call (Priya)
//   • composer: emoji picker, attach menu, mic dictation, optimistic sends

import { useEffect, useRef, useState, useCallback } from "react"
import { useToast } from "../ui/toast"
import { usePolling } from "@/lib/use-poll"
import {
  WA, WA_FONT, type Role, type Lead, type Msg,
} from "./whatsapp/palette"
import ChatList, { WhatsAppGlyph } from "./whatsapp/chat-list"
import ChatWindow from "./whatsapp/chat-window"
import { ContactInfo, NewChatModal, ForwardModal } from "./whatsapp/panels"
import CallsList from "./whatsapp/calls-list"
import { DiagnoseModal, runDiagnostic } from "./whatsapp/diagnose"
import type { ListTab } from "./whatsapp/chat-list"
import { Phone } from "lucide-react"

// Left-panel bottom nav — real WhatsApp Web splits Chats | Calls; we do the
// same two (Updates/Communities don't exist on the Cloud API).
type PanelMode = "chats" | "calls"

export default function WhatsAppView({ role }: { role: Role }) {
  const canEdit = role !== "viewer"
  const toast = useToast()
  const [leads, setLeads]           = useState<Lead[]>([])
  const [archivedLeads, setArchivedLeads] = useState<Lead[]>([])
  const [selected, setSelected]     = useState<Lead | null>(null)
  const [messages, setMessages]     = useState<Msg[]>([])
  const [text, setText]             = useState("")
  const [sending, setSending]       = useState(false)
  const [ready, setReady]           = useState<boolean | null>(null)
  const [showInfo, setShowInfo]     = useState(false)
  const [tab, setTab]               = useState<ListTab>("all")
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [replyTo, setReplyTo]       = useState<Msg | null>(null)
  const [forwarding, setForwarding] = useState<Msg | null>(null)
  const [uploading, setUploading]   = useState(false)
  const [uploadName, setUploadName] = useState("")
  const [calling, setCalling]       = useState(false)
  const [showNewChat, setShowNewChat] = useState(false)
  const [allLeads, setAllLeads]     = useState<Lead[]>([])
  const [mode, setMode]             = useState<PanelMode>("chats")
  const [diagnoseOpen, setDiagnoseOpen] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)

  const loadEpochRef = useRef(0)
  const didInitialSelect = useRef(false)
  // unread count at the moment a chat was opened → drives the green
  // "X UNREAD MESSAGES" separator (WhatsApp jumps to it, we render it)
  const unreadAtOpenRef = useRef<Record<string, number>>({})

  // ---- data loads ----
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status")
      setReady(!!(await res.json()).ready)
    } catch { setReady(false) }
  }, [])

  const applyLeads = (data: Lead[], archived: boolean) => {
    if (!Array.isArray(data)) return
    archived ? setArchivedLeads(data) : setLeads(data)
    if (!archived && data.length > 0 && !didInitialSelect.current) {
      didInitialSelect.current = true
      setSelected(prev => prev || data[0])
    }
    if (!archived) {
      setSelected(prev => prev ? data.find(d => d.id === prev.id) || prev : prev)
    }
  }

  const loadLeads = useCallback(async () => {
    try {
      const [activeRes, archivedRes] = await Promise.all([
        fetch("/api/whatsapp/conversations"),
        fetch("/api/whatsapp/conversations?view=archived"),
      ])
      if (activeRes.ok) applyLeads(await activeRes.json(), false)
      if (archivedRes.ok) applyLeads(await archivedRes.json(), true)
    } catch {}
  }, [])

  const loadMessages = useCallback(async (leadId: string, scroll = false) => {
    loadEpochRef.current += 1
    const epoch = loadEpochRef.current
    try {
      const res = await fetch(`/api/whatsapp/messages?leadId=${leadId}`)
      if (res.ok) {
        const data = await res.json()
        if (epoch !== loadEpochRef.current) return
        setMessages(data)
      }
    } catch {}
  }, [])

  useEffect(() => {
    checkStatus()
    loadLeads()
  }, [])

  usePolling(checkStatus, 8000)
  usePolling(loadLeads, 4000)
  usePolling(() => { if (selected) loadMessages(selected.id) }, selected ? 3000 : 0)

  useEffect(() => {
    if (!selected) return
    loadMessages(selected.id)
    setReplyTo(null)
    setShowInfo(false)
  }, [selected?.id])

  const markRead = useCallback(async (lead: Lead) => {
    try {
      await fetch("/api/whatsapp/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) })
      loadLeads()
    } catch {}
  }, [loadLeads])

  // window-focus read receipts — WhatsApp marks read when you LOOK at the chat
  useEffect(() => {
    function onFocus() {
      if (selected && (selected.unread ?? 0) > 0 && document.hasFocus()) markRead(selected)
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [selected, markRead])

  function openChat(lead: Lead) {
    setText("")
    setShowInfo(false)
    setReplyTo(null)
    unreadAtOpenRef.current[lead.id] = lead.unread ?? 0
    setSelected(lead)
    if ((lead.unread ?? 0) > 0 && document.hasFocus()) markRead(lead)
  }

  // ---- send (text / reply / media), with optimistic bubbles ----
  async function send() {
    if (!selected?.phone || sending || !text.trim()) return
    const msg = text.trim()
    const quoted = replyTo && replyTo.wa_message_id ? replyTo : null
    setText("")
    setReplyTo(null)
    setSending(true)
    const optimistic: Msg = {
      id: "tmp-" + Date.now(), direction: "outbound", content: msg,
      created_at: new Date().toISOString(), status: "sending",
      msg_type: "text",
      quoted_wa_id: quoted?.wa_message_id || null,
      quoted_text: quoted ? quoted.content : null,
      quoted_from: quoted?.direction || null,
      wa_message_id: null,
    }
    setMessages(prev => [...prev, optimistic])
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selected.phone, message: msg, leadId: selected.id, replyTo: quoted?.wa_message_id || undefined }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error === "DND_SUPPRESSED" ? (data.message || "Send blocked") : (data.error || "Send failed"))
      await loadMessages(selected.id)
      await loadLeads()
    } catch { toast.error("Send failed — check WhatsApp service") }
    setSending(false)
  }

  async function sendMedia(mediaId: string, kind: string, filename: string) {
    if (!selected?.phone) return
    const optimistic: Msg = {
      id: "tmp-" + Date.now(), direction: "outbound", content: "",
      created_at: new Date().toISOString(), status: "sending",
      msg_type: kind, media_id: mediaId, media_name: filename,
      wa_message_id: null, media_mime: null,
    }
    setMessages(prev => [...prev, optimistic])
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selected.phone, message: "", leadId: selected.id, mediaId, mediaKind: kind, mediaName: filename }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error || "Media send failed")
      await loadMessages(selected.id)
      await loadLeads()
    } catch { toast.error("Media send failed") }
  }

  async function onFilePicked(file: File, kind: "media" | "document") {
    if (!selected) return
    setUploading(true)
    setUploadName(file.name)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/whatsapp/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Upload failed")
      } else {
        await sendMedia(data.mediaId, kind === "document" ? "document" : (file.type.startsWith("video") ? "video" : "image"), file.name)
      }
    } catch { toast.error("Upload failed — check connection") }
    setUploading(false)
    setUploadName("")
  }

  // ---- reactions (Meta type:"reaction"; click same emoji to remove) ----
  async function react(msg: Msg, emoji: string) {
    if (!selected) return
    const removing = msg.reaction === emoji
    const next = removing ? null : emoji
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reaction: next } : m))
    try {
      const res = await fetch("/api/whatsapp/react", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id, to: selected.phone, waMessageId: msg.wa_message_id, emoji: removing ? "" : emoji }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, reaction: msg.reaction || null } : m))
      toast.error("Reaction failed")
    }
  }

  // ---- forward ----
  async function forwardTo(target: Lead) {
    const msg = forwarding
    if (!msg || !target?.phone) return
    setForwarding(null)
    try {
      const body: Record<string, any> = { to: target.phone, message: msg.msg_type && msg.msg_type !== "text" ? "" : msg.content }
      if (msg.media_id && msg.msg_type && !["text", "location"].includes(msg.msg_type)) {
        body.mediaId = msg.media_id
        body.mediaKind = msg.msg_type
        body.mediaName = msg.media_name || undefined
      }
      const res = await fetch("/api/whatsapp/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (res.ok) toast.success(`Forwarded to ${target.name}`)
      else toast.error("Forward failed")
    } catch { toast.error("Forward failed") }
  }

  // ---- chat settings: pin / mute / archive ----
  async function patchSettings(lead: Lead, patch: { archived?: boolean; muted?: boolean }) {
    // optimistic
    const upd = (l: Lead) => l.id === lead.id ? { ...l, ...patch.archived !== undefined ? { wa_archived: patch.archived } : {}, ...patch.muted !== undefined ? { wa_muted: patch.muted } : {} } : l
    setLeads(prev => prev.map(upd))
    setArchivedLeads(prev => prev.map(upd))
    if (selected?.id === lead.id) setSelected(prev => prev ? upd(prev) : prev)
    try {
      const res = await fetch("/api/whatsapp/chat-settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, ...patch }),
      })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Couldn't update chat settings — refreshing")
      loadLeads()
    }
  }

  // ---- WhatsApp connection diagnostic — one click tells you WHY sends fail ----
  async function diagnose() {
    setDiagnosing(true)
    const r = await runDiagnostic()
    setDiagnosing(false)
    if (r.ok) toast.success(`WhatsApp healthy — ${r.verified_name || "number"} <${r.phone || "?"}>`)
    else setDiagnoseOpen(true) // full modal with the Meta error + fix hints
  }

  const archiveChat = (lead: Lead) => {
    patchSettings(lead, { archived: !lead.wa_archived })
    toast.success(lead.wa_archived ? "Chat unarchived" : "Chat archived")
  }
  const muteChat = (lead: Lead) => {
    patchSettings(lead, { muted: !lead.wa_muted })
    toast.success(lead.wa_muted ? "Chat unmuted" : "Chat muted — badge stays, no banner")
  }
  async function togglePin(lead: Lead) {
    const nextPinned = !lead.pinned
    const upd = (l: Lead) => l.id === lead.id ? { ...l, pinned: nextPinned, pinned_at: nextPinned ? new Date().toISOString() : null } : l
    setLeads(prev => prev.map(upd))
    setArchivedLeads(prev => prev.map(upd))
    if (selected?.id === lead.id) setSelected(prev => prev ? upd(prev) : prev)
    try {
      const res = await fetch(`/api/leads/${lead.id}/pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: nextPinned }) })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("Couldn't update pin — refreshing")
      loadLeads()
    }
  }

  // ---- AI call (same Priya voice agent as Voice Logs) ----
  async function callLead() {
    if (!selected?.phone || calling) return
    setCalling(true)
    try {
      const res = await fetch("/api/calls", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selected.id, phone: selected.phone, language: selected.language || "telugu" }),
      })
      const data = await res.json()
      if (res.ok) toast.success("AI call started — Priya is dialing now")
      else toast.error(data.error || "Call failed")
    } catch { toast.error("Call failed — check the voicebot service") }
    setCalling(false)
  }

  // ---- new chat ----
  function openNewChatModal() {
    setShowNewChat(true)
    fetch("/api/leads").then(r => r.ok ? r.json() : []).then(d => Array.isArray(d) && setAllLeads(d)).catch(() => {})
  }
  function startNewChat(lead: Lead | null, phone?: string, name?: string) {
    if (lead) {
      setLeads(prev => prev.some(l => l.id === lead.id) ? prev : [lead, ...prev])
      openChat(lead)
      setShowNewChat(false)
      return
    }
    const clean = (phone || "").replace(/\D/g, "")
    if (!clean) { toast.error("Please enter a valid phone number or pick an existing lead"); return }
    const customLead: Lead = { id: "lead-" + Date.now(), name: (name || "").trim() || phone!, phone: phone!, whatsapp_number: phone! }
    setLeads(prev => [customLead, ...prev])
    openChat(customLead)
    setShowNewChat(false)
  }

  const listLeads = leads
  const unreadTotal = leads.filter(l => (l.unread ?? 0) > 0).length

  return (
    <div style={{
      height: "calc(100vh - 120px)", display: "flex", flexDirection: "column",
      borderRadius: 16, overflow: "hidden", border: `1px solid ${WA.hairline}`,
      background: WA.panelBg, boxShadow: "0 20px 40px rgba(0,0,0,0.3)", fontFamily: WA_FONT, position: "relative",
    }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left panel: chats OR calls, with the WhatsApp-style bottom nav */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexShrink: 0, width: "100%" }} className="md:w-auto">
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
            {mode === "chats" ? (
              <ChatList
                leads={listLeads}
                selected={selected}
                ready={!!ready}
                canEdit={canEdit}
                tab={tab}
                onTab={setTab}
                archivedOpen={archivedOpen}
                onArchivedOpen={setArchivedOpen}
                onOpenArchived={() => setArchivedOpen(true)}
                onSelect={openChat}
                onNewChat={openNewChatModal}
                onPin={togglePin}
                onMute={muteChat}
                onArchive={archiveChat}
                onRefresh={loadLeads}
                onDiagnose={diagnose}
                diagnosing={diagnosing}
              />
            ) : (
              <CallsList
                leads={listLeads}
                onOpenChat={openChat}
                onRefresh={loadLeads}
                onDiagnose={diagnose}
                ready={!!ready}
              />
            )}
          </div>

          {/* bottom nav — Chats | Calls, WhatsApp-Web style */}
          <div style={{
            display: "flex", background: WA.headerBg, borderTop: `1px solid ${WA.hairline}`,
          }}>
            {(["chats", "calls"] as PanelMode[]).map((m) => {
              const active = mode === m
              return (
                <button key={m} onClick={() => setMode(m)} style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  padding: "8px 0 7px", background: "transparent", border: 0, cursor: "pointer",
                  borderTop: active ? `2px solid ${WA.teal}` : "2px solid transparent",
                  color: active ? WA.tealBright : WA.textSecondary,
                }}>
                  {m === "chats" ? (
                    <span style={{ position: "relative", display: "inline-flex" }}>
                      <WhatsAppGlyph size={19} color={active ? WA.tealBright : WA.textSecondary} />
                      {unreadTotal > 0 && (
                        <span style={{
                          position: "absolute", top: -5, right: -9, background: WA.tealBright, color: "#111",
                          borderRadius: 999, fontSize: 9.5, fontWeight: 700, minWidth: 15, height: 15,
                          display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                        }}>{unreadTotal > 99 ? "99+" : unreadTotal}</span>
                      )}
                    </span>
                  ) : (
                    <Phone size={18} />
                  )}
                  <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 400 }}>
                    {m === "chats" ? "Chats" : "Calls"}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {selected ? (
          <>
            <ChatWindow
              lead={selected}
              messages={messages}
              ready={ready === true}
              canEdit={canEdit}
              sending={sending}
              text={text}
              setText={setText}
              onSend={send}
              onBack={() => setSelected(null)}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              onReact={react}
              onForward={setForwarding}
              onToggleInfo={() => setShowInfo(v => !v)}
              unreadAtOpen={unreadAtOpenRef.current[selected.id] || 0}
              onAIcall={callLead}
              calling={calling}
              onMute={() => muteChat(selected)}
              onArchive={() => { archiveChat(selected); }}
              uploading={uploading}
              uploadName={uploadName}
              onFilePicked={onFilePicked}
            />

            {showInfo && (
              <ContactInfo
                lead={selected}
                onClose={() => setShowInfo(false)}
                canEdit={canEdit}
                onMute={() => muteChat(selected)}
                onArchive={() => archiveChat(selected)}
                onAIcall={callLead}
                calling={calling}
              />
            )}
          </>
        ) : (
          <div className="hidden md:flex" style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", background: WA.chatBg, color: WA.textSecondary }}>
            <div style={{
              width: 76, height: 76, borderRadius: "50%", background: WA.headerBg,
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22,
            }}>
              <WhatsAppGlyph size={40} color={WA.textSecondary} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 300, color: WA.textPrimary, marginBottom: 8 }}>WhatsApp for Business</div>
            <div style={{ fontSize: 13.5 }}>Send and receive messages without keeping your phone online.</div>
            {unreadTotal > 0 && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: WA.tealBright }}>{unreadTotal} chat{unreadTotal > 1 ? "s" : ""} with unread messages</div>
            )}
          </div>
        )}
      </div>

      {forwarding && (
        <ForwardModal
          leads={[...leads, ...archivedLeads]}
          msg={forwarding}
          onClose={() => setForwarding(null)}
          onForward={forwardTo}
        />
      )}
      {showNewChat && (
        <NewChatModal
          allLeads={allLeads}
          onClose={() => setShowNewChat(false)}
          onPick={(l) => startNewChat(l)}
          onCreate={(phone, name) => startNewChat(null, phone, name)}
        />
      )}
      {diagnoseOpen && <DiagnoseModal onClose={() => setDiagnoseOpen(false)} />}
    </div>
  )
}
