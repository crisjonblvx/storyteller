import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SoundbiteCandidate, StoryMode } from '@storyteller/shared'
import { getProjectFormat } from '@storyteller/shared'
import { buildIntroSequence } from '@storyteller/timeline'
import type { TimelineSequence } from '@storyteller/timeline'
import { useAuthStore } from '@renderer/stores/auth'
import { useProjectWorkflow } from '@renderer/stores/project-workflow'
import { useLocalAssetsStore } from '@renderer/stores/local-assets'
import {
  type QuickMoment,
  momentsToSoundbites,
  rankSegmentsAsMoments,
  rankTextAsMoments
} from '@renderer/lib/quick-reel-ranker'
import { guessMimeFromFilename } from '@renderer/lib/mime'

type StepId = 'story' | 'moments' | 'reel'

type StoryInputMode = 'upload' | 'paste' | 'record' | 'type'

type StoryDraft =
  | {
      kind: 'media'
      assetId: string
      assetPath: string
      assetName: string
      durationSec: number
      transcriptSegments: Array<{ start: number; end: number; text: string }>
    }
  | {
      kind: 'text'
      assetId?: undefined
      text: string
      label: 'Pasted transcript' | 'Typed idea'
    }

const STEPS: Array<{ id: StepId; title: string; helper: string }> = [
  { id: 'story', title: 'Story', helper: 'Start by adding your story. We\u2019ll guide you from there.' },
  { id: 'moments', title: 'Moments', helper: 'Pick the lines that hit. Reorder if you want.' },
  { id: 'reel', title: 'Reel', helper: 'Choose orientation, add captions, export your reel.' }
]

const MODES: Array<{ id: StoryInputMode; label: string; icon: string }> = [
  { id: 'upload', label: 'Upload Video', icon: '\u2601' },
  { id: 'paste', label: 'Paste Transcript', icon: '\u25A4' },
  { id: 'record', label: 'Record Voice', icon: '\u2022' },
  { id: 'type', label: 'Type Idea', icon: '\u270E' }
]

function approxDurationFromText(text: string): number {
  const wpm = 165
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(2, (words / wpm) * 60)
}

