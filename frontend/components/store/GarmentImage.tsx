import { COLOR_HEX, type StoreColor } from "@/config/ui"
import type { GarmentType } from "@/lib/store/types"

export function GarmentImage({
  type,
  color,
  className = "",
}: {
  type: GarmentType
  color: string
  className?: string
}) {
  const fill = (COLOR_HEX as Record<string, string>)[color] ?? COLOR_HEX.black
  const ink = color === "white" || color === "cream" || color === "beige" ? "#2a2a2a" : "rgba(255,255,255,0.35)"
  return (
    <svg viewBox="0 0 200 260" className={className} role="img" aria-label={`${color} ${type}`}>
      <rect width="200" height="260" fill="#ebe6dc" />
      <g fill={fill} stroke={ink} strokeWidth="1.25">
        {shape(type)}
      </g>
    </svg>
  )
}

function shape(type: GarmentType) {
  switch (type) {
    case "tee":
      return (
        <>
          <path d="M58 48 L78 38 H122 L142 48 L168 78 L150 90 L138 74 V198 H62 V74 L50 90 L32 78 Z" />
        </>
      )
    case "shirt":
      return <path d="M60 46 L80 36 H120 L140 46 L166 84 L148 94 L136 72 V204 H64 V72 L52 94 L34 84 Z M92 36 L100 58 L108 36" />
    case "knit":
      return (
        <>
          <path d="M55 52 L76 40 H124 L145 52 L170 92 L150 102 L136 78 V210 H64 V78 L50 102 L30 92 Z" />
          <path d="M70 96 H130 M70 116 H130 M70 136 H130 M70 156 H130" fill="none" />
        </>
      )
    case "jacket":
      return <path d="M52 48 L78 36 H122 L148 48 L176 96 L154 108 L140 74 V214 H60 V74 L46 108 L24 96 Z M100 48 V214" />
    case "coat":
      return <path d="M58 34 L80 26 H120 L142 34 L176 88 L156 98 L142 62 V228 H58 V62 L44 98 L24 88 Z M100 40 V228" />
    case "puffer":
      return (
        <>
          <path d="M48 50 L74 38 H126 L152 50 L178 100 L156 112 L140 78 V216 H60 V78 L44 112 L22 100 Z" />
          <path d="M64 90 H136 M64 112 H136 M64 134 H136 M64 156 H136 M64 178 H136" fill="none" />
        </>
      )
    case "jeans":
      return <path d="M68 42 H132 L138 150 L154 230 H118 L108 150 L100 168 L92 150 L82 230 H46 L62 150 Z" />
    case "trousers":
      return <path d="M70 40 H130 L134 140 L146 232 H112 L104 150 H96 L88 232 H54 L66 140 Z" />
    case "skirt":
      return <path d="M72 48 H128 L156 220 H44 Z" />
    case "dress":
      return <path d="M78 36 H122 L136 70 L168 220 H32 L64 70 Z M92 36 H108 L100 58 Z" />
    case "shoes":
      return <path d="M28 150 H118 L168 168 L172 190 H36 L28 170 Z" />
    case "bag":
      return (
        <>
          <path d="M58 90 H142 L150 210 H50 Z" />
          <path d="M78 90 C78 60 122 60 122 90" fill="none" strokeWidth="3" />
        </>
      )
  }
}

export function isStoreColor(value: string): value is StoreColor {
  return value in COLOR_HEX
}
