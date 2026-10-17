export const UI_CONFIG = {
  minWidthPx: 1280,
  leftColumnWidth: 0.35,
  rightColumnWidth: 0.65,
  personaPanelHeight: 0.55,
  controlsPanelHeight: 0.45,
  demoAspectRatios: { wide: "16 / 10", classic: "4 / 3" },
  defaultAspectRatio: "wide",
  terminalMaxLines: 1000,
  listingPageSize: 12,
  popupDelayMs: 2200,
  stepBaseDelayMs: 650,
  cursorBaseMs: 480,
  classificationThreshold: 0.75,
  minEventsToClassify: 3,
  typewriterMaxSpeed: 1,
  loyalistCollection: "Essentials",
} as const

export type AspectRatioKey = keyof typeof UI_CONFIG.demoAspectRatios

export const PERSONA_ACCENTS = {
  price_hunter: "#e8a838",
  trend_seeker: "#e84a8a",
  mission_shopper: "#3d9ce8",
  brand_loyalist: "#3d8b6e",
} as const

export const LOG_COLORS = {
  sim: "#a3a3a3",
  agent: "#67e8f9",
  tracker: "#fde047",
  engine: "#e879f9",
  layout: "#86efac",
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
