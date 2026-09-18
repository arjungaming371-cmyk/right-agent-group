"use client"
import { useEffect, useState, useMemo } from "react"
import { Phone, MessageCircle, Bot, User, Zap, Search } from "lucide-react"
import { timeAgo } from "@/lib/utils"
import { usePolling } from "@/lib/use-poll"
import { SkeletonList } from "../ui/skeleton"
import VoiceDictation from "../ui/voice-dictation"
import { smartFilter } from "@/lib/smart-search"

type CallLog  = { id:string; lead_name:string; phone:string; duration:string; time:string; status:string; transcript:{role:string;text:string}[] }
type WALog    = { id:string; type:string; lead_name:string; content:string; time:string; status:string }

export default function CommLogView() {
  const [calls, setCalls]     = useState<any[]>([])
  const [waLogs, setWaLogs]   = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [search, setSearch] = useState("")

  const filteredCalls = useMemo(() => {
    return smartFilter(calls, search, (c) => [
      c.leads?.name,
      c.phone,
      c.leads?.phone,
      c.status,
      Array.isArray(c.transcript) ? c.transcript.map((t: any) => t.text || t.content || "").join(" ") : "",
    ])
  }, [calls, search])

  const filteredWaLogs = useMemo(() => {
    return smartFilter(waLogs, search, (w) => [
      w.lead_name,
      w.phone,
      w.content,
      w.summary,
      w.status,
      w.type,
      w.leads?.name,
    ])
  }, [waLogs, search])

  async function load(silent = false) {
    // Background poll ticks skip the skeleton flash once real data is on
    // screen — without this, every 15s poll replaced the whole list with
    // skeletons all day. First load and user-triggered refreshes still show it.
    if (!silent || calls.length === 0) setLoading(true)
    try {
      const [c,w] = await Promise.all([
        fetch("/api/calls").then(r=>r.ok?r.json():[]),
        fetch("/api/comms").then(r=>r.ok?r.json():[]),
      ])
      setCalls(c)
      setWaLogs(w.filter((l:any)=>l.type==="whatsapp"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  usePolling(() => load(true), 15000)

  const STATUS_STYLE: Record<string,{bg:string;color:string}> = {
    completed: {bg:"rgba(45,212,160,0.13)",  color:"var(--accent-green)"},
    failed:    {bg:"rgba(251,86,112,0.13)",  color:"var(--accent-red)"},
    initiated: {bg:"rgba(91,124,250,0.13)",  color:"var(--accent-blue)"},
    "in-progress":{bg:"rgba(247,183,49,0.13)",color:"var(--accent-yellow)"},
    sent:      {bg:"rgba(45,212,160,0.13)",  color:"var(--accent-green)"},
    replied:   {bg:"rgba(91,124,250,0.13)",  color:"var(--accent-blue)"},
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* Smart Search Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 14px" }}>
        <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Smart search communication logs, transcripts, names, numbers (typo-tolerant)..."
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 13 }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", padding: "0 4px" }}
          >
            Clear
          </button>
        )}
        <VoiceDictation onTranscript={(spoken) => setSearch(spoken)} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:h-[calc(100vh-220px)] md:grid-cols-2 md:gap-5">
        {/* Auto Calls */}
        <div className="max-h-[400px] md:max-h-none" style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden" }}>
          <div style={{ padding:"18px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <span style={{ width:28,height:28,borderRadius:8,background:"rgba(139,124,255,0.13)",border:"1px solid rgba(139,124,255,0.28)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"var(--accent-violet)" }}>
                <Phone size={14} strokeWidth={1.9} />
              </span>
              <div style={{ fontWeight:600,fontSize:15 }}>Recent Auto-Calls</div>
            </div>
            <span style={{ background:"var(--bg-secondary)",border:"1px solid var(--border)",borderRadius:6,padding:"3px 10px",fontSize:12,color:"var(--text-muted)" }}>{filteredCalls.length} calls</span>
          </div>
          <div style={{ flex:1,overflowY:"auto" }}>
            {loading && <SkeletonList rows={3} />}
            {!loading && filteredCalls.length===0 && (
              <div style={{ padding:30,textAlign:"center",color:"var(--text-muted)",fontSize:13 }}>
                {search ? "No calls match your smart search." : "No calls yet. Trigger an AI call from Voice Logs."}
              </div>
            )}
            {filteredCalls.map(call => {
              const st = STATUS_STYLE[call.status]??STATUS_STYLE.initiated
              const transcript = Array.isArray(call.transcript) ? call.transcript : []
              const name = call.leads?.name || call.phone || "Unknown"
              const num  = call.leads?.phone || call.phone || ""
              const callTime = new Date(call.created_at).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})
              const durStr = call.duration ? `${Math.floor(call.duration/60)}:${(call.duration%60).toString().padStart(2,"0")}` : "0:00"
              return (
                <div key={call.id} style={{ padding:"16px 20px",borderBottom:"1px solid var(--border-light)" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:transcript.length>0?12:0,cursor:"pointer" }} onClick={()=>setExpanded(expanded===call.id?null:call.id)}>
                    <div>
                      <div style={{ fontWeight:600,fontSize:14 }}>{name}</div>
                      <div style={{ fontSize:12,color:"var(--text-muted)",marginTop:2 }}>{num} · {callTime}</div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <span style={{ fontSize:13,fontFamily:"monospace",color:"var(--text-secondary)" }}>{durStr}</span>
                      <span style={{ background:st.bg,color:st.color,borderRadius:6,padding:"3px 10px",fontSize:12,fontWeight:600,textTransform:"capitalize" }}>{call.status}</span>
                    </div>
                  </div>
                  {expanded===call.id && transcript.length>0 && (
                    <div style={{ background:"var(--bg-secondary)",borderRadius:8,padding:14,marginTop:8 }}>
                      {transcript.map((t:any,i:number)=>(
                        <div key={i} style={{ display:"flex",gap:8,marginBottom:8 }}>
                          <span style={{ flexShrink:0,width:22,height:22,borderRadius:6,display:"inline-flex",alignItems:"center",justifyContent:"center",background:t.role==="ai"?"rgba(139,124,255,0.13)":"var(--overlay-hover)",color:t.role==="ai"?"var(--accent-violet)":"var(--text-muted)" }}>
                            {t.role==="ai"?<Bot size={12} strokeWidth={1.9}/>:<User size={12} strokeWidth={1.9}/>}
                          </span>
                          <div>
                            <span style={{ fontSize:11,fontWeight:700,color:t.role==="ai"?"var(--accent-blue)":"var(--text-muted)",marginRight:6,textTransform:"uppercase" }}>{t.role==="ai"?"AI":"CUSTOMER"}</span>
                            <span style={{ fontSize:13,color:"var(--text-secondary)" }}>{t.text}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* WhatsApp Automation */}
        <div className="max-h-[400px] md:max-h-none" style={{ background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,display:"flex",flexDirection:"column",overflow:"hidden" }}>
          <div style={{ padding:"18px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <span style={{ width:28,height:28,borderRadius:8,background:"rgba(45,212,160,0.11)",border:"1px solid rgba(45,212,160,0.28)",display:"inline-flex",alignItems:"center",justifyContent:"center",color:"var(--accent-green)" }}>
                <MessageCircle size={14} strokeWidth={1.9} />
              </span>
              <div style={{ fontWeight:600,fontSize:15 }}>WhatsApp Automation</div>
            </div>
            <span style={{ background:"var(--bg-secondary)",border:"1px solid var(--border)",borderRadius:6,padding:"3px 10px",fontSize:12,color:"var(--text-muted)" }}>{filteredWaLogs.length} logs</span>
          </div>
          <div style={{ flex:1,overflowY:"auto" }}>
            {loading && <SkeletonList rows={3} />}
            {!loading && filteredWaLogs.length===0 && (
              <div style={{ padding:30,textAlign:"center",color:"var(--text-muted)",fontSize:13 }}>
                {search ? "No WhatsApp logs match your smart search." : "No WhatsApp automation logs yet."}
              </div>
            )}
            {filteredWaLogs.map(log => {
              const st = STATUS_STYLE[log.outcome]??STATUS_STYLE.sent
              return (
                <div key={log.id} style={{ padding:"16px 20px",borderBottom:"1px solid var(--border-light)" }}>
                  {log.type && <div style={{ fontSize:11,color:"var(--text-muted)",marginBottom:6,display:"flex",alignItems:"center",gap:5,textTransform:"capitalize" }}><Zap size={11} style={{ color:"var(--accent-yellow)" }} /> {log.type}</div>}
                  <div style={{ background:"var(--gradient-brand)",borderRadius:12,borderBottomLeftRadius:4,padding:"10px 14px",marginBottom:8,display:"inline-block",maxWidth:"85%" }}>
                    <div style={{ fontSize:13,color:"white" }}>{log.summary}</div>
                  </div>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div style={{ fontSize:12,color:"var(--text-muted)" }}>{log.leads?.name || "System"}</div>
                    <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                      <span style={{ background:st.bg,color:st.color,borderRadius:6,padding:"3px 8px",fontSize:11,fontWeight:600,textTransform:"capitalize" }}>{log.outcome}</span>
                      <span style={{ fontSize:11,color:"var(--text-muted)" }}>{new Date(log.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
