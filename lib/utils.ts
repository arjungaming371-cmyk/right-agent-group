import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—"
  const num = Number(n)
  if (!isFinite(num) || isNaN(num) || num <= 0) return "—"
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`
  if (num >= 100000)   return `₹${(num / 100000).toFixed(2)}L`
  if (num >= 1000)     return `₹${(num / 1000).toFixed(1)}K`
  return `₹${num.toLocaleString("en-IN")}`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return "—"
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}
