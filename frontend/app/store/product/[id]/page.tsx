import { ProductDetail } from "@/components/store/ProductDetail"
import { PRODUCTS } from "@/lib/store/catalog"

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ id: product.id }))
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProductDetail id={id} />
}
