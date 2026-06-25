/**
 * Fingerprint for source media so unchanged files skip re-transcribe billing.
 *
 * Prefer content hash when available; fall back to path + size + mtime for a
 * cheap first pass. Gateway persistence of fingerprints is not wired yet.
 */

export type SourceMediaFingerprint = {
  /** Absolute path at fingerprint time (informational — not the sole dedupe key). */
  localPath?: string
  sizeBytes: number
  /** File mtime in milliseconds since epoch. */
  mtimeMs: number
  /** SHA-256 or similar when computed (preferred for stable dedupe). */
  contentHash?: string
}

export type SourceMediaFingerprintInput = {
  localPath: string
  sizeBytes: number
  mtimeMs: number
  contentHash?: string
}

/** Build a fingerprint record from IPC / filesystem stat. */
export function buildSourceMediaFingerprint(input: SourceMediaFingerprintInput): SourceMediaFingerprint {
  return {
    localPath: input.localPath,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    contentHash: input.contentHash
  }
}

/** Stable string key for lookup in a transcript cache or billing ledger. */
export function fingerprintLookupKey(fp: SourceMediaFingerprint): string {
  if (fp.contentHash) return `hash:${fp.contentHash}`
  const path = fp.localPath ?? 'unknown'
  return `stat:${path}:${fp.sizeBytes}:${fp.mtimeMs}`
}

/** True when two fingerprints refer to the same unchanged source media. */
export function fingerprintsMatch(a: SourceMediaFingerprint, b: SourceMediaFingerprint): boolean {
  if (a.contentHash && b.contentHash) return a.contentHash === b.contentHash
  return (
    a.sizeBytes === b.sizeBytes &&
    a.mtimeMs === b.mtimeMs &&
    Boolean(a.localPath && b.localPath && a.localPath === b.localPath)
  )
}