export function QuickReelPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const createLocalProject = useProjectWorkflow((s) => s.createLocalProject)
  const updateProject = useProjectWorkflow((s) => s.updateProject)
  const addLocalAssets = useLocalAssetsStore((s) => s.addAssets)

  const [step, setStep] = useState<StepId>('story')
  const [inputMode, setInputMode] = useState<StoryInputMode>('upload')

  const [textBuffer, setTextBuffer] = useState('')

  const [draft, setDraft] = useState<StoryDraft | null>(null)
  const [busy, setBusy] = useState<null | string>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressDetail, setProgressDetail] = useState<string | null>(null)

  const [moments, setMoments] = useState<QuickMoment[]>([])
  const [picked, setPicked] = useState<string[]>([])

  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('vertical')
  const [targetDur, setTargetDur] = useState<30 | 45 | 60>(60)
  const [burnCaptions, setBurnCaptions] = useState(true)
  const [exportPath, setExportPath] = useState<string | null>(null)

  const dropRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /**
   * Subscribe to transcription progress so the user sees forward motion when
   * uploading a long clip — phases come from the chunked-transcription IPC.
   */
  useEffect(() => {
    const unsub = window.storyteller?.onTranscriptionProgress?.((p) => {
      const prefix = p.chunkIndex && p.chunkTotal ? `Chunk ${p.chunkIndex}/${p.chunkTotal} \u2014 ` : ''
      setProgressDetail(`${prefix}${p.detail ?? p.phase}`)
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    const unsub = window.storyteller?.onExportProgress?.((p) => {
      if (p.phase === 'preparing') setProgressDetail(p.detail ?? 'Preparing export\u2026')
      if (p.phase === 'encoding_clip')
        setProgressDetail(`Rendering clip ${p.clipIndex}/${p.clipTotal}\u2026`)
      if (p.phase === 'concatenating') setProgressDetail('Joining moments\u2026')
      if (p.phase === 'overlaying_broll') setProgressDetail('Compositing layers\u2026')
      if (p.phase === 'burning_captions') setProgressDetail('Burning captions\u2026')
      if (p.phase === 'complete') {
        setProgressDetail(null)
        setExportPath(p.outputPath)
        setBusy(null)
      }
      if (p.phase === 'failed') {
        setError(p.error)
        setProgressDetail(null)
        setBusy(null)
      }
    })
    return () => unsub?.()
  }, [])

  const ableMoments = step !== 'story' || !!draft
  const ableReel = (step === 'reel' || picked.length > 0) && !!draft

  const totalPickedDur = useMemo(() => {
    const byId = new Map(moments.map((m) => [m.id, m]))
    return picked.reduce((acc, id) => acc + Math.max(0, (byId.get(id)?.endSec ?? 0) - (byId.get(id)?.startSec ?? 0)), 0)
  }, [picked, moments])

  function resetAll() {
    setDraft(null)
    setMoments([])
    setPicked([])
    setExportPath(null)
    setError(null)
    setProgressDetail(null)
    setStep('story')
  }

  /* ------------------------------------------------------------------- */
  /* Step 1: ingestion (Upload, Paste, Record, Type)                     */
  /* ------------------------------------------------------------------- */

  const handleVideoFromPath = useCallback(
    async (absPath: string, displayName: string) => {
      const bridge = window.storyteller
      if (!bridge?.transcribeMedia) {
        setError('Transcription is only available in the Storyteller desktop app.')
        return
      }
      setError(null)
      setExportPath(null)
      setBusy('Transcribing your video\u2026')
      setProgressDetail('Preparing\u2026')
      try {
        const probe = bridge.probeMedia ? await bridge.probeMedia(absPath) : null
        const probedDur =
          probe && 'ok' in probe && probe.ok && (probe.data as { durationSeconds?: number })?.durationSeconds
        const res = await bridge.transcribeMedia({
          localPath: absPath,
          filename: displayName,
          assetType: 'video'
        })
        if (!res.ok) {
          setError(res.error)
          setBusy(null)
          return
        }
        const segs = res.segments ?? []
        const assetId = `qr-asset-${crypto.randomUUID()}`
        setDraft({
          kind: 'media',
          assetId,
          assetPath: absPath,
          assetName: displayName,
          durationSec: typeof probedDur === 'number' ? probedDur : res.duration ?? segs.at(-1)?.end ?? 0,
          transcriptSegments: segs.map((s) => ({ start: s.start, end: s.end, text: s.text }))
        })
        const ranked = rankSegmentsAsMoments(segs)
        setMoments(ranked)
        const auto = pickInitialMoments(ranked, targetDur)
        setPicked(auto)
        setStep('moments')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [targetDur]
  )

  const handlePickVideo = useCallback(async () => {
    const bridge = window.storyteller
    if (!bridge?.pickMediaFiles) {
      setError('Open this in the Storyteller desktop app to pick a video file.')
      return
    }
    const picked = await bridge.pickMediaFiles({ multiple: false })
    const path = picked.paths?.[0]
    if (!path) return
    const name = path.split(/[\\/]/).pop() ?? 'video'
    await handleVideoFromPath(path, name)
  }, [handleVideoFromPath])

  const handleDroppedFiles = useCallback(
    async (files: FileList) => {
      const f = files[0]
      if (!f) return
      const bridge = window.storyteller
      const path = bridge?.getPathForFile?.(f) ?? (f as File & { path?: string }).path ?? ''
      if (!path) {
        setError('Could not resolve a filesystem path for this file. Use Upload Video instead.')
        return
      }
      const mime = f.type || guessMimeFromFilename(f.name)
      if (mime?.startsWith('audio')) {
        await handleVideoFromPath(path, f.name)
      } else {
        await handleVideoFromPath(path, f.name)
      }
    },
    [handleVideoFromPath]
  )

  const handleSubmitText = useCallback(
    (kind: 'paste' | 'type') => {
      const text = textBuffer.trim()
      if (!text) {
        setError('Add a few sentences first.')
        return
      }
      setError(null)
      const ranked = rankTextAsMoments(text)
      setMoments(ranked)
      setDraft({
        kind: 'text',
        text,
        label: kind === 'paste' ? 'Pasted transcript' : 'Typed idea'
      })
      const auto = pickInitialMoments(ranked, targetDur)
      setPicked(auto)
      setStep('moments')
    },
    [textBuffer, targetDur]
  )

  /* ------------------------------------------------------------------- */
  /* Recording — MediaRecorder + writeTempMedia + transcribeMedia        */
  /* ------------------------------------------------------------------- */

  const [recording, setRecording] = useState<{
    rec: MediaRecorder
    chunks: BlobPart[]
    startedAt: number
  } | null>(null)
  const [recordSeconds, setRecordSeconds] = useState(0)

  useEffect(() => {
    if (!recording) {
      setRecordSeconds(0)
      return
    }
    const tick = () => setRecordSeconds(Math.round((Date.now() - recording.startedAt) / 1000))
    tick()
    const t = window.setInterval(tick, 500)
    return () => window.clearInterval(t)
  }, [recording])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      setRecording({ rec, chunks, startedAt: Date.now() })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone permission denied.')
    }
  }, [])

  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!recording) return
    const { rec, chunks } = recording
    setRecording(null)
    setBusy('Saving recording\u2026')
    try {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        rec.stop()
      })
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      const buf = await blob.arrayBuffer()
      const ext = (rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
      const bridge = window.storyteller
      if (!bridge?.writeTempMedia || !bridge?.transcribeMedia) {
        setError('Recording requires the Storyteller desktop app.')
        setBusy(null)
        return
      }
      const written = await bridge.writeTempMedia({
        bytes: buf,
        filename: `voice-${Date.now()}.${ext}`,
        extension: ext
      })
      if (!written.ok) {
        setError(written.error)
        setBusy(null)
        return
      }
      await handleVideoFromPath(written.path, written.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }, [recording, handleVideoFromPath])

  /* ------------------------------------------------------------------- */
  /* Step 2: moment picker                                               */
  /* ------------------------------------------------------------------- */

  function togglePicked(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }
  function movePicked(id: string, dir: -1 | 1) {
    setPicked((cur) => {
      const idx = cur.indexOf(id)
      if (idx < 0) return cur
      const next = idx + dir
      if (next < 0 || next >= cur.length) return cur
      const copy = cur.slice()
      const [item] = copy.splice(idx, 1)
      copy.splice(next, 0, item!)
      return copy
    })
  }

  const sortedMoments = useMemo(
    () => [...moments].sort((a, b) => b.score - a.score),
    [moments]
  )

  /* ------------------------------------------------------------------- */
  /* Step 3: ensure project + assets, build sequence, export             */
  /* ------------------------------------------------------------------- */

  function ensureProject(): { id: string } {
    const projects = useProjectWorkflow.getState().projects
    const existing = projects.find((p) => p.id.startsWith('quickreel-')) // not unique enough; create fresh per run
    if (existing) return { id: existing.id }
    const title = `Quick Reel \u2014 ${new Date().toLocaleString()}`
    const id = createLocalProject(title, 'creator' as StoryMode)
    return { id }
  }

  const buildSequenceForExport = useCallback(
    (projectId: string): TimelineSequence | null => {
      if (!draft) return null
      const orderedPicked = picked
        .map((id) => moments.find((m) => m.id === id))
        .filter((m): m is QuickMoment => Boolean(m))
      if (orderedPicked.length === 0) return null

      const soundbites: SoundbiteCandidate[] = momentsToSoundbites({
        projectId,
        moments: orderedPicked
      })

      const format = getProjectFormat(orientation)
      const fmtWithExportRes = {
        ...format,
        exportResolution:
          orientation === 'vertical'
            ? { width: 1080, height: 1920 }
            : { width: 1920, height: 1080 }
      }
      const primaryAssetId = draft.kind === 'media' ? draft.assetId : `qr-text-asset-${projectId}`
      return buildIntroSequence({
        projectId,
        mode: 'creator',
        format: fmtWithExportRes,
        primaryAssetId,
        targetDurationSec: targetDur,
        soundbites,
        silenceRegions: []
      })
    },
    [draft, picked, moments, orientation, targetDur]
  )

  const onExport = useCallback(async () => {
    setError(null)
    setExportPath(null)
    if (!draft) {
      setError('Add a story first.')
      return
    }
    if (draft.kind !== 'media') {
      setError(
        'Export needs a real video to render against. Use Upload Video or Record Voice — pasted text alone can\u2019t become a video yet.'
      )
      return
    }
    const bridge = window.storyteller
    if (!bridge?.saveVideoDialog || !bridge?.exportMp4) {
      setError('Export requires the Storyteller desktop app.')
      return
    }
    const dlg = await bridge.saveVideoDialog()
    if (!dlg.ok) return
    const outputPath = 'path' in dlg ? dlg.path : ''
    if (!outputPath) return

    const proj = ensureProject()
    /**
     * Mirror the source asset into the local registry under this project so
     * downstream code (timeline saves, asset picker on the pro workspace) can
     * still find the file if the user opens the project later.
     */
    addLocalAssets(proj.id, [
      {
        id: draft.assetId,
        project_id: proj.id,
        asset_type: 'video',
        storage_mode: 'local',
        local_path: draft.assetPath,
        storage_path: null,
        proxy_path: null,
        media_hash: null,
        is_uploaded: false,
        original_filename: draft.assetName,
        mime_type: guessMimeFromFilename(draft.assetName),
        upload_status: 'not_uploaded',
        probe_status: 'success',
        duration_seconds: draft.durationSec,
        width: null,
        height: null,
        fps: null,
        metadata_json: { importSource: 'quick_reel' },
        sort_order: 0,
        created_at: new Date().toISOString()
      }
    ])
    updateProject(proj.id, {
      format: getProjectFormat(orientation),
      promptPackId: 'auto'
    })

    const sequence = buildSequenceForExport(proj.id)
    if (!sequence) {
      setError('Pick at least one moment first.')
      return
    }

    setBusy('Rendering reel\u2026')
    setProgressDetail('Preparing\u2026')

    let segmentsByAsset: Record<string, unknown[]> | undefined
    if (burnCaptions) {
      segmentsByAsset = {}
      const list = draft.transcriptSegments.map((s, i) => ({
        id: `qr-seg-${i}`,
        project_id: proj.id,
        asset_id: draft.assetId,
        speaker_label: null,
        start_time: s.start,
        end_time: s.end,
        text: s.text,
        confidence: null,
        created_at: new Date().toISOString()
      }))
      segmentsByAsset[draft.assetId] = list
    }

    const res = await bridge.exportMp4({
      outputPath,
      sequence,
      assetPathsById: { [draft.assetId]: draft.assetPath },
      captions: burnCaptions ? { burn: true, segmentsByAsset: segmentsByAsset ?? {} } : undefined
    })
    if (!res.ok) {
      setError(res.error)
      setBusy(null)
    }
  }, [
    draft,
    addLocalAssets,
    updateProject,
    buildSequenceForExport,
    orientation,
    burnCaptions,
    ensureProject
  ])

  const canExport = !!draft && draft.kind === 'media' && picked.length > 0 && !busy
  const goPro = () => {
    if (!draft || draft.kind !== 'media') {
      navigate('/project/new', { state: { mode: 'creator' } })
      return
    }
    const proj = ensureProject()
    addLocalAssets(proj.id, [
      {
        id: draft.assetId,
        project_id: proj.id,
        asset_type: 'video',
        storage_mode: 'local',
        local_path: draft.assetPath,
        storage_path: null,
        proxy_path: null,
        media_hash: null,
        is_uploaded: false,
        original_filename: draft.assetName,
        mime_type: guessMimeFromFilename(draft.assetName),
        upload_status: 'not_uploaded',
        probe_status: 'success',
        duration_seconds: draft.durationSec,
        width: null,
        height: null,
        fps: null,
        metadata_json: { importSource: 'quick_reel' },
        sort_order: 0,
        created_at: new Date().toISOString()
      }
    ])
    navigate(`/project/${proj.id}`)
  }

  /* ------------------------------------------------------------------- */
  /* Render                                                              */
  /* ------------------------------------------------------------------- */

  return (
    <div style={shellStyle}>
      <div style={emberLayer} aria-hidden />
      <div style={vignette} aria-hidden />

      <header style={topBar}>
        <Link to="/" style={brand}>
          <span style={brandWord}>Storyteller.</span>
        </Link>
        <div style={topActions}>
          {/* "Make a Reel in 60 Seconds" button hidden
          <button
            type="button"
            style={cta60s}
            onClick={() => {
              if (step === 'story') {
                document.getElementById('quickreel-story-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              } else {
                setStep('reel')
              }
            }}
            title="Jump to reel export"
          >
            <span aria-hidden>{'\u26A1'}</span>
            <span>Make a Reel in 60 Seconds</span>
          </button>
          */}
          <Link to="/" style={iconBtn} title="Account">
            <span aria-hidden>{'\u29BE'}</span>
          </Link>
          <button type="button" style={iconBtn} title="Menu" onClick={resetAll}>
            <span aria-hidden>{'\u2630'}</span>
          </button>
        </div>
      </header>

      <nav style={stepBar} aria-label="Quick reel progress">
        {STEPS.map((s, i) => {
          const locked = (s.id === 'moments' && !ableMoments) || (s.id === 'reel' && !ableReel)
          const active = step === s.id
          return (
            <button
              key={s.id}
              type="button"
              style={stepPill(active, locked)}
              disabled={locked}
              onClick={() => !locked && setStep(s.id)}
              aria-current={active ? 'step' : undefined}
            >
              <span style={{ opacity: 0.7 }}>{i + 1}.</span> <span>{s.title}</span>
              {locked && <span style={{ marginLeft: 8, fontSize: 11 }} aria-hidden>{'\u26BF'}</span>}
            </button>
          )
        })}
      </nav>

      <p style={stepHelper}>{STEPS.find((s) => s.id === step)?.helper}</p>

      <main style={mainGrid}>
        <section style={card} id="quickreel-story-card">
          {step === 'story' && (
            <StoryStep
              inputMode={inputMode}
              setInputMode={setInputMode}
              textBuffer={textBuffer}
              setTextBuffer={setTextBuffer}
              onPickVideo={handlePickVideo}
              onDropFiles={handleDroppedFiles}
              onSubmitText={handleSubmitText}
              fileInputRef={fileInputRef}
              dropRef={dropRef}
              recording={recording}
              recordSeconds={recordSeconds}
              startRecording={startRecording}
              stopRecording={stopRecordingAndTranscribe}
              busy={busy}
              progressDetail={progressDetail}
              draftLabel={
                draft
                  ? draft.kind === 'media'
                    ? `Loaded \u2014 ${draft.assetName} (${moments.length} moments)`
                    : `${draft.label} \u2014 ${moments.length} moments`
                  : null
              }
              onContinue={() => setStep('moments')}
              canContinue={!!draft && moments.length > 0}
            />
          )}
          {step === 'moments' && (
            <MomentsStep
              moments={sortedMoments}
              picked={picked}
              togglePicked={togglePicked}
              movePicked={movePicked}
              totalPickedDur={totalPickedDur}
              targetDur={targetDur}
              setTargetDur={setTargetDur}
              onBack={() => setStep('story')}
              onContinue={() => setStep('reel')}
              draftKind={draft?.kind ?? 'text'}
            />
          )}
          {step === 'reel' && (
            <ReelStep
              orientation={orientation}
              setOrientation={setOrientation}
              targetDur={targetDur}
              setTargetDur={setTargetDur}
              burnCaptions={burnCaptions}
              setBurnCaptions={setBurnCaptions}
              canExport={canExport}
              onExport={() => void onExport()}
              onBack={() => setStep('moments')}
              busy={busy}
              progressDetail={progressDetail}
              exportPath={exportPath}
              draftKind={draft?.kind ?? 'text'}
              onOpenInPro={goPro}
              estimatedDurSec={
                draft?.kind === 'text'
                  ? approxDurationFromText(draft.text)
                  : Math.min(targetDur, totalPickedDur)
              }
            />
          )}

          {error && (
            <div style={errorBox} role="alert">
              {error}
            </div>
          )}
        </section>

        <aside style={assistantCard} aria-label="Assistant">
          <div style={assistantHead}>
            <div style={avatar} aria-hidden />
            <div style={{ fontSize: 13, color: 'rgba(255,228,180,0.85)', letterSpacing: 0.4 }}>Assistant</div>
          </div>
          <div style={assistantBubble}>{assistantTip(step, draft, picked.length, busy)}</div>
          <div style={{ flex: 1 }} />
          <div style={assistantFooter}>
            {user?.email ? (
              <span>Signed in as {user.email}</span>
            ) : (
              <span style={{ opacity: 0.7 }}>Working offline</span>
            )}
          </div>
        </aside>
      </main>

      <p style={quickStartHint}>
        <span aria-hidden style={{ marginRight: 6 }}>{'\u26A1'}</span>
        <em>Quick Start</em> auto-picks the strongest moments. You can fine-tune in step 2.
      </p>
    </div>
  )
}

