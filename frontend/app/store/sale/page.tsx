import { Suspense } from "react"
import { ListingView } from "@/components/store/ListingView"

export default function Page() {
  return (
    <Suspense fallback={<div className="px-6 py-10 text-xs tracking-[0.2em] uppercase">Loading</div>}>
      <ListingView mode="sale" />
    </Suspense>
  )
}
