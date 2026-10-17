import {
  captureMockSession,
  createMockSession,
  isCheckoutVariant,
  type MockSession,
} from "@/lib/visa/mock"

const sessions = new Map<string, MockSession>()

function isSession(value: unknown): value is MockSession {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === "string" &&
    typeof record.amount === "number" &&
    typeof record.last4 === "string" &&
    isCheckoutVariant(record.mode) &&
    record.mock === true &&
    (record.status === "created" || record.status === "captured")
  )
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>
  if (body.action === "capture") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
    const provided = isSession(body.session) ? body.session : undefined
    const session = sessions.get(sessionId) ?? provided
    if (!session) {
      return Response.json({ mock: true, error: "not_found" }, { status: 404 })
    }
    sessions.set(session.id, { ...session, status: "captured" })
    const captured = captureMockSession(session, { awardLoyalty: body.awardLoyalty === true })
    return Response.json({ ...captured, mock: true as const })
  }

  const amount = typeof body.amount === "number" ? body.amount : 0
  const mode = isCheckoutVariant(body.mode) ? body.mode : "click_to_pay"
  const session = isSession(body.session) ? body.session : createMockSession({ amount, mode })
  sessions.set(session.id, session)
  return Response.json({ mock: true, session })
}
