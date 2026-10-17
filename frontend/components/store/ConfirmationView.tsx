"use client"

import Link from "next/link"
import { bagSubtotal, useStorefront } from "@/lib/store/storeState"
import { formatMoney } from "@/lib/utils"

export function ConfirmationView() {
  const order = useStorefront((state) => state.order)
  const bag = useStorefront((state) => state.bag)
  if (!order) {
    return (
      <div className="px-6 py-20">
        <p className="text-[10px] tracking-[0.22em] uppercase">Confirmation</p>
        <h1 className="mt-3 font-serif text-4xl">No order in this session.</h1>
        <Link href="/store" className="mt-6 inline-block text-sm underline">
          Back to the store
        </Link>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <p className="text-[10px] tracking-[0.22em] text-neutral-500 uppercase">Visa · demo only</p>
      <h1 className="mt-3 font-serif text-5xl tracking-tight">Order {order.orderId}</h1>
      <p className="mt-4 text-sm text-neutral-700">
        Paid {formatMoney(order.amount)} with Visa •••• {order.last4}. No charge was sent. No Visa keys were used.
      </p>
      {order.loyaltyPoints > 0 ? (
        <p className="mt-2 text-sm">Loyalty awarded: {order.loyaltyPoints} points.</p>
      ) : null}
      <ul className="mt-8 flex flex-col gap-3 border-t border-[#e4dfd6] pt-4">
        {bag.map((line) => (
          <li key={line.lineId} className="flex justify-between text-sm">
            <span>
              {line.name} · {line.color} / {line.size}
            </span>
            <span>{formatMoney(line.unitPrice * line.qty)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-right text-sm">Total {formatMoney(bagSubtotal(bag) || order.amount)}</p>
      <Link href="/store" className="mt-8 inline-block text-[11px] tracking-[0.18em] uppercase underline">
        Continue browsing
      </Link>
    </div>
  )
}