/* ====================================================================== */
/* Sub-components                                                          */
/* ====================================================================== */

function StoryStep(props: {
  inputMode: StoryInputMode
  setInputMode: (m: StoryInputMode) => void
  textBuffer: string
  setTextBuffer: (s: string) => void
  onPickVideo: () => void
  onDropFiles: (files: FileList) => void
  onSubmitText: (kind: 'paste' | 'type') => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  dropRef: React.RefObject<HTMLDivElement | null>
  recording: { rec: MediaRecorder; chunks: BlobPart[]; startedAt: number } | null
  recordSeconds: number
  startRecording: () => void
  stopRecording: () => void
  busy: string | null
  progressDetail: string | null
  draftLabel: string | null
  onContinue: () => void
  canContinue: boolean
}) {
  const {
    inputMode,
    setInputMode,
    textBuffer,
    setTextBuffer,
    onPickVideo,
    onDropFiles,
    onSubmitText,
    fileInputRef,
    dropRef,
    recording,
    recordSeconds,
    startRecording,
    stopRecording,
    busy,
    progressDetail,
    draftLabel,
    onContinue,
    canContinue
  } = props

  const [dragOver, setDragOver] = useState(false)

  return (
    <>
      <h1 style={cardTitle}>
        Step <span style={{ color: 'var(--ember-bright)' }}>1</span>: Start With Your Story
      </h1>
      <p style={cardSub}>
        Begin by <strong>uploading</strong> a video clip, pasting a transcript, recording your voice, or typing out an
        idea.
      </p>

      <div style={modeRow}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            style={modeBtn(inputMode === m.id)}
            onClick={() => setInputMode(m.id)}
          >
            <span aria-hidden style={{ fontSize: 16 }}>
              {m.icon}
            </span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {inputMode === 'upload' && (
        <div
          ref={dropRef}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDragOver(false)
            if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files)
          }}
          style={{ ...dropZone, borderColor: dragOver ? 'rgba(255,170,80,0.85)' : 'rgba(255,170,80,0.35)' }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) onDropFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <CloudIcon />
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0.3 }}>Drag &amp; Drop Files Below…</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={primaryBtn} onClick={onPickVideo}>
                Choose video
              </button>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                Browse…
              </button>
            </div>
          </div>
        </div>
      )}

      {inputMode === 'paste' && (
        <div style={textBlock}>
          <textarea
            placeholder="Paste a transcript or notes here…"
            value={textBuffer}
            onChange={(e) => setTextBuffer(e.target.value)}
            style={textarea}
            rows={8}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={ghostBtn} onClick={() => setTextBuffer('')}>
              Clear
            </button>
            <button type="button" style={primaryBtn} onClick={() => onSubmitText('paste')}>
              Find moments
            </button>
          </div>
        </div>
      )}

      {inputMode === 'record' && (
        <div style={textBlock}>
          {recording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', padding: 24 }}>
              <span style={recDot} aria-hidden />
              <div style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', letterSpacing: 1 }}>
                {formatTimer(recordSeconds)}
              </div>
              <button type="button" style={primaryBtn} onClick={stopRecording}>
                Stop &amp; transcribe
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16 }}>
              <div style={{ color: 'rgba(255,228,180,0.85)' }}>
                Tap record, speak your story, then we’ll transcribe it.
              </div>
              <button type="button" style={primaryBtn} onClick={startRecording}>
                <span aria-hidden style={{ marginRight: 8 }}>{'\u25CF'}</span>
                Start recording
              </button>
            </div>
          )}
        </div>
      )}

      {inputMode === 'type' && (
        <div style={textBlock}>
          <textarea
            placeholder="Tell me the story in your own words. Don’t worry about polish."
            value={textBuffer}
            onChange={(e) => setTextBuffer(e.target.value)}
            style={textarea}
            rows={8}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={ghostBtn} onClick={() => setTextBuffer('')}>
              Clear
            </button>
            <button type="button" style={primaryBtn} onClick={() => onSubmitText('type')}>
              Shape it
            </button>
          </div>
        </div>
      )}

      {(busy || progressDetail) && (
        <div style={progressLine} role="status" aria-live="polite">
          <span style={spinner} aria-hidden />
          <span>{busy ?? progressDetail}</span>
          {progressDetail && busy && <span style={{ opacity: 0.65 }}>· {progressDetail}</span>}
        </div>
      )}

      {draftLabel && !busy && <div style={successLine}>{draftLabel}</div>}

      <div style={cardFooter}>
        <span style={{ flex: 1, color: 'rgba(255,228,180,0.55)', fontSize: 12 }}>
          Your file stays on this device. Transcripts and edits sync only if you sign in.
        </span>
        <button type="button" disabled={!canContinue} style={primaryCta(!canContinue)} onClick={onContinue}>
          Continue →
        </button>
      </div>
    </>
  )
}

