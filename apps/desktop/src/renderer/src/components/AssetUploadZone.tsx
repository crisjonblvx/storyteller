import { useCallback, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoryMode } from '@storyteller/shared'
import { importLocalMediaToProject } from '@renderer/lib/asset-upload'
import { guessMimeFromFilename } from '@renderer/lib/mime'

type Bridge = {
  pickMediaFiles?: (opts?: { multiple?: boolean }) => Promise<{ ok?: boolean; paths?: string[] }>
  getPathForFile?: (file: File) => string
}

function getBridge(): Bridge {
  return (typeof window !== 'undefined' && window.storyteller) || {}
}

function fileFromAbsolutePath(absPath: string): File {
  const base = absPath.split(/[/\\]/).pop() ?? 'media'
  const f = new File([], base, { type: guessMimeFromFilename(base) })
  Object.assign(f, { path: absPath })
  return f
}

/**
 * Electron 32+ stopped surfacing `File.path` on drag-drop and input files.
 * Use the preload bridge `webUtils.getPathForFile()` to resolve the absolute
 * path, then return a clone of the File with `.path` re-attached so the rest
 * of the import pipeline keeps working uniformly.
 */
function attachPathsToFiles(files: File[]): File[] {
  const bridge = getBridge()
  if (!bridge.getPathForFile) return files
  return files.map((f) => {
    if (typeof (f as File & { path?: string }).path === 'string' && (f as File & { path?: string }).path) {
      return f
    }
    const abs = bridge.getPathForFile!(f)
    if (abs) {
      Object.assign(f, { path: abs })
    }
    return f
  })
}

export function AssetUploadZone(props: {
  projectId: string
  projectTitle: string
  projectMode: StoryMode
  /** When null, imports register only on this device (no Supabase). */
  supabaseClient: SupabaseClient | null
  /** Required when `supabaseClient` is set (cloud project row + asset rows). */
  userId?: string
  disabled?: boolean
  disabledReason?: string
  onUploaded?: () => void
}) {
  const {
    projectId,
    projectTitle,
    projectMode,
    supabaseClient,
    userId,
    disabled,
    disabledReason,
    onUploaded
  } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const runImport = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      if (supabaseClient && !userId) {
        setStatus('Sign in to sync imports to your cloud project, or work offline without Supabase.')
        return
      }
      setBusy(true)
      setStatus(null)
      let res
      try {
        res = await importLocalMediaToProject({
          supabase: supabaseClient,
          userId,
          projectId,
          projectTitle,
          projectMode,
          files,
          onProgress: (p) => {
            if (p.phase === 'error') {
              setStatus(`${p.name}: ${p.message ?? 'error'}`)
            }
          }
        })
      } catch (err) {
        console.error('[AssetUploadZone] import threw:', err)
        setBusy(false)
        setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      setBusy(false)
      if (!res.ok) {
        setStatus(res.error)
      } else if (res.imported === 0) {
        const msg = res.skipped > 0
          ? `No files imported — ${res.skipped} file${res.skipped > 1 ? 's' : ''} skipped (unsupported type or missing path). Check the DevTools console for details.`
          : 'No files imported.'
        setStatus(msg)
      } else {
        const plural = res.imported === 1 ? '1 file' : `${res.imported} files`
        setStatus(
          supabaseClient
            ? `Import complete — ${plural} saved. Large files stay on disk; metadata saved to your project.`
            : `Import complete — ${plural} saved locally on this device.`
        )
        onUploaded?.()
      }
    },
    [onUploaded, projectId, projectMode, projectTitle, supabaseClient, userId]
  )

  const onInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list?.length) return
    await runImport(attachPathsToFiles(Array.from(list)))
    e.target.value = ''
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const dt = e.dataTransfer.files
    if (!dt?.length) return
    await runImport(attachPathsToFiles(Array.from(dt)))
  }

  const pickFromDialog = async () => {
    const b = getBridge()
    if (b.pickMediaFiles) {
      const picked = await b.pickMediaFiles({ multiple: true })
      if (!picked.paths?.length) return
      const files = picked.paths.map((p) => fileFromAbsolutePath(p))
      if (files.length) await runImport(files)
      return
    }
    inputRef.current?.click()
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{
        border: `1px dashed ${dragOver ? 'rgba(110,231,197,0.55)' : 'rgba(110,231,197,0.25)'}`,
        borderRadius: 12,
        padding: 18,
        background: dragOver ? 'rgba(110,231,197,0.06)' : 'rgba(15,16,20,0.5)',
        opacity: disabled ? 0.55 : 1
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        style={{ display: 'none' }}
        onChange={onInputChange}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontWeight: 600 }}>Import media from this device</div>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Drag files here or choose from your computer. Local import is the default — large files stay on disk. Optional
            cloud sync is available when you sign in with Supabase.
          </div>
          {disabled && (
            <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{disabledReason}</div>
          )}
          {status && !disabled && (
            <div style={{ color: status.includes('No files imported') || status.includes('Import failed') ? 'var(--danger)' : 'var(--muted)', fontSize: 12, marginTop: 8 }}>{status}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            disabled={disabled || busy}
            style={btnPrimary}
            onClick={() => void pickFromDialog()}
          >
            {busy ? 'Working…' : 'Select files'}
          </button>
          <button
            type="button"
            disabled={disabled || busy}
            style={btnGhost}
            onClick={() => void pickFromDialog()}
          >
            Browse…
          </button>
        </div>
      </div>
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%)',
  color: '#061210',
  fontWeight: 600,
  fontSize: 13
}
const btnGhost: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13
}
