import {
  emptyScores,
  EVIDENCE_RULES,
  meetsThreshold,
  softmax,
  topPersona,
} from "@/lib/sim/evidence"
import type { PersonaId } from "@/lib/personas/schema"
import type { StoreEvent } from "@/lib/sim/protocol"

export interface Inference {
  classified: boolean
  personaId: PersonaId | null
  probabilities: Record<PersonaId, number>
  scores: Record<PersonaId, number>
  eventCount: number
  newlyClassified: boolean
  changed: boolean
}

export class EvidenceEngine {
  private scores: Record<PersonaId, number> = emptyScores()
  private eventCount = 0
  private classifiedId: PersonaId | null = null

  reset() {
    this.scores = emptyScores()
    this.eventCount = 0
    this.classifiedId = null
  }

  update(event: StoreEvent): Inference {
    this.eventCount += 1
    for (const rule of EVIDENCE_RULES) {
      if (rule.event !== event.type) continue
      if (rule.when && !rule.when(event)) continue
      for (const id of Object.keys(rule.weights) as PersonaId[]) {
        const weight = rule.weights[id]
        if (weight) this.scores[id] += weight
      }
    }
    const probabilities = softmax(this.scores)
    const top = topPersona(probabilities)
    let newlyClassified = false
    let changed = false
    if (meetsThreshold(top.probability, this.eventCount)) {
      if (!this.classifiedId) {
        this.classifiedId = top.id
        newlyClassified = true
      } else if (this.classifiedId !== top.id) {
        this.classifiedId = top.id
        changed = true
      }
    }
    return {
      classified: this.classifiedId !== null,
      personaId: this.classifiedId,
      probabilities,
      scores: { ...this.scores },
      eventCount: this.eventCount,
      newlyClassified,
      changed,
    }
  }
}

export function formatProbabilities(probabilities: Record<PersonaId, number>): string {
  return (Object.keys(probabilities) as PersonaId[])
    .map((id) => `${id} ${(probabilities[id] * 100).toFixed(0)}%`)
    .join(" · ")
}