function MomentsStep(props: {
  moments: QuickMoment[]
  picked: string[]
  togglePicked: (id: string) => void
  movePicked: (id: string, dir: -1 | 1) => void
  totalPickedDur: number
  targetDur: 30 | 45 | 60
  setTargetDur: (n: 30 | 45 | 60) => void
  onBack: () => void
  onContinue: () => void
  draftKind: 'media' | 'text'
}) {
  const { moments, picked, togglePicked, movePicked, totalPickedDur, targetDur, setTargetDur, onBack, onContinue, draftKind } = props
  const pickedSet = new Set(picked)
  const orderedPicked = picked.map((id) => moments.find((m) => m.id === id)).filter(Boolean) as QuickMoment[]

  return (
    <>
      <h1 style={cardTitle}>
        Step <span style={{ color: 'var(--ember-bright)' }}>2</span>: Pick the Moments
      </h1>
      <p style={cardSub}>
        We ranked the strongest lines. Tap to add or remove. Reorder picked moments to set the cut order.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={metricChip}>
          {picked.length} picked · ≈ {Math.round(totalPickedDur)}s
        </span>
        <span style={{ color: 'rgba(255,228,180,0.55)', fontSize: 12 }}>Target</span>
        {[30, 45, 60].map((n) => (
          <button
            key={n}
            type="button"
            style={pillBtn(targetDur === n)}
            onClick={() => setTargetDur(n as 30 | 45 | 60)}
          >
            {n}s
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={momentColumn}>
          <div style={columnHead}>Suggestions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {moments.length === 0 && <div style={{ color: 'rgba(255,228,180,0.55)' }}>No moments yet.</div>}
            {moments.map((m) => {
              const on = pickedSet.has(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  style={momentRow(on)}
                  onClick={() => togglePicked(m.id)}
                  title={on ? 'Remove from reel' : 'Add to reel'}
                >
                  <span style={scoreDot(m.score)} aria-hidden />
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span>{m.text}</span>
                    <span style={momentMeta}>
                      {Math.round(m.score * 100)}% ·{' '}
                      {draftKind === 'media' ? `${m.startSec.toFixed(1)}s` : `~${Math.round(m.endSec - m.startSec)}s`}
                    </span>
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 18, color: on ? 'var(--ember-bright)' : 'rgba(255,228,180,0.5)' }}>
                    {on ? '\u2713' : '+'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div style={momentColumn}>
          <div style={columnHead}>Your reel order</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orderedPicked.length === 0 && (
              <div style={{ color: 'rgba(255,228,180,0.55)' }}>Tap suggestions on the left to add them.</div>
            )}
            {orderedPicked.map((m, idx) => (
              <div key={m.id} style={pickedRow}>
                <span style={{ width: 18, opacity: 0.6 }}>{idx + 1}</span>
                <span style={{ flex: 1 }}>{m.text}</span>
                <button type="button" style={tinyBtn} title="Move up" onClick={() => movePicked(m.id, -1)}>
                  {'\u25B2'}
                </button>
                <button type="button" style={tinyBtn} title="Move down" onClick={() => movePicked(m.id, 1)}>
                  {'\u25BC'}
                </button>
                <button type="button" style={tinyBtnDanger} title="Remove" onClick={() => togglePicked(m.id)}>
                  {'\u2715'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={cardFooter}>
        <button type="button" style={ghostBtn} onClick={onBack}>
          ← Back
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={primaryCta(picked.length === 0)}
          disabled={picked.length === 0}
          onClick={onContinue}
        >
          Continue →
        </button>
      </div>
    </>
  )
}

function ReelStep(props: {
  orientation: 'horizontal' | 'vertical'
  setOrientation: (o: 'horizontal' | 'vertical') => void
  targetDur: 30 | 45 | 60
  setTargetDur: (n: 30 | 45 | 60) => void
  burnCaptions: boolean
  setBurnCaptions: (b: boolean) => void
  canExport: boolean
  onExport: () => void
  onBack: () => void
  busy: string | null
  progressDetail: string | null
  exportPath: string | null
  draftKind: 'media' | 'text'
  onOpenInPro: () => void
  estimatedDurSec: number
}) {
  const {
    orientation,
    setOrientation,
    targetDur,
    setTargetDur,
    burnCaptions,
    setBurnCaptions,
    canExport,
    onExport,
    onBack,
    busy,
    progressDetail,
    exportPath,
    draftKind,
    onOpenInPro,
    estimatedDurSec
  } = props

  const isText = draftKind === 'text'

  return (
    <>
      <h1 style={cardTitle}>
        Step <span style={{ color: 'var(--ember-bright)' }}>3</span>: Build the Reel
      </h1>
      <p style={cardSub}>
        Choose orientation, optionally burn captions, then save your reel as MP4. Estimated length ≈{' '}
        <strong>{Math.round(estimatedDurSec)}s</strong>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <button type="button" style={orientCard(orientation === 'vertical')} onClick={() => setOrientation('vertical')}>
          <div style={vertFrame} />
          <div style={{ marginTop: 8, fontWeight: 600 }}>Vertical 9:16</div>
          <div style={{ color: 'rgba(255,228,180,0.65)', fontSize: 12 }}>Reels / TikTok / Shorts</div>
        </button>
        <button type="button" style={orientCard(orientation === 'horizontal')} onClick={() => setOrientation('horizontal')}>
          <div style={horzFrame} />
          <div style={{ marginTop: 8, fontWeight: 600 }}>Horizontal 16:9</div>
          <div style={{ color: 'rgba(255,228,180,0.65)', fontSize: 12 }}>YouTube / web</div>
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ color: 'rgba(255,228,180,0.55)', fontSize: 12 }}>Target length</span>
        {[30, 45, 60].map((n) => (
          <button
            key={n}
            type="button"
            style={pillBtn(targetDur === n)}
            onClick={() => setTargetDur(n as 30 | 45 | 60)}
          >
            {n}s
          </button>
        ))}
        <label
          style={{
            display: 'inline-flex',
            gap: 8,
            alignItems: 'center',
            marginLeft: 'auto',
            color: isText ? 'rgba(255,228,180,0.4)' : 'rgba(255,228,180,0.85)',
            cursor: isText ? 'not-allowed' : 'pointer'
          }}
          title={isText ? 'Captions need a real video source.' : 'Renders subtitles into the video file.'}
        >
          <input
            type="checkbox"
            checked={burnCaptions && !isText}
            disabled={isText}
            onChange={(e) => setBurnCaptions(e.target.checked)}
          />
          Burn captions into video
        </label>
      </div>

      {isText && (
        <div style={textOnlyNotice}>
          Pasted / typed text alone can\u2019t be rendered into a video. Add a real video clip in step 1 to enable
          export, or open the project in the pro workspace to plan around the text.
        </div>
      )}

      {(busy || progressDetail) && (
        <div style={progressLine} role="status" aria-live="polite">
          <span style={spinner} aria-hidden />
          <span>{busy ?? progressDetail}</span>
          {progressDetail && busy && <span style={{ opacity: 0.65 }}>· {progressDetail}</span>}
        </div>
      )}

      {exportPath && (
        <div style={successBox}>
          <div style={{ fontWeight: 600 }}>Reel exported</div>
          <div style={{ color: 'rgba(255,228,180,0.85)', fontSize: 13, marginTop: 4 }}>{exportPath}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => void window.storyteller?.revealInFolder?.(exportPath)}
            >
              Show in folder
            </button>
            <button type="button" style={ghostBtn} onClick={() => void window.storyteller?.openPath?.(exportPath)}>
              Open
            </button>
          </div>
        </div>
      )}

      <div style={cardFooter}>
        <button type="button" style={ghostBtn} onClick={onBack}>
          ← Back
        </button>
        <button type="button" style={ghostBtn} onClick={onOpenInPro}>
          Open in pro workspace
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" style={primaryCta(!canExport)} disabled={!canExport} onClick={onExport}>
          {busy ? 'Rendering…' : 'Export reel'}
        </button>
      </div>
    </>
  )
}

/* ====================================================================== */
/* Helpers + visual atoms                                                  */
/* ====================================================================== */

function pickInitialMoments(moments: QuickMoment[], targetSec: number): string[] {
  const sorted = [...moments].sort((a, b) => b.score - a.score)
  const out: string[] = []
  let used = 0
  for (const m of sorted) {
    const dur = Math.max(0, m.endSec - m.startSec)
    if (used + dur > targetSec + 1.5) continue
    out.push(m.id)
    used += dur
    if (used >= targetSec) break
  }
  // Reorder by source time so the cut feels chronological by default.
  const byId = new Map(moments.map((m) => [m.id, m]))
  out.sort((a, b) => (byId.get(a)?.startSec ?? 0) - (byId.get(b)?.startSec ?? 0))
  return out
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function assistantTip(step: StepId, draft: StoryDraft | null, pickedCount: number, busy: string | null): string {
  if (busy) return `Working on it \u2014 ${busy.toLowerCase()}`
  if (step === 'story') {
    if (!draft) return 'Drop in your clip or idea. I\u2019ll help you shape it into something viral!'
    return 'Nice. Step 2 lets you keep the strongest moments \u2014 take a look.'
  }
  if (step === 'moments') {
    if (pickedCount === 0) return 'Pick at least one moment. Aim for 3\u20135 short lines for a tight reel.'
    return `${pickedCount} moment${pickedCount === 1 ? '' : 's'} stacked. Reorder to set the rhythm.`
  }
  if (!draft || draft.kind !== 'media')
    return 'For an actual video render you\u2019ll need a clip. Captions need a transcript.'
  return 'Vertical 9:16 plays best on mobile. Captions help \u2248 80% of viewers who watch muted.'
}

function CloudIcon() {
  return (
    <svg width="56" height="36" viewBox="0 0 56 36" fill="none" aria-hidden>
      <defs>
        <linearGradient id="cloudGlow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD79A" />
          <stop offset="100%" stopColor="#C97B2A" />
        </linearGradient>
      </defs>
      <path
        d="M14 26C7 26 3 20 8 14c1-7 11-9 15-3 4-3 12 0 11 7 6 1 7 9 0 11H14z"
        fill="url(#cloudGlow)"
        opacity="0.85"
      />
      <path d="M28 18v8m0 0l-4-4m4 4l4-4" stroke="#1c1106" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- Style tokens ---------- */

const shellStyle: React.CSSProperties = {
  position: 'relative',
  minHeight: '100vh',
  padding: '24px 32px 64px',
  color: '#fbe7c4',
  fontFamily: 'var(--font)',
  background:
    'radial-gradient(120% 80% at 12% 0%, #4a1f08 0%, #1a0a02 55%, #050300 100%)',
  overflow: 'hidden'
}

const emberLayer: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background:
    'radial-gradient(800px 400px at 5% 20%, rgba(255,160,80,0.20), transparent 60%),' +
    'radial-gradient(700px 400px at 90% 80%, rgba(255,140,40,0.18), transparent 60%),' +
    'radial-gradient(500px 280px at 60% 30%, rgba(255,200,120,0.10), transparent 60%)'
}
const vignette: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'radial-gradient(120% 80% at 50% 50%, transparent 60%, rgba(0,0,0,0.45) 100%)'
}

const topBar: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 4px 18px'
}
const brand: React.CSSProperties = { textDecoration: 'none', color: 'inherit' }
const brandWord: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: 0.4,
  color: '#fff5d8',
  textShadow: '0 0 18px rgba(255,180,90,0.45)'
}
const topActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
const cta60s: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  borderRadius: 999,
  background: 'linear-gradient(135deg, rgba(255,184,90,0.18), rgba(120,60,15,0.55))',
  border: '1px solid rgba(255,180,90,0.55)',
  color: '#ffe6b8',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  boxShadow: '0 0 20px rgba(255,170,80,0.25), inset 0 0 12px rgba(255,210,140,0.10)'
}
const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 999,
  border: '1px solid rgba(255,170,90,0.35)',
  background: 'rgba(20,12,4,0.55)',
  color: '#ffe6b8',
  textDecoration: 'none',
  cursor: 'pointer'
}

const stepBar: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 22,
  padding: '14px 24px',
  borderTop: '1px solid rgba(255,170,90,0.20)',
  borderBottom: '1px solid rgba(255,170,90,0.20)',
  background: 'linear-gradient(180deg, rgba(40,18,4,0.55), rgba(20,8,2,0.55))'
}
function stepPill(active: boolean, locked: boolean): React.CSSProperties {
  return {
    padding: '8px 18px',
    borderRadius: 8,
    border: active ? '1px solid rgba(255,200,130,0.85)' : '1px solid transparent',
    background: active
      ? 'linear-gradient(180deg, rgba(255,200,120,0.18), rgba(120,50,10,0.20))'
      : 'transparent',
    color: locked ? 'rgba(255,228,180,0.4)' : '#ffe6b8',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.4,
    cursor: locked ? 'not-allowed' : 'pointer',
    boxShadow: active ? '0 0 18px rgba(255,180,90,0.25)' : 'none'
  }
}
const stepHelper: React.CSSProperties = {
  textAlign: 'center',
  margin: '14px 0 18px',
  color: 'rgba(255,228,180,0.75)',
  fontSize: 13
}

const mainGrid: React.CSSProperties = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 22,
  alignItems: 'start',
  maxWidth: 1180,
  margin: '0 auto'
}

const card: React.CSSProperties = {
  position: 'relative',
  padding: '26px 28px',
  borderRadius: 20,
  border: '1px solid rgba(255,180,90,0.35)',
  background:
    'linear-gradient(180deg, rgba(40,18,4,0.85), rgba(20,8,2,0.85)), radial-gradient(60% 100% at 0% 0%, rgba(255,200,120,0.07), transparent 60%)',
  boxShadow: '0 0 40px rgba(255,160,60,0.10), inset 0 0 24px rgba(255,200,120,0.06)'
}
const cardTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: 0.3,
  textAlign: 'center'
}
const cardSub: React.CSSProperties = {
  margin: '6px 0 18px',
  textAlign: 'center',
  color: 'rgba(255,228,180,0.75)'
}

const modeRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 18 }
function modeBtn(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 12,
    border: active ? '1px solid rgba(255,200,130,0.85)' : '1px solid rgba(255,170,90,0.30)',
    background: active
      ? 'linear-gradient(180deg, rgba(255,200,120,0.20), rgba(120,50,10,0.20))'
      : 'rgba(20,12,4,0.55)',
    color: '#ffe6b8',
    fontSize: 13,
    cursor: 'pointer'
  }
}

const dropZone: React.CSSProperties = {
  border: '1.5px dashed rgba(255,170,80,0.55)',
  borderRadius: 14,
  padding: '30px 16px',
  display: 'grid',
  placeItems: 'center',
  background:
    'radial-gradient(60% 100% at 50% 30%, rgba(255,200,120,0.08), transparent 60%), rgba(20,10,2,0.45)'
}
const textBlock: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12
}
const textarea: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,170,90,0.35)',
  background: 'rgba(20,10,2,0.6)',
  color: '#fbe7c4',
  fontSize: 14,
  resize: 'vertical',
  outline: 'none'
}

const recDot: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  background: '#ff6b6b',
  boxShadow: '0 0 10px rgba(255,107,107,0.85)',
  animation: 'pulse 1s infinite'
}

const cardFooter: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: 22,
  paddingTop: 16,
  borderTop: '1px solid rgba(255,170,90,0.18)'
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, #ffd79a, #c97b2a)',
  color: '#1c1106',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  boxShadow: '0 6px 18px rgba(255,160,60,0.30)'
}
const ghostBtn: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,170,90,0.40)',
  background: 'rgba(20,10,2,0.55)',
  color: '#ffe6b8',
  fontSize: 13,
  cursor: 'pointer'
}
function primaryCta(disabled: boolean): React.CSSProperties {
  return {
    padding: '12px 20px',
    borderRadius: 12,
    border: 'none',
    background: disabled ? 'rgba(120,80,40,0.35)' : 'linear-gradient(135deg, #ffd79a, #c97b2a)',
    color: disabled ? 'rgba(255,228,180,0.55)' : '#1c1106',
    fontWeight: 700,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 6px 18px rgba(255,160,60,0.35)'
  }
}

