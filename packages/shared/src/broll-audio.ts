/** Appended to I2V motion prompts — diegetic SFX yes; music/VO no. */
export const BROLL_MOTION_AUDIO_POLICY =
  'Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover.'

export function appendBrollMotionAudioPolicy(motionPrompt: string): string {
  const trimmed = motionPrompt.trim()
  if (!trimmed) return BROLL_MOTION_AUDIO_POLICY
  if (/no music|diegetic ambient|no narrator/i.test(trimmed)) return trimmed
  const base = trimmed.endsWith('.') ? trimmed : `${trimmed}.`
  return `${base} ${BROLL_MOTION_AUDIO_POLICY}`
}
