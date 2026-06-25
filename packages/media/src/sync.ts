export interface SyncAnalysisResult {
  /** Detected offset in ms (audio relative to video) */
  offsetMs: number | null
  confidence: number
  method: 'waveform' | 'timecode' | 'manual' | 'none'
}

/** Hooks for waveform / timecode sync — implement in main process with FFmpeg/correlation */
export async function analyzeWaveformSync(
  _videoPath: string,
  _audioPath: string
): Promise<SyncAnalysisResult> {
  return { offsetMs: null, confidence: 0, method: 'none' }
}

export async function analyzeTimecodeSync(
  _videoPath: string,
  _audioPath: string
): Promise<SyncAnalysisResult> {
  return { offsetMs: null, confidence: 0, method: 'none' }
}