const errorBox: React.CSSProperties = {
  marginTop: 14,
  padding: 12,
  borderRadius: 10,
  border: '1px solid rgba(255,120,120,0.5)',
  background: 'rgba(60,20,20,0.55)',
  color: '#ffd1d1',
  fontSize: 13
}
const successLine: React.CSSProperties = {
  marginTop: 14,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,200,130,0.4)',
  background: 'rgba(60,30,10,0.55)',
  color: '#ffe6b8',
  fontSize: 13
}
const successBox: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 12,
  border: '1px solid rgba(255,200,130,0.4)',
  background: 'rgba(40,20,4,0.65)',
  color: '#ffe6b8',
  fontSize: 14
}

const progressLine: React.CSSProperties = {
  marginTop: 14,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,170,90,0.30)',
  background: 'rgba(20,10,2,0.55)',
  color: '#ffe6b8',
  fontSize: 13
}
const spinner: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: '2px solid rgba(255,200,130,0.4)',
  borderTopColor: '#ffd79a',
  animation: 'qrspin 0.9s linear infinite'
}

const assistantCard: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 20,
  minHeight: 460,
  borderRadius: 20,
  border: '1px solid rgba(255,180,90,0.35)',
  background:
    'linear-gradient(180deg, rgba(50,22,4,0.85), rgba(15,6,1,0.92))',
  boxShadow: '0 0 30px rgba(255,160,60,0.10) inset'
}
const assistantHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  paddingBottom: 10,
  borderBottom: '1px solid rgba(255,170,90,0.20)'
}
const avatar: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  background:
    'radial-gradient(circle at 30% 30%, #ffd79a, #c97b2a 60%, #5a2c0c 100%)',
  border: '1px solid rgba(255,200,130,0.6)',
  boxShadow: '0 0 12px rgba(255,170,80,0.45)'
}
const assistantBubble: React.CSSProperties = {
  position: 'relative',
  padding: '12px 14px',
  borderRadius: 14,
  background: 'rgba(255,228,180,0.08)',
  border: '1px solid rgba(255,200,130,0.25)',
  color: '#ffe6b8',
  lineHeight: 1.45,
  fontSize: 14
}
const assistantFooter: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,228,180,0.5)',
  borderTop: '1px solid rgba(255,170,90,0.18)',
  paddingTop: 10
}

