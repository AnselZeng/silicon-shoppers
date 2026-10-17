import { Suspense } from "react"
import { StoreShell } from "@/components/store/StoreShell"

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f6f3ee]" />}>
      <StoreShell>{children}</StoreShell>
    </Suspense>
  )
}
