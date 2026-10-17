export interface HomepageDecision {
  reason: string
  validated: boolean
}

export interface HomepageDoc {
  id: string
  decisions: HomepageDecision[]
}
