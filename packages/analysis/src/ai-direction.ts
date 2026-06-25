export type BrollToneHint = 'cinematic' | 'journalistic' | 'social' | 'viral' | 'neutral'

type RankRow = {
  composite: number
  score_social?: number | null
  score_emotional?: number | null
  score_clarity?: number | null
  tags_json?: Record<string, unknown> | null
}

/** Keyword-based boosts for composite score (no LLM). */
export function directionBoostMultiplier(text: string, row: RankRow): number {
  const t = text.toLowerCase()
  let m = 1

  if (/\b(urgent|urgency|fast|breaking|now)\b/i.test(t)) m *= row.tags_json?.punchiness != null ? 1 + 0.08 : 1.06
  if (/\b(cinematic|film|epic|slow.?mo|visual)\b/i.test(t)) m *= 1.05
  if (/\b(viral|tiktok|reels|hook)\b/i.test(t)) {
    const cw = (row.tags_json as { editorialScores?: { clipWorthiness?: number } } | null)?.editorialScores
      ?.clipWorthiness
    const socialBoost = cw != null ? 0.5 + cw * 0.55 : (row.score_social ?? 0.5)
    m *= 1.08 * Math.min(1.2, socialBoost)
  }
  if (/\b(emotional|emotion|heart|tear)\b/i.test(t)) m *= 1.1 * (row.score_emotional ?? 0.5)
  if (/\b(clean|minimal|simple)\b/i.test(t)) m *= 1.04 * (row.score_clarity ?? 0.5)
  if (/\b(news|journalist|report|investigate)\b/i.test(t)) m *= 1.06 * (row.score_clarity ?? 0.5)
  if (/\b(podcast|conversation|talk)\b/i.test(t)) m *= 1.04
  if (/\b(financial|money|market|ceo|business)\b/i.test(t)) {
    const inf = (row.tags_json as { informativeness?: number } | null)?.informativeness
    m *= inf != null && inf > 0.2 ? 1.05 : 1.03
  }

  if (/\b(complete thought|full sentence|clean in|clean out|editor.?ready|usable quote)\b/i.test(t)) {
    const tc = (row.tags_json as { thoughtCompleteness?: number } | null)?.thoughtCompleteness ?? 1
    if (tc >= 1.02) m *= 1.06
    if (tc <= 0.88) m *= 0.9
  }

  return Math.min(1.45, Math.max(0.85, m))
}

export function applyDirectionToRanked<T extends RankRow>(rows: T[], directionText: string | undefined): T[] {
  const d = directionText?.trim()
  if (!d) return rows
  const adjusted = rows.map((r) => {
    const mult = directionBoostMultiplier(d, r)
    return { ...r, composite: r.composite * mult }
  })
  return adjusted.sort((a, b) => b.composite - a.composite)
}

export function inferBrollTone(text: string | undefined): BrollToneHint {
  const t = (text ?? '').toLowerCase()
  if (/\b(news|journalist|report|field|package)\b/.test(t)) return 'journalistic'
  if (/\b(viral|tiktok|reels|social)\b/.test(t)) return 'viral'
  if (/\b(cinematic|film|epic|diary)\b/.test(t)) return 'cinematic'
  if (/\b(podcast|youtube|talk)\b/.test(t)) return 'social'
  return 'neutral'
}

export function suggestTextPresetIds(text: string | undefined): string[] {
  const t = (text ?? '').toLowerCase()
  const out: string[] = []
  if (/\b(bold|dramatic|urgent|breaking|viral)\b/.test(t)) out.push('bold_social', 'urban_kinetic')
  if (/\b(clean|minimal|corporate|podcast)\b/.test(t)) out.push('journalism_clean', 'clean_podcast')
  if (/\b(cinematic|film|epic|quote)\b/.test(t)) out.push('cinematic_quote')
  if (/\b(emotional|soft|intimate)\b/.test(t)) out.push('cinematic_quote', 'clean_podcast')
  if (out.length === 0) out.push('journalism_clean', 'bold_social')
  return [...new Set(out)]
}
