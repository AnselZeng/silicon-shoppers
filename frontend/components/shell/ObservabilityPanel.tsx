"use client"

import { useObsStore } from "@/lib/state/obsStore"
import { formatClock } from "@/lib/utils"

export function ObservabilityPanel() {
  const crumbs = useObsStore((state) => state.crumbs)
  const spans = useObsStore((state) => state.spans)
  const notes = useObsStore((state) => state.notes)
  const runId = useObsStore((state) => state.runId)
  const origin = crumbs[0]?.ts ?? spans[0]?.startTs ?? Date.now()

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto pr-1 text-[11px]">
      <p className="border border-[#fdba74]/40 bg-[#fdba74]/10 px-2 py-1 text-[#fdba74]">
        Local stubs · no DSN
        {runId ? ` · ${runId}` : ""}
      </p>
      <section>
        <h3 className="mb-1 tracking-[0.16em] text-white/50 uppercase">Replay</h3>
        {crumbs.length === 0 ? <p className="text-white/40">No crumbs yet.</p> : null}
        <ul className="flex flex-col gap-0.5">
          {crumbs.slice(-30).map((crumb) => (
            <li key={crumb.id} className="text-white/80">
              <span className="text-white/30">{formatClock(crumb.ts - origin)}</span> {crumb.message}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 tracking-[0.16em] text-white/50 uppercase">Trace</h3>
        {spans.length === 0 ? <p className="text-white/40">No spans yet.</p> : null}
        <ul className="flex flex-col gap-0.5">
          {spans.slice(-24).map((span) => (
            <li key={span.id} className="text-[#86efac]">
              {span.name}
              <span className="text-white/40">
                {" "}
                · {span.status}
                {span.endTs ? ` · ${span.endTs - span.startTs}ms` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 tracking-[0.16em] text-white/50 uppercase">Logs</h3>
        {notes.length === 0 ? <p className="text-white/40">No run notes yet.</p> : null}
        <ul>
          {notes.map((note) => (
            <li key={note.id} className="text-[#fdba74]">
              {note.message}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
