import { Suspense } from "react"
import { ProductDetail } from "@/components/store/ProductDetail"
import { PRODUCTS } from "@/lib/store/catalog"

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ id: product.id }))
}

async function Product({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProductDetail id={id} />
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-xs tracking-[0.2em] uppercase">Loading</div>}>
      <Product params={params} />
    </Suspense>
  )
}