const quickStartHint: React.CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  marginTop: 18,
  color: 'rgba(255,228,180,0.55)',
  fontSize: 12
}

const metricChip: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid rgba(255,200,130,0.4)',
  background: 'rgba(40,20,4,0.55)',
  color: '#ffe6b8',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums'
}
function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 999,
    border: active ? '1px solid rgba(255,200,130,0.85)' : '1px solid rgba(255,170,90,0.30)',
    background: active ? 'rgba(255,200,120,0.16)' : 'rgba(20,12,4,0.55)',
    color: '#ffe6b8',
    fontSize: 12,
    cursor: 'pointer'
  }
}
const momentColumn: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: '1px solid rgba(255,170,90,0.25)',
  background: 'rgba(15,7,1,0.5)',
  maxHeight: 380,
  overflowY: 'auto'
}
const columnHead: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontSize: 11,
  color: 'rgba(255,228,180,0.6)',
  marginBottom: 8
}
function momentRow(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    padding: '10px 12px',
    borderRadius: 10,
    border: active ? '1px solid rgba(255,200,130,0.7)' : '1px solid rgba(255,170,90,0.20)',
    background: active ? 'rgba(255,200,120,0.10)' : 'rgba(20,12,4,0.55)',
    color: '#ffe6b8',
    fontSize: 13,
    lineHeight: 1.4,
    cursor: 'pointer',
    textAlign: 'left'
  }
}
function scoreDot(score: number): React.CSSProperties {
  const intensity = Math.max(0.15, Math.min(1, score))
  return {
    flex: '0 0 auto',
    marginTop: 6,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: `rgba(255, ${Math.round(170 + intensity * 60)}, ${Math.round(60 + intensity * 60)}, 0.85)`,
    boxShadow: `0 0 ${4 + intensity * 8}px rgba(255,180,80,${0.3 + intensity * 0.4})`
  }
}
const momentMeta: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: 11,
  color: 'rgba(255,228,180,0.6)'
}
const pickedRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,170,90,0.30)',
  background: 'rgba(40,20,4,0.55)',
  fontSize: 13
}
const tinyBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: '1px solid rgba(255,170,90,0.30)',
  background: 'transparent',
  color: '#ffe6b8',
  fontSize: 11,
  cursor: 'pointer'
}
const tinyBtnDanger: React.CSSProperties = {
  ...tinyBtn,
  borderColor: 'rgba(255,120,120,0.45)',
  color: '#ffd1d1'
}

