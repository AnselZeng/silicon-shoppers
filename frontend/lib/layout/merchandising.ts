import type { ColorMerchandising } from "@/lib/layout/types"
import type { Product } from "@/lib/store/types"

export interface MerchCard {
  product: Product
  color: string
}

/** highlight: colors the model says the shopper picks; a card rests on the first one it comes in. */
export function merchandisedCards(products: Product[], mode: ColorMerchandising, highlight: string[] = []): MerchCard[] {
  if (mode !== "split_colors") {
    return products.map((product) => ({
      product,
      color: product.colors.find((c) => highlight.includes(c)) ?? product.colors[0] ?? "black",
    }))
  }
  return products.slice(0, 4).flatMap((product) =>
    product.colors.slice(0, 3).map((color) => ({ product, color })),
  )
}
