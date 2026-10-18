import { COLOR_HEX, type StoreColor } from "@/config/ui"
import type { GarmentType } from "@/lib/store/types"

const PAPER = "#ebe6dc"

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
  const ink = color === "white" || color === "cream" || color === "beige" ? "#2a2a2a" : "rgba(255,255,255,0.45)"
  return (
    <svg viewBox="0 0 200 260" className={className} role="img" aria-label={`${color} ${type}`}>
      <rect width="200" height="260" fill={PAPER} />
      <g fill={fill} stroke={ink} strokeWidth="1.35" strokeLinejoin="round" strokeLinecap="round">
        {shape(type)}
      </g>
    </svg>
  )
}

function shape(type: GarmentType) {
  switch (type) {
    case "tee":
      return (
        <path d="M68 78 L50 98 L38 82 L64 56 L80 46 Q100 70 120 46 L136 56 L162 82 L150 98 L132 78 V198 H68 Z" />
      )
    case "shirt":
      return (
        <>
          <path d="M66 82 L46 108 L34 90 L64 54 L84 44 L100 66 L116 44 L136 54 L166 90 L154 108 L134 82 V208 H66 Z" />
          <path d="M84 44 L100 66 L116 44 L110 40 L100 54 L90 40 Z" />
          <path d="M100 66 V202 M48 100 H60 M140 100 H152" fill="none" />
        </>
      )
    case "knit":
      return (
        <>
          <path d="M64 76 L48 102 L34 86 L62 52 Q100 78 138 52 L166 86 L152 102 L136 76 V208 H64 Z" />
          <path d="M72 184 H128 M72 192 H128 M72 200 H128" fill="none" />
        </>
      )
    case "jacket":
      return (
        <>
          <path d="M70 78 L50 112 L36 98 L62 52 L78 42 L96 64 L100 56 L104 64 L122 42 L138 52 L164 98 L150 112 L130 78 V206 H70 Z" />
          <path d="M100 64 V206 M74 150 H94 M106 150 H126" fill="none" />
        </>
      )
    case "coat":
      return (
        <>
          <path d="M68 70 L46 108 L32 94 L60 40 L80 30 L98 58 L100 50 L102 58 L120 30 L140 40 L168 94 L154 108 L132 70 V230 H68 Z" />
          <path d="M100 56 V230 M72 168 H92 M108 168 H128" fill="none" />
        </>
      )
    case "puffer":
      return (
        <>
          <path d="M62 78 L44 114 L28 100 L58 52 H84 L92 40 H108 L116 52 H142 L172 100 L156 114 L138 78 V210 H62 Z" />
          <path d="M70 92 H130 M70 114 H130 M70 136 H130 M70 158 H130 M70 180 H130 M100 52 V204" fill="none" />
        </>
      )
    case "jeans":
      return (
        <>
          <path d="M70 46 H130 V62 L126 62 L134 228 H110 L102 142 H98 L90 228 H66 L74 62 H70 Z" />
          <path d="M70 62 H130 M100 62 V96 M78 78 L90 96 M122 78 L110 96" fill="none" />
        </>
      )
    case "trousers":
      return (
        <>
          <path d="M74 42 H126 V58 L122 58 L132 230 H110 L102 140 H98 L90 230 H68 L78 58 H74 Z" />
          <path d="M74 58 H126 M86 64 V220 M114 64 V220" fill="none" />
        </>
      )
    case "skirt":
      return (
        <>
          <path d="M76 52 H124 V68 L152 214 Q100 226 48 214 L76 68 Z" />
          <path d="M76 68 H124" fill="none" />
        </>
      )
    case "dress":
      return (
        <path d="M66 80 L50 98 L38 84 L68 50 Q100 76 132 50 L162 84 L150 98 L134 80 L146 118 L172 222 H28 L54 118 Z" />
      )
    case "shoes":
      return (
        <>
          <path d="M34 208 L34 158 L56 146 L74 126 L112 136 L158 158 L186 178 L186 208 Z" />
          <path d="M72 140 C108 148 142 160 170 174" fill="none" />
        </>
      )
    case "bag":
      return (
        <>
          <path d="M58 96 H142 L150 204 H50 Z" />
          <path d="M78 96 C78 62 122 62 122 96 M100 110 V190 M58 186 H142" fill="none" strokeWidth="2.4" />
        </>
      )
  }
}

export function isStoreColor(value: string): value is StoreColor {
  return value in COLOR_HEX
}
