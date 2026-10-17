import type { CheckoutVariant } from "@/lib/layout/types"

export interface MockSession {
  id: string
  amount: number
  mode: CheckoutVariant
  last4: string
  status: "created" | "captured"
  mock: true
}

export interface MockCapture {
  orderId: string
  amount: number
  last4: string
  mode: CheckoutVariant
  loyaltyPoints: number
  status: "captured"
  mock: true
}

const LAST4: Record<CheckoutVariant, string> = {
  guest_fast: "4242",
  click_to_pay: "1111",
  saved_card: "1881",
  loyalty_pay: "9000",
}

let sequence = 1

export function createMockSession(input: { amount: number; mode: CheckoutVariant }): MockSession {
  const id = `vs_mock_${Date.now().toString(36)}_${sequence}`
  sequence += 1
  return {
    id,
    amount: Math.round(input.amount),
    mode: input.mode,
    last4: LAST4[input.mode],
    status: "created",
    mock: true,
  }
}

export function captureMockSession(
  session: MockSession,
  options: { awardLoyalty: boolean },
): MockCapture {
  const stamp = (sequence * 97 + session.amount) % 9000
  sequence += 1
  return {
    orderId: `AN-${String(1000 + stamp).padStart(4, "0")}`,
    amount: session.amount,
    last4: session.last4,
    mode: session.mode,
    loyaltyPoints: options.awardLoyalty ? Math.round(session.amount) : 0,
    status: "captured",
    mock: true,
  }
}

export function isCheckoutVariant(value: unknown): value is CheckoutVariant {
  return (
    value === "guest_fast" ||
    value === "click_to_pay" ||
    value === "saved_card" ||
    value === "loyalty_pay"
  )
}
