import type { MediaProbeResult } from './probe.js'

/** SMPTE `HH:MM:SS:FF` (or drop-frame `HH:MM:SS;FF`) → frame index at integer fps. */
export function parseSmpteTimecodeToFrames(tc: string, fps: number): number | null {
  const m = tc.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const s = Number(m[3])
  const f = Number(m[4])
  if (![h, min, s, f].every(Number.isFinite)) return null
  const rate = Math.max(1, Math.round(fps))
  return (h * 3600 + min * 60 + s) * rate + f
}

export function smpteTimecodeToSeconds(tc: string, fps: number): number | null {
  const frames = parseSmpteTimecodeToFrames(tc, fps)
  if (frames == null) return null
  const rate = Math.max(1, Math.round(fps))
  return frames / rate
}

function parseRatio(s: string | undefined): number | null {
  if (!s) return null
  const parts = s.split('/')
  if (parts.length !== 2) return null
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return a / b
}

/** Parse `ffprobe -print_format json -show_format -show_streams` output */
export function parseFfprobeJson(raw: unknown): MediaProbeResult {
  const empty: MediaProbeResult = {
    durationSeconds: null,
    width: null,
    height: null,
    fps: null,
    startTimecodeSeconds: null,
    audioChannels: null,
    codecVideo: null,
    codecAudio: null,
    hasVideoStream: false,
    hasAudioStream: false
  }
  if (!raw || typeof raw !== 'object') return empty
  const root = raw as { format?: Record<string, unknown>; streams?: unknown[] }
  const format = root.format
  const streams = Array.isArray(root.streams) ? root.streams : []

  let durationSeconds: number | null = null
  if (format?.duration != null) {
    const d = Number(format.duration as string)
    durationSeconds = Number.isFinite(d) ? d : null
  }

  let width: number | null = null
  let height: number | null = null
  let fps: number | null = null
  let codecVideo: string | null = null
  let codecAudio: string | null = null
  let audioChannels: number | null = null
  let hasVideoStream = false
  let hasAudioStream = false
  let startTimecodeSeconds: number | null = null

  for (const s of streams) {
    if (!s || typeof s !== 'object') continue
    const st = s as Record<string, unknown>
    const codecType = String(st.codec_type ?? '')
    if (codecType === 'video' && !hasVideoStream) {
      hasVideoStream = true
      const w = Number(st.width)
      const h = Number(st.height)
      width = Number.isFinite(w) ? w : null
      height = Number.isFinite(h) ? h : null
      codecVideo = st.codec_name != null ? String(st.codec_name) : null
      const r = parseRatio(String(st.avg_frame_rate ?? st.r_frame_rate ?? ''))
      fps = r && r > 0 ? r : null
      const tags = st.tags as Record<string, unknown> | undefined
      const tcRaw = tags?.timecode
      if (typeof tcRaw === 'string' && tcRaw.trim().length > 0 && fps != null && fps > 0) {
        const tcSec = smpteTimecodeToSeconds(tcRaw, fps)
        if (tcSec != null && tcSec > 0) startTimecodeSeconds = tcSec
      }
    }
    if (codecType === 'audio' && !hasAudioStream) {
      hasAudioStream = true
      codecAudio = st.codec_name != null ? String(st.codec_name) : null
      const ch = Number(st.channels)
      audioChannels = Number.isFinite(ch) ? ch : null
    }
  }

  // Still images / single-frame video: use first video dimensions
  if (!hasVideoStream) {
    for (const s of streams) {
      if (!s || typeof s !== 'object') continue
      const st = s as Record<string, unknown>
      if (String(st.codec_type) === 'video') {
        const w = Number(st.width)
        const h = Number(st.height)
        if (Number.isFinite(w)) width = w
        if (Number.isFinite(h)) height = h
        hasVideoStream = true
        break
      }
    }
  }

  if (startTimecodeSeconds == null) {
    for (const s of streams) {
      if (!s || typeof s !== 'object') continue
      const st = s as Record<string, unknown>
      const tags = st.tags as Record<string, unknown> | undefined
      const tcRaw = tags?.timecode
      if (typeof tcRaw !== 'string' || tcRaw.trim().length === 0) continue
      const r = fps ?? parseRatio(String(st.avg_frame_rate ?? st.r_frame_rate ?? ''))
      if (r == null || r <= 0) continue
      const tcSec = smpteTimecodeToSeconds(tcRaw, r)
      if (tcSec != null && tcSec > 0) {
        startTimecodeSeconds = tcSec
        break
      }
    }
  }

  return {
    durationSeconds,
    width,
    height,
    fps,
    startTimecodeSeconds,
    audioChannels,
    codecVideo,
    codecAudio,
    hasVideoStream,
    hasAudioStream
  }
}
