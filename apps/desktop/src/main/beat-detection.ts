import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import { resolveUnpackedBinary } from './bin-path.js'

export interface BeatAnalysisResult {
  ok: true
  bpm: number
  /** Beat timestamps in seconds, sorted ascending */
  beats: number[]
  durationSeconds: number
}

export interface BeatAnalysisError {
  ok: false
  error: string
}

const SAMPLE_RATE = 44100

/**
 * Decode `filePath` to mono 44.1kHz PCM, run the BeatRoot onset/tempo tracker
 * via the `music-tempo` package, and return BPM + beat timestamps.
 *
 * All heavy work happens in the main process so the renderer stays responsive.
 */
export async function analyzeBeat(
  filePath: string
): Promise<BeatAnalysisResult | BeatAnalysisError> {
  const bin = ffmpegPath ? resolveUnpackedBinary(ffmpegPath) : null
  if (!bin) return { ok: false, error: 'ffmpeg-static binary not found' }

  const tmpPcm = join(tmpdir(), `storyteller-beat-${randomBytes(6).toString('hex')}.f32`)

  try {
    await extractMonoPcm(bin, filePath, tmpPcm)

    const raw = await readFile(tmpPcm)
    // Each sample is 4 bytes (32-bit float little-endian)
    const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
    const durationSeconds = samples.length / SAMPLE_RATE

    // music-tempo exports a class — handle both CJS default and named exports
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('music-tempo') as any
    const MusicTempo: new (data: Float32Array, opts?: object) => { tempo: number; beats: number[] } =
      mod.default ?? mod.MusicTempo ?? mod

    const mt = new MusicTempo(samples)

    return {
      ok: true,
      bpm: Math.round(mt.tempo * 10) / 10,
      beats: mt.beats,
      durationSeconds
    }
  } catch (err) {
    return { ok: false, error: String(err) }
  } finally {
    try {
      await unlink(tmpPcm)
    } catch {
      /* temp file cleanup — ignore */
    }
  }
}

function extractMonoPcm(
  ffmpeg: string,
  inputPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-vn',         // skip video streams
      '-ac', '1',    // downmix to mono
      '-ar', String(SAMPLE_RATE),
      '-f', 'f32le', // raw 32-bit float little-endian PCM
      outputPath
    ]

    const child = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim().slice(-2000) || `ffmpeg exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}
