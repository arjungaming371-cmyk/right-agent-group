"use client"

// Emoji picker — the real WhatsApp picker is tabbed with a grid and a live
// filter; this is the same UX with a curated ~230-emoji set (enough for loan
// conversations, without shipping an emoji database).

import { useState } from "react"
import { WA } from "./palette"

const CATS: { key: string; icon: string; label: string; emojis: string[] }[] = [
  {
    key: "smileys", icon: "😀", label: "Smileys",
    emojis: ["😀","😃","😄","😁","😆","😅","😂","🤣","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🥵","🥶","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁","😮","😯","😲","😳","🥺","😢","😭","😱","😖","😞","😤","😠","😡","🤬","💀","👋"],
  },
  {
    key: "people", icon: "👍", label: "People",
    emojis: ["👍","👎","👌","🤌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","🙌","🤲","🤝","🙏","💪","🦾","✍️","👏","🫶","🤳","💼","🎯","📝","📞","☎️","📱","💻","🏦","💳","💰","💵","📈","📊","🧾","🏠","🏢","🔑","📄","📁","⏰","📌"],
  },
  {
    key: "animals", icon: "🐶", label: "Animals & Nature",
    emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐦","🦜","🦆","🦅","🦉","🐺","🐴","🦄","🐝","🦋","🐌","🐞","🐢","🐍","🐙","🦀","🐬","🐳","🌾","🌱","🌳","🌴","🌵","🌸","🌺","🌻","🌹","🌙","⭐","☀️","⛅","🌧️","🌈"],
  },
  {
    key: "food", icon: "🍽️", label: "Food & Drink",
    emojis: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🥑","🥦","🌽","🥕","🥔","🍞","🥐","🥖","🧀","🥚","🍳","🥞","🧇","🥓","🍔","🍟","🍕","🌭","🥪","🌮","🌯","🥗","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🍤","🍚","🥘","🍦","🍰","🎂","🍫","🍬","🍩","☕","🍵","🥤","🧃","🧉"],
  },
  {
    key: "activity", icon: "⚽", label: "Activity",
    emojis: ["⚽","🏀","🏈","⚾","🎾","🏐","🏏","🥅","⛳","🏹","🎣","🥊","🥋","🎽","🛹","🛼","🏆","🥇","🥈","🥉","🏅","🎖️","🎯","🎳","🎮","🎲","🧩","🎨","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🎻","🎬","🎪","🎉","🎊","🎈","🎁","🪔","🔥","✨","⭐","💫"],
  },
  {
    key: "travel", icon: "✈️", label: "Travel & Places",
    emojis: ["🚗","🚕","🚙","🚌","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🛴","🚲","🛵","🏍️","✈️","🛫","🛬","🚀","🛰️","🚁","⛵","🚤","🛳️","⚓","🚉","🚂","🗺️","🗽","🏰","🕌","🛕","⛩️","🌉","🏝️","🏔️","🌋","🗻","🏕️","🏜️","🏙️","🌃","🌅","🌄","🎡","🎢","🗼","🏦"],
  },
  {
    key: "objects", icon: "💡", label: "Objects",
    emojis: ["⌚","📱","💻","⌨️","🖥️","🖨️","🖱️","💾","💿","📷","📹","🎥","📞","☎️","📟","📠","📺","📻","🧭","⏱️","⏲️","🕰️","🔋","🔌","💡","🔦","🕯️","🧯","🛢️","💸","💵","💰","🧾","💳","🪪","📦","📫","📬","📮","✏️","🖊️","🖌️","📋","📂","📅","📆","📇","🔎","🔗","🔒"],
  },
  {
    key: "symbols", icon: "❤️", label: "Symbols",
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","✅","❌","⭕","❗","❓","❕","❔","‼️","⁉️","💯","🔔","🔕","🚫","⚠️","♻️","✳️","✴️","ℹ️","🆗","🆕","🆙","🔺","🔻","🔶","🔷","🔸","🔹","🔴","🟠","🟢","🔵"],
  },
]

export default function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState(CATS[0].key)
  const [query, setQuery] = useState("")
  const active = CATS.find(c => c.key === cat) || CATS[0]

  return (
    <div
      className="wa-emoji-panel"
      style={{
        position: "absolute", bottom: 56, left: 8, width: 372, maxWidth: "calc(100vw - 40px)", height: 330,
        background: "#233138", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
        display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 30, border: `1px solid ${WA.hairline}`,
      }}
    >
      {/* filter */}
      <div style={{ padding: "10px 12px 6px" }}>
        <div style={{ background: "#2a3942", borderRadius: 8, display: "flex", alignItems: "center", padding: "6px 10px", gap: 8 }}>
          <span style={{ color: WA.textSecondary, fontSize: 13 }}>🔍</span>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search emoji"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: WA.textPrimary, fontSize: 13.5 }}
          />
          {query && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: WA.textSecondary, cursor: "pointer", fontSize: 14 }}>✕</button>
          )}
        </div>
      </div>
      {/* grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px 8px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
          {(query
            ? CATS.flatMap(c => c.emojis) // text search can't label emojis reliably — search across all
            : active.emojis
          ).map((em, i) => (
            <button
              key={`${em}-${i}`}
              onClick={() => onPick(em)}
              title={""}
              style={{
                fontSize: 22, lineHeight: 1.2, padding: 4, background: "transparent", border: "none",
                borderRadius: 6, cursor: "pointer", textAlign: "center",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)" }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
            >
              {em}
            </button>
          ))}
        </div>
      </div>
      {/* category tabs */}
      {!query && (
        <div style={{ display: "flex", justifyContent: "space-around", padding: "6px 8px", borderTop: `1px solid ${WA.hairline}` }}>
          {CATS.map(c => (
            <button
              key={c.key}
              title={c.label}
              onClick={() => setCat(c.key)}
              style={{
                background: "transparent", border: "none", fontSize: 18, cursor: "pointer", padding: "3px 6px",
                borderRadius: 6, opacity: cat === c.key ? 1 : 0.55,
                borderBottom: cat === c.key ? `2px solid ${WA.teal}` : "2px solid transparent",
              }}
            >
              {c.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
