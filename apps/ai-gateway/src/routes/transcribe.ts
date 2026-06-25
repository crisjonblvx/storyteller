import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import type { MeteringUnitId } from '@storyteller/ai-gateway'
import type { CreditsService } from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import { whisperFromBytes } from '../services/openaiWhisper.js'
import type { AllowanceService } from '../allowances/allowanceServicePort.js'

const WHISPER_MAX_BYTES = 25 * 1024 * 1024
const SAFE_SINGLE_FILE_BYTES = 24 * 1024 * 1024

export interface TranscribeDeps {
  env: GatewayEnv
  credits: CreditsService
  allowances: AllowanceService
}

export async function registerTranscribeRoutes(
  app: FastifyInstance,
  deps: TranscribeDeps
): Promise<void> {
  const { env, credits, allowances } = deps
  await app.register(multipart, { limits: { fileSize: SAFE_SINGLE_FILE_BYTES } })

  for (const path of ['/v1/capabilities/transcribe', '/v1/transcribe']) {
    app.post(path, async (req, reply) => {
      try {
        const user = await verifySupabaseJwt(req.headers.authorization, env)
        const workDir = join(tmpdir(), 'storyteller-transcribe', randomUUID())
        await mkdir(workDir, { recursive: true })

        try {
          let filename = 'audio.mp3'
          let assetType: string | undefined
          let signedUrl: string | undefined
          let filePath: string | undefined
          let meteringUnit: MeteringUnitId = 'episode_pass'

          const parts = req.parts()
          for await (const part of parts) {
            if (part.type === 'file') {
              filename = part.filename || filename
              filePath = join(workDir, sanitizeFilename(filename))
              await pipeline(part.file, createWriteStream(filePath))
            } else if (part.type === 'field') {
              const v = String(part.value)
              if (part.fieldname === 'filename') filename = v
              if (part.fieldname === 'assetType') assetType = v
              if (part.fieldname === 'signedUrl') signedUrl = v
              if (part.fieldname === 'meteringUnit' && (v === 'episode_pass' || v === 'clip_batch')) {
                meteringUnit = v
              }
            }
          }

          // ── Allowance gate ────────────────────────────────────────────────
          const summary = await credits.getAccountSummary(user.id)
          const allowCheck = await allowances.checkAndConsume(user.id, meteringUnit, summary.planId)
          if (!allowCheck.ok) {
            return reply.status(402).send({
              ok: false,
              error: allowCheck.message,
              code: 'ALLOWANCE_EXCEEDED'
            })
          }

          if (!filePath && signedUrl) {
            filePath = join(workDir, sanitizeFilename(filename))
            const dl = await streamDownloadToFile(signedUrl, filePath)
            if (!dl.ok) {
              return reply.status(400).send({ ok: false, error: dl.error })
            }
          }

          if (!filePath) {
            throw new GatewayError('Provide multipart file or signedUrl.', 'INVALID_REQUEST', 400)
          }

          const st = await stat(filePath)
          if (st.size > SAFE_SINGLE_FILE_BYTES) {
            return reply.status(413).send({
              ok: false,
              error:
                'File exceeds hosted single-shot transcription limit (~24MB). Use a shorter clip or transcribe locally.'
            })
          }

          void assetType
          const buf = await readFile(filePath)
          const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
          if (bytes.byteLength > WHISPER_MAX_BYTES) {
            return reply.status(413).send({ ok: false, error: 'File exceeds Whisper API size limit.' })
          }

          const result = await whisperFromBytes(env, bytes, filename)
          return reply.send(result)
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
        }
      } catch (e) {
        const err = normalizeError(e)
        const status = e instanceof GatewayError ? e.statusCode : 500
        return reply.status(status).send({ ok: false, error: err.message })
      }
    })
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'upload.bin'
}

async function streamDownloadToFile(
  url: string,
  dest: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, error: `Download failed: HTTP ${res.status}` }
    const body = res.body
    if (!body) return { ok: false, error: 'Empty response body' }
    const nodeReadable = Readable.fromWeb(body as import('stream/web').ReadableStream<Uint8Array>)
    await pipeline(nodeReadable, createWriteStream(dest))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
