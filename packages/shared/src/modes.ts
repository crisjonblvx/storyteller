export const STORY_MODES = ['story', 'journalism', 'creator', 'highlight', 'music_video', 'commercial', 'documentary'] as const
export type StoryMode = (typeof STORY_MODES)[number]

export function isStoryMode(value: string): value is StoryMode {
  return (STORY_MODES as readonly string[]).includes(value)
}

export type StoryIntent =
  | 'brand_intro'
  | 'music_video'
  | 'commercial'
  | 'podcast'
  | 'news_package'
  | 'documentary'
  | 'social_reel'
  | 'event_highlight'
  | 'brand_story'
  | 'sports_highlight'

export type PrimaryGoal = 'fast_social' | 'professional' | 'broadcast'

export function intentToMode(intent: StoryIntent): StoryMode {
  const map: Record<StoryIntent, StoryMode> = {
    brand_intro: 'story',
    music_video: 'music_video',
    commercial: 'commercial',
    podcast: 'story',
    news_package: 'journalism',
    documentary: 'documentary',
    social_reel: 'creator',
    event_highlight: 'creator',
    brand_story: 'story',
    sports_highlight: 'highlight',
  }
  return map[intent]
}
