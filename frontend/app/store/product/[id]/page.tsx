import { Suspense } from "react"
import { ProductDetail } from "@/components/store/ProductDetail"
import { PRODUCTS } from "@/lib/store/catalog"

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ id: product.id }))
}

async function Details({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProductDetail id={id} />
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={null}>
      <Details params={params} />
    </Suspense>
  )
}
