import type { StoryIntent } from '@storyteller/shared'

export interface IntentColors {
  gradient: string
  border: string
  glow: string
  text: string
  gradientFrom: string
  gradientTo: string
}

export function getIntentColors(intent: StoryIntent | null | undefined): IntentColors {
  switch (intent) {
    case 'brand_intro':
      return {
        gradient: 'linear-gradient(135deg, rgba(55,48,163,0.3) 0%, rgba(30,27,75,0.15) 100%)',
        border: 'rgba(99,102,241,0.4)',
        glow: 'rgba(99,102,241,0.25)',
        text: '#a5b4fc',
        gradientFrom: '#3730a3',
        gradientTo: '#1e1b4b'
      }
    case 'music_video':
      return {
        gradient: 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(76,29,149,0.15) 100%)',
        border: 'rgba(167,139,250,0.4)',
        glow: 'rgba(167,139,250,0.25)',
        text: '#c4b5fd',
        gradientFrom: '#7c3aed',
        gradientTo: '#4c1d95'
      }
    case 'commercial':
      return {
        gradient: 'linear-gradient(135deg, rgba(180,83,9,0.3) 0%, rgba(120,53,15,0.15) 100%)',
        border: 'rgba(251,191,36,0.4)',
        glow: 'rgba(251,191,36,0.2)',
        text: '#fcd34d',
        gradientFrom: '#b45309',
        gradientTo: '#78350f'
      }
    case 'podcast':
      return {
        gradient: 'linear-gradient(135deg, rgba(109,40,217,0.3) 0%, rgba(46,16,101,0.15) 100%)',
        border: 'rgba(196,181,253,0.4)',
        glow: 'rgba(196,181,253,0.2)',
        text: '#ddd6fe',
        gradientFrom: '#6d28d9',
        gradientTo: '#2e1065'
      }
    case 'news_package':
      return {
        gradient: 'linear-gradient(135deg, rgba(29,78,216,0.3) 0%, rgba(30,58,138,0.15) 100%)',
        border: 'rgba(99,179,237,0.4)',
        glow: 'rgba(99,179,237,0.2)',
        text: '#93c5fd',
        gradientFrom: '#1d4ed8',
        gradientTo: '#1e3a8a'
      }
    case 'documentary':
      return {
        gradient: 'linear-gradient(135deg, rgba(15,118,110,0.3) 0%, rgba(19,78,74,0.15) 100%)',
        border: 'rgba(45,212,191,0.4)',
        glow: 'rgba(45,212,191,0.2)',
        text: '#5eead4',
        gradientFrom: '#0f766e',
        gradientTo: '#134e4a'
      }
    case 'social_reel':
      return {
        gradient: 'linear-gradient(135deg, rgba(217,119,6,0.3) 0%, rgba(146,64,14,0.15) 100%)',
        border: 'rgba(245,158,11,0.4)',
        glow: 'rgba(245,158,11,0.2)',
        text: '#fde68a',
        gradientFrom: '#d97706',
        gradientTo: '#92400e'
      }
    case 'event_highlight':
      return {
        gradient: 'linear-gradient(135deg, rgba(180,83,9,0.3) 0%, rgba(69,26,3,0.15) 100%)',
        border: 'rgba(252,211,77,0.4)',
        glow: 'rgba(252,211,77,0.2)',
        text: '#fef08a',
        gradientFrom: '#b45309',
        gradientTo: '#451a03'
      }
    case 'brand_story':
      return {
        gradient: 'linear-gradient(135deg, rgba(3,105,161,0.3) 0%, rgba(12,74,110,0.15) 100%)',
        border: 'rgba(56,189,248,0.4)',
        glow: 'rgba(56,189,248,0.2)',
        text: '#7dd3fc',
        gradientFrom: '#0369a1',
        gradientTo: '#0c4a6e'
      }
    case 'sports_highlight':
      return {
        gradient: 'linear-gradient(135deg, rgba(14,165,233,0.35) 0%, rgba(2,132,199,0.1) 50%, rgba(8,47,73,0.2) 100%)',
        border: 'rgba(34,211,238,0.5)',
        glow: 'rgba(14,165,233,0.35)',
        text: '#38bdf8',
        gradientFrom: '#0ea5e9',
        gradientTo: '#082f49'
      }
    default:
      return {
        gradient: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.1) 100%)',
        border: 'rgba(99,102,241,0.35)',
        glow: 'rgba(99,102,241,0.2)',
        text: '#a5b4fc',
        gradientFrom: '#6366f1',
        gradientTo: '#8b5cf6'
      }
  }
}
