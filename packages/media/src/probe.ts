export interface MediaProbeResult {
  durationSeconds: number | null
  width: number | null
  height: number | null
  fps: number | null
  /** First-frame SMPTE timecode from stream tags (seconds from 00:00:00:00 at probed fps). */
  startTimecodeSeconds: number | null
  audioChannels: number | null
  codecVideo: string | null
  codecAudio: string | null
  hasVideoStream: boolean
  hasAudioStream: boolean
}

/** Stub for non-Electron contexts — Electron main runs ffprobe and returns parsed JSON. */
export async function probeMedia(_filePath: string): Promise<MediaProbeResult> {
  return {
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
}
