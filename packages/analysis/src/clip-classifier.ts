import type { ClipCandidateType } from './clip-model.js'

/**
 * Assign exactly ONE dominant editorial type (heuristic, no LLM).
 */
export function classifyClip(text: string): ClipCandidateType {
  const t = text.trim()
  const lower = t.toLowerCase()

  const scores: Record<ClipCandidateType, number> = {
    HOOK: 0,
    PAYOFF: 0,
    EXPLAINER: 0,
    QUESTION: 0,
    CTA: 0,
    CULTURE: 0,
    DATA: 0
  }

  if (
    /\b(subscribe|follow me|follow us|link in bio|sign up|buy now|join the|check out the link|dm me|swipe up|go to my|hit the bell|patreon|merch|get (?:this|the) book|this book is my gift|brand new book|inside of my book|inside my book|download the app|join the app|get on a plan|show description|forward slash|share it with)\b/i.test(
      lower
    ) ||
    /\b(open an account today|take the first step today|take your first step|start with just \$?\d+|start with just five|open an account with \$?0)\b/i.test(
      lower
    ) ||
    /\b(moomoo|robinhood|fidelity|schwab|vanguard)\b/i.test(lower) ||
    /\b[a-z0-9.-]+\.(com|net|org)\b/i.test(lower)
  ) {
    scores.CTA += 4
  }

  if (/\?\s*$/.test(t)) scores.QUESTION += 2
  if (/^(what|why|how|who|where|which|isn't|aren't|don't|doesn't|didn't|could you|would you|have you ever)\b/i.test(lower)) {
    scores.QUESTION += 1.5
  }

  if (/\d/.test(t)) {
    if (/\b(percent|%|million|billion|study|studies|data|research|according to|statistics|survey|report found|published|households|individuals|famil(?:y|ies)|income|debt|paycheck to paycheck)\b/i.test(lower)) {
      scores.DATA += 2.5
    }
  }
  if (/\b(according to the|the data shows|researchers|peer.?reviewed|meta.?analysis)\b/i.test(lower)) scores.DATA += 2
  if (/^(?:\d+%|about \d+%|over \d+%|top \d+%|here'?s a number)\b/i.test(lower)) scores.DATA += 1.8
  if (/\b(live paycheck to paycheck|earning over \$?\d|in-state university|consumer debt|households earning)\b/i.test(lower)) {
    scores.DATA += 1.4
  }

  if (
    /^(imagine|picture this|what if|nobody talks about|stop and listen|here's the thing|the truth is|let me tell you something|i need you to hear|real talk)\b/i.test(
      lower
    )
  ) {
    scores.HOOK += 2.5
  }
  if (/^(here'?s the truth|income, watch this|if you do not tell your money)\b/i.test(lower)) {
    scores.HOOK += 2.4
  }
  if (
    /^(about half|you don'?t need|college is for some people|if your child|your income should be tied|the wrong path|these jobs are bulletproof|when i tell you)\b/i.test(
      lower
    )
  ) {
    scores.HOOK += 2.8
  }
  if (
    /^(a hundred dollars a month|you are officially|three simple investments|just three investments|your money is actually shrinking|the stock market isn'?t just for rich people|math doesn'?t care|you can'?t invest if)\b/i.test(
      lower
    )
  ) {
    scores.HOOK += 3.1
  }
  if (
    /\b(millionaire|zip code|rich people|generational wealth|compound interest|future family)\b/i.test(
      lower
    ) &&
    /\b(is|isn'?t|doesn'?t|can'?t|officially|shrinking)\b/i.test(lower)
  ) {
    scores.HOOK += 1.4
  }
  if (/\b(you won't believe|this changes everything|unpopular opinion)\b/i.test(lower)) scores.HOOK += 1.2

  if (
    /\b(that'?s why|the point is|bottom line|here'?s what i learned|the takeaway|moral of the story|what this means|so in the end|and that'?s the whole point)\b/i.test(
      lower
    )
  ) {
    scores.PAYOFF += 2.2
  }
  if (/\b(so yeah,|and that'?s it\.|that'?s really all|the lesson here)\b/i.test(lower)) scores.PAYOFF += 1.5

  if (
    /\b(as a community|people like us|our generation|this generation|we deserve|representation|being seen|our culture|where i'?m from|growing up we|my family|my kids|generations deep|teach my family|be a team)\b/i.test(lower)
  ) {
    scores.CULTURE += 2
  }
  if (/\b(i feel like we|for us|in our world)\b/i.test(lower)) scores.CULTURE += 1

  if (
    /\b(because|means that|essentially|in other words|step one|first you|the reason is|defines|refers to|break(s| it) down|let me explain)\b/i.test(lower)
  ) {
    scores.EXPLAINER += 1.8
  }
  if (/^(here'?s skill number|job number|i want to give|i would say the method)\b/i.test(lower)) {
    scores.EXPLAINER += 2.2
  }

  let best: ClipCandidateType = 'PAYOFF'
  let max = -1
  ;(Object.keys(scores) as ClipCandidateType[]).forEach((k) => {
    if (scores[k] > max) {
      max = scores[k]
      best = k
    }
  })

  if (max < 0.5) {
    if (/\?\s*$/.test(t)) return 'QUESTION'
    return 'PAYOFF'
  }

  return best
}
