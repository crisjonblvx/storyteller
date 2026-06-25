/** Unified lifecycle phases for AI jobs (review, media, etc.). */
export type AiJobPhase =
  | 'queued'
  | 'generating'
  | 'downloading'
  | 'probing'
  | 'complete'
  | 'failed'

export type AiJobProgress = {
  phase: AiJobPhase
  detail?: string
  progress?: number
  localPath?: string
  error?: string
}

/** User-facing status line for in-flight or completed AI jobs. */
export function formatAiJobStatus(p: AiJobProgress): string {
  if (p.phase === 'queued') return p.detail ?? 'Queued…'
  if (p.phase === 'generating') return p.detail ?? 'Generating…'
  if (p.phase === 'downloading') return p.detail ?? 'Downloading…'
  if (p.phase === 'probing') return p.detail ?? 'Finalizing…'
  if (p.phase === 'complete') {
    return p.localPath ? `Ready — saved (${p.localPath})` : 'Ready'
  }
  if (p.phase === 'failed') return formatAiJobFailure(p.error)
  return p.detail ?? ''
}

/** Consistent failure copy across AI surfaces. */
export function formatAiJobFailure(error?: string): string {
  const msg = error?.trim()
  return msg ? `Couldn’t complete — ${msg}` : 'Something went wrong. Try again.'
}
