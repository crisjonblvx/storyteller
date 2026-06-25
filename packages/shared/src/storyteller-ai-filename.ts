export type StorytellerAiMediaKind = 'still' | 'motion'

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)
}

/** Neutral on-disk base name for generated media (no provider prefix). */
export function storytellerAiFileBase(params: {
  kind: StorytellerAiMediaKind
  slotId?: string
}): string {
  const slotSafe = sanitizeId(params.slotId ?? params.kind)
  return `storyteller-${params.kind}-${slotSafe}-${Date.now()}`
}

/** Neutral user-facing filename including extension. */
export function storytellerAiFileName(params: {
  kind: StorytellerAiMediaKind
  id?: string
}): string {
  const ext = params.kind === 'still' ? 'png' : 'mp4'
  const shortId = sanitizeId(params.id ?? `${Date.now()}`)
  return `storyteller-${params.kind}-${shortId}.${ext}`
}
