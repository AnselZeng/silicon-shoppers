export { cn } from "cn"

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}

export function collectionSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-")
}

export function formatClock(elapsedMs: number): string {
  const d = Math.max(0, elapsedMs)
  const m = Math.floor(d / 60000)
  const s = Math.floor((d % 60000) / 1000)
  const ms = Math.floor(d % 1000)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
}
