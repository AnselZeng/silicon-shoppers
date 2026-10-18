import { FREE_SHIPPING_THRESHOLD } from "@/lib/ads/catalog"
import { PRODUCTS } from "@/lib/store/catalog"

/** Prices and percentages copy may quote: the catalog's own, plus the shipping threshold. */
const PRICES = new Set<number>([
  FREE_SHIPPING_THRESHOLD,
  ...PRODUCTS.flatMap((p) => (p.salePrice === undefined ? [p.price] : [p.price, p.salePrice])),
])
const PERCENTS = new Set<number>(
  PRODUCTS.filter((p) => p.salePrice !== undefined).map((p) => Math.round(((p.price - (p.salePrice ?? p.price)) / p.price) * 100)),
)

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(" ")
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")
}

/**
 * Brand voice and safety for any text the LLM writes: strip markup and URLs, no exclamation marks,
 * no prices or percentages the catalog doesn't have, trimmed to the limit. Returns "" when nothing is left.
 */
export function cleanCopy(raw: string, max: number): string {
  let text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b\S+\.(?:com|net|org|io|shop)\S*/gi, " ")
    .replace(/[*_`#]/g, "")
    .replace(/!+/g, ".")
  text = text.replace(/(?:up to\s+|save\s+)?\$\s?(\d+(?:\.\d+)?)/gi, (match, n: string) =>
    PRICES.has(Number(n)) ? match : " ",
  )
  text = text.replace(/(?:up to\s+|save\s+)?(\d+(?:\.\d+)?)\s?%(?:\s+off)?/gi, (match, n: string) =>
    PERCENTS.has(Number(n)) ? match : " ",
  )
  text = text.replace(/\s+([.,;:])/g, "$1").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim()
  if (/^[.,;:\s]*$/.test(text)) return ""
  return trimTo(text, max)
}
