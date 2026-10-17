export type SessionStyle = {
  grid: number
  quickAdd: boolean
  compare: boolean
}

export function createSessionStyle(): SessionStyle {
  return { grid: 3, quickAdd: false, compare: false }
}
