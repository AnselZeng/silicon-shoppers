export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: number): { next: () => number; seed: number } {
  return { next: mulberry32(seed), seed }
}

export function randomSeed(): number {
  const buffer = new Uint32Array(1)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 1
    return value === 0 ? 1 : value
  }
  return Math.floor(Math.random() * 1_000_000_000) + 1
}
