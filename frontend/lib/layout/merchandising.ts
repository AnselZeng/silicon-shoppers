import type { ColorMerchandising } from "@/lib/layout/types"
import type { Product } from "@/lib/store/types"

export interface MerchCard {
  product: Product
  color: string
}

export function merchandisedCards(products: Product[], mode: ColorMerchandising): MerchCard[] {
  if (mode !== "split_colors") {
    return products.map((product) => ({
      product,
      color: product.colors[0] ?? "black",
    }))
  }
  return products.slice(0, 4).flatMap((product) =>
    product.colors.slice(0, 3).map((color) => ({ product, color })),
  )
}
