"use client"
// Shimmer skeletons — shown while data loads instead of bare "Loading..." text.

export function Skeleton({ w = "100%", h = 14, r = 6, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        display: "block", width: w, height: h, borderRadius: r,
        background: "linear-gradient(90deg, rgba(255,255,255,0.045) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.045) 75%)",
        backgroundSize: "400px 100%",
        animation: "shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  )
}

/** A row of avatar + two text lines — matches the list layouts used across views. */
export function SkeletonRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--border-light)" }}>
      <Skeleton w={36} h={36} r={18} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <Skeleton w="34%" h={12} />
        <Skeleton w="22%" h={10} />
      </div>
      <Skeleton w={64} h={22} r={8} />
    </div>
  )
}

/** Full-width list placeholder: n shimmer rows. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
