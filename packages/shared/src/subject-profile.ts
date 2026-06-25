/**
 * How on-screen humans should appear in B-roll prompts.
 * - `standard`: describe people using Subject Profile when relevant; never invent identity if unspecified.
 * - `no_visible_people`: environments, objects, abstract — no people.
 * - `hands_only`: close-ups of hands / props, no faces.
 * - `diverse_crowd`: anonymous crowd / group shots; avoid singling out one ethnicity unless profile says otherwise.
 */
export type SubjectVisibility =
  | 'standard'
  | 'no_visible_people'
  | 'hands_only'
  | 'diverse_crowd'

/**
 * Project-level defaults for B-roll / video-gen prompts involving humans.
 * Empty optional fields mean "do not assume or invent" — never default to one ethnicity globally.
 */
export interface SubjectProfile {
  visibility: SubjectVisibility
  /** User-specified; e.g. "Black", "South Asian", "Latine" — only applied when visibility allows people */
  ethnicityOrAppearance?: string
  genderPresentation?: string
  ageRange?: string
  skinTone?: string
  hairstyleNotes?: string
  wardrobeNotes?: string
}

export function defaultSubjectProfile(): SubjectProfile {
  return {
    visibility: 'standard',
    ethnicityOrAppearance: '',
    genderPresentation: '',
    ageRange: '',
    skinTone: '',
    hairstyleNotes: '',
    wardrobeNotes: ''
  }
}

export function normalizeSubjectProfile(raw: unknown): SubjectProfile {
  const d = defaultSubjectProfile()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const vis = r.visibility
  const visibility: SubjectVisibility =
    vis === 'no_visible_people' ||
    vis === 'hands_only' ||
    vis === 'diverse_crowd' ||
    vis === 'standard'
      ? vis
      : 'standard'
  return {
    visibility,
    ethnicityOrAppearance: typeof r.ethnicityOrAppearance === 'string' ? r.ethnicityOrAppearance : '',
    genderPresentation: typeof r.genderPresentation === 'string' ? r.genderPresentation : '',
    ageRange: typeof r.ageRange === 'string' ? r.ageRange : '',
    skinTone: typeof r.skinTone === 'string' ? r.skinTone : '',
    hairstyleNotes: typeof r.hairstyleNotes === 'string' ? r.hairstyleNotes : '',
    wardrobeNotes: typeof r.wardrobeNotes === 'string' ? r.wardrobeNotes : ''
  }
}
