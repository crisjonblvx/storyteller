/**
 * Higgsfield BYOK credential storage — OS keychain via Electron `safeStorage`.
 *
 * Why not localStorage / .env / a Supabase row?
 *   - localStorage  : readable by any JS in the renderer (XSS, supply-chain).
 *   - .env          : forces the user to edit a dotfile every launch and ships
 *                     the secret into source control if they slip up.
 *   - Supabase row  : the user's Higgsfield secret would then live on a server
 *                     they don't control. BYOK should stay on the user's box.
 *
 * `safeStorage` writes encrypted blobs that only this app on this user account
 * on this machine can decrypt (macOS Keychain on darwin, libsecret on Linux,
 * DPAPI on Windows). The on-disk file is just a base64 encrypted blob — even
 * if someone copies the file off the machine, they can't read it.
 *
 * We persist a tiny JSON file at `userData/higgsfield-credentials.enc` rather
 * than hitting the keychain on every API call, because keychain prompts can
 * pop modal dialogs on first access. One read per app session is enough.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

export interface HiggsfieldCredentials {
  apiKey: string
  apiSecret: string
}

const FILE_NAME = 'higgsfield-credentials.enc'

function credPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

let cached: HiggsfieldCredentials | null | undefined = undefined

/**
 * Persist credentials to the OS keychain (encrypted on disk). Pass `null`
 * to clear them. Call this from the IPC handler that the settings UI hits.
 *
 * Returns `{ ok: false }` on platforms where `safeStorage.isEncryptionAvailable()`
 * is false — we deliberately refuse to write plaintext as a fallback because
 * the whole point of this layer is that we never have a plaintext API secret
 * sitting on disk.
 */
export function saveHiggsfieldCredentials(
  creds: HiggsfieldCredentials | null
): { ok: true } | { ok: false; error: string } {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        error:
          'OS keychain encryption is not available on this machine. Higgsfield BYOK is disabled — please use a managed runner (Runway) instead.'
      }
    }
    const path = credPath()
    if (!creds) {
      if (existsSync(path)) unlinkSync(path)
      cached = null
      return { ok: true }
    }
    const apiKey = creds.apiKey.trim()
    const apiSecret = creds.apiSecret.trim()
    if (!apiKey || !apiSecret) {
      return { ok: false, error: 'Both API key and API secret are required.' }
    }
    const enc = safeStorage.encryptString(JSON.stringify({ apiKey, apiSecret }))
    writeFileSync(path, enc)
    cached = { apiKey, apiSecret }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/**
 * Read credentials. Cached after first read; pass `force = true` to bust
 * the cache (used after a save so the next call sees the new value).
 */
export function getHiggsfieldCredentials(force = false): HiggsfieldCredentials | null {
  if (!force && cached !== undefined) return cached
  try {
    const path = credPath()
    if (!existsSync(path)) {
      cached = null
      return null
    }
    if (!safeStorage.isEncryptionAvailable()) {
      cached = null
      return null
    }
    const enc = readFileSync(path)
    const decoded = safeStorage.decryptString(enc)
    const parsed = JSON.parse(decoded) as Partial<HiggsfieldCredentials>
    if (typeof parsed.apiKey !== 'string' || typeof parsed.apiSecret !== 'string') {
      cached = null
      return null
    }
    cached = { apiKey: parsed.apiKey, apiSecret: parsed.apiSecret }
    return cached
  } catch {
    cached = null
    return null
  }
}

/** Cheap presence check for the renderer — never returns the secret itself. */
export function hasHiggsfieldCredentials(): boolean {
  return getHiggsfieldCredentials() !== null
}