function orientCard(active: boolean): React.CSSProperties {
  return {
    padding: 16,
    borderRadius: 14,
    border: active ? '1px solid rgba(255,200,130,0.85)' : '1px solid rgba(255,170,90,0.25)',
    background: active
      ? 'linear-gradient(180deg, rgba(255,200,120,0.16), rgba(120,50,10,0.20))'
      : 'rgba(20,12,4,0.55)',
    color: '#ffe6b8',
    cursor: 'pointer',
    textAlign: 'center'
  }
}
const vertFrame: React.CSSProperties = {
  width: 60,
  height: 100,
  borderRadius: 6,
  margin: '0 auto',
  border: '1px solid rgba(255,200,130,0.7)',
  background: 'rgba(255,200,120,0.10)'
}
const horzFrame: React.CSSProperties = {
  width: 120,
  height: 68,
  borderRadius: 6,
  margin: '0 auto',
  border: '1px solid rgba(255,200,130,0.7)',
  background: 'rgba(255,200,120,0.10)'
}
const textOnlyNotice: React.CSSProperties = {
  marginTop: 6,
  padding: 12,
  borderRadius: 10,
  border: '1px dashed rgba(255,200,130,0.4)',
  background: 'rgba(40,20,4,0.45)',
  color: 'rgba(255,228,180,0.85)',
  fontSize: 13
}
