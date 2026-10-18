export const UI_CONFIG = {
  minWidthPx: 1280,
  leftColumnWidth: 0.35,
  rightColumnWidth: 0.65,
  personaPanelHeight: 0.55,
  controlsPanelHeight: 0.45,
  demoViewports: {
    web: { width: 1280, height: 800 },
    tablet: { width: 820, height: 1180 },
    mobile: { width: 390, height: 780 },
  },
  defaultViewport: "web",
  terminalMaxLines: 1000,
  listingPageSize: 12,
  loyalistCollection: "Essentials",
} as const

/**
 * Pacing of a layout swap in the store. Each stage: scroll to it, box what is about to
 * change (leadMs), play the change (animMs), keep the box (holdMs), fade it (fadeMs).
 * Scrolls take scrollMinMs plus scrollMsPerPx per pixel travelled, capped at scrollMaxMs.
 */
export const LAYOUT_MOTION = {
  animMs: 1100,
  leadMs: 700,
  holdMs: 700,
  fadeMs: 350,
  /** Pause after a stage with nothing to box. */
  gapMs: 250,
  scrollMinMs: 700,
  scrollMsPerPx: 0.4,
  scrollMaxMs: 1600,
  /** Clearance under the sticky header when a block is scrolled into view. */
  scrollOffsetPx: 96,
  /** The shell gives up waiting for the store after this long. */
  settleTimeoutMs: 40000,
} as const

export type ViewportKey = keyof typeof UI_CONFIG.demoViewports

export const PERSONA_ACCENTS = {
  price_hunter: "#e8a838",
  trend_seeker: "#e84a8a",
  mission_shopper: "#3d9ce8",
  brand_loyalist: "#3d8b6e",
} as const

export const LOG_COLORS = {
  sim: "#a3a3a3",
  tracker: "#fde047",
  layout: "#86efac",
  model: "#c4b5fd",
  sentry: "#fdba74",
  visa: "#7dd3fc",
} as const

export type LogSource = keyof typeof LOG_COLORS

export const COLOR_HEX = {
  black: "#1a1a1a",
  white: "#f4f1ea",
  beige: "#d4c4a8",
  navy: "#1e2a4a",
  grey: "#8a8a8a",
  olive: "#5c6145",
  burgundy: "#6b2c3a",
  cream: "#efe6d4",
  brown: "#5c4033",
  camel: "#c4a574",
} as const

export type StoreColor = keyof typeof COLOR_HEX

export const STORE_COLORS = Object.keys(COLOR_HEX) as StoreColor[]
