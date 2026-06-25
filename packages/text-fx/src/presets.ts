import type { TextRenderMode } from '@storyteller/shared'

export interface TextPresetPack {
  id: string
  label: string
  description: string
  entrance: 'fade' | 'slide' | 'pop' | 'typewriter'
  hold: 'static' | 'emphasis_pulse' | 'ken_subtle'
  exit: 'fade' | 'slide' | 'snap'
  fontIntent: 'sans_clean' | 'serif_news' | 'display_bold' | 'cinematic_serif'
  emphasis: 'underline_word' | 'scale_keyword' | 'glow_keyword'
  shadow: 'soft' | 'hard' | 'glow'
  safeZone: 'lower_third' | 'center' | 'social_vertical'
  placeholder?: boolean
}

export const TEXT_PRESET_PACKS: TextPresetPack[] = [
  {
    id: 'journalism_clean',
    label: 'Journalism Clean',
    description: 'Lower-third friendly, high legibility for news packages.',
    entrance: 'fade',
    hold: 'static',
    exit: 'fade',
    fontIntent: 'sans_clean',
    emphasis: 'underline_word',
    shadow: 'soft',
    safeZone: 'lower_third'
  },
  {
    id: 'journalism_name_super',
    label: 'Name Super',
    description: 'Two-line lower-third: subject name + title/role. Standard broadcast.',
    entrance: 'slide',
    hold: 'static',
    exit: 'fade',
    fontIntent: 'sans_clean',
    emphasis: 'underline_word',
    shadow: 'soft',
    safeZone: 'lower_third'
  },
  {
    id: 'journalism_location',
    label: 'Location Title',
    description: 'One-line location / dateline super — city, state, or place name.',
    entrance: 'fade',
    hold: 'static',
    exit: 'fade',
    fontIntent: 'sans_clean',
    emphasis: 'underline_word',
    shadow: 'hard',
    safeZone: 'lower_third'
  },
  {
    id: 'journalism_breaking',
    label: 'Breaking / Alert',
    description: 'Bold single-line alert bar for breaking news or urgent context.',
    entrance: 'pop',
    hold: 'emphasis_pulse',
    exit: 'snap',
    fontIntent: 'display_bold',
    emphasis: 'scale_keyword',
    shadow: 'glow',
    safeZone: 'lower_third'
  },
  {
    id: 'clean_podcast',
    label: 'Clean Podcast',
    description: 'Minimal captions for spoken-word and interview clips.',
    entrance: 'slide',
    hold: 'static',
    exit: 'fade',
    fontIntent: 'sans_clean',
    emphasis: 'scale_keyword',
    shadow: 'soft',
    safeZone: 'center'
  },
  {
    id: 'bold_social',
    label: 'Bold Social',
    description: 'High-contrast hooks for vertical and fast cuts.',
    entrance: 'pop',
    hold: 'emphasis_pulse',
    exit: 'snap',
    fontIntent: 'display_bold',
    emphasis: 'glow_keyword',
    shadow: 'glow',
    safeZone: 'social_vertical'
  },
  {
    id: 'cinematic_quote',
    label: 'Cinematic Quote',
    description: 'Filmic pull quotes with gentle motion.',
    entrance: 'fade',
    hold: 'ken_subtle',
    exit: 'fade',
    fontIntent: 'cinematic_serif',
    emphasis: 'scale_keyword',
    shadow: 'hard',
    safeZone: 'center'
  },
  {
    id: 'urban_kinetic',
    label: 'Urban Kinetic',
    description: 'Placeholder — kinetic type for high-energy social.',
    entrance: 'slide',
    hold: 'emphasis_pulse',
    exit: 'slide',
    fontIntent: 'display_bold',
    emphasis: 'glow_keyword',
    shadow: 'glow',
    safeZone: 'social_vertical',
    placeholder: true
  }
]

export const RENDER_MODES: { id: TextRenderMode; label: string }[] = [
  { id: 'burnin', label: 'Burn into final video' },
  { id: 'alpha', label: 'Alpha overlay asset' },
  { id: 'separate', label: 'Separate (sidecar)' }
]
