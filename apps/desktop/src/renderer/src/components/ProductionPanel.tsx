/**
 * Grok production flow per soundbite: prompt → preview image → duration → video.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, ProductionPackage } from '@storyteller/shared'
import {
  PRODUCTION_REGEN_LIMITS,
  isTemplateProductionPackage,
  pickRecommendedOffer
} from '@storyteller/shared'
import {
  clampProductionVideoDuration,
  estimateImageToVideoCredits
} from '@storyteller/ai-gateway'
import type { BrollSlot, TimelineSequence } from '@storyteller/timeline'
import { formatSlotWindowLabel, setSlotStatus } from '@storyteller/timeline'
import { ExpandableImagePreview } from '@renderer/components/ExpandableImagePreview'
import { InlineClipPlayer } from '@renderer/components/InlineClipPlayer'
import { getSignedAssetUrl, uploadReferenceImageToStorage } from '@renderer/lib/storage-assets'
import { getGatewayAccessToken } from '@renderer/lib/gateway-auth'
import {
  attachProductionVideo,
  findBrollSlotForSoundbite,
  mapSoundbiteProductionToTimeline,
  patchProductionSlotMetadata,
  readProductionSlotMetadata
} from '@renderer/lib/production-slot'

const PREVIEW_IMAGE_CREDITS = 2
const UPLOADED_STILL_PLACEHOLDER_PROMPT = 'User-uploaded opening frame'
const OPENING_FRAME_ACCEPT = 'image/png,image/jpeg,image/webp'

const primaryBtn: CSSProperties = {
  background: '#6ee7c5',
  color: '#0a0a0b',
  border: 'none',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer'
}

const ghostBtn: CSSProperties = {
  background: 'transparent',
  color: '#a1a1aa',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer'
}

export type ProductionPanelAi = {
  productionOffers: ProductionPackage[]
  brollIdeas: Array<{
    style: 'literal' | 'emotional' | 'symbolic'
    prompt: string
    stillImagePrompt?: string
    motionPrompt?: string
    why?: string
  }>
  graphScore?: number
  graphIdea?: unknown
}

type ProductionPanelProps = {
  soundbite: {
    id: string
    start_time: number
    end_time: number
    transcript_text: string | null
  }
  ai: ProductionPanelAi
  projectId: string
  editFormat: 'horizontal' | 'vertical'
  sequence: TimelineSequence
  assets: Asset[]
  accessToken: string | null | undefined
  supabase: SupabaseClient | null
  availableCredits?: number | null
  outOfCredits?: boolean
  busySoundbiteId: string | null
  onBusyChange: (soundbiteId: string | null) => void
  onPersistSequence: (
    seq: TimelineSequence,
    options?: { recordHistory?: boolean; clearRedo?: boolean; persist?: boolean }
  ) => Promise<void>
  onAddAssets: (assets: Asset[]) => void
  onError: (msg: string | null) => void
  onGenerateBrollPrompt?: () => Promise<void>
  generatingBrollPrompt?: boolean
  /** Free-form prompts — user writes motion + frame without AI offers. */
  manualMode?: boolean
}

function localMediaUrl(localPath: string): string {
  return window.storyteller?.toMediaUrl?.(localPath) ?? ''
}

function defaultVideoDuration(soundbite: ProductionPanelProps['soundbite']): number {
  const span = soundbite.end_time - soundbite.start_time
  return clampProductionVideoDuration(span > 0 ? span : 8)
}

function regenBadge(used: number, limit: number): string {
  return `${Math.max(0, limit - used)} left`
}

export function ProductionPanel(props: ProductionPanelProps) {
  const offers = props.ai.productionOffers
  const recommended = pickRecommendedOffer(offers)
  const [activePackageId, setActivePackageId] = useState(recommended?.id ?? offers[0]?.id ?? '')
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [signedStillUrl, setSignedStillUrl] = useState<string | null>(null)
  const [isEditingPrompts, setIsEditingPrompts] = useState(props.manualMode ?? false)
  const [editMotion, setEditMotion] = useState('')
  const [editFrame, setEditFrame] = useState('')
  const [localPkgOverride, setLocalPkgOverride] = useState<ProductionPackage | null>(null)
  const [durationDraft, setDurationDraft] = useState<number | null>(null)
  const [uploadingFrame, setUploadingFrame] = useState(false)
  // Object URL created immediately when user picks a file so we can show a thumbnail
  // before the async upload + state propagation completes.
  const [localUploadPreview, setLocalUploadPreview] = useState<string | null>(null)
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null)

  const slot = useMemo(
    () => findBrollSlotForSoundbite(props.sequence, props.soundbite.id),
    [props.sequence, props.soundbite.id]
  )
  const productionMeta = readProductionSlotMetadata(slot)
  const hasPreview = Boolean(
    productionMeta?.pendingStillAssetId ||
      productionMeta?.approvedStillAssetId ||
      productionMeta?.pipelinePhase === 'still-pending-approval' ||
      productionMeta?.pipelinePhase === 'still-approved'
  )
  const videoReady = slot?.status === 'ready' && Boolean(slot.generatedAssetId)
  const offerPkg =
    offers.find((o) => o.id === activePackageId) ?? recommended ?? offers[0] ?? null
  const storedPkg =
    productionMeta?.package &&
    productionMeta.activePackageId === activePackageId &&
    productionMeta.package.motionPrompt &&
    (hasPreview || videoReady || !isTemplateProductionPackage(productionMeta.package))
      ? productionMeta.package
      : null
  const basePkg = localPkgOverride ?? storedPkg ?? offerPkg

  function buildManualPackage(motion: string, frame: string): ProductionPackage {
    return {
      id: `manual-${props.soundbite.id}`,
      offerRole: 'recommended',
      sourceSoundbiteId: props.soundbite.id,
      mode: 'broll',
      conceptSummary: 'Custom prompt',
      stillImagePrompt: frame,
      motionPrompt: motion,
      style: 'literal'
    }
  }

  const manualDraftPkg =
    props.manualMode && editMotion.trim() && (editFrame.trim() || hasPreview)
      ? buildManualPackage(
          editMotion.trim(),
          editFrame.trim() || UPLOADED_STILL_PLACEHOLDER_PROMPT
        )
      : null
  const activePkg = props.manualMode ? manualDraftPkg ?? basePkg : basePkg

  const pendingStillAsset = useMemo(() => {
    const id = productionMeta?.pendingStillAssetId ?? productionMeta?.approvedStillAssetId
    if (!id) return null
    return props.assets.find((a) => a.id === id) ?? null
  }, [productionMeta, props.assets])

  const isUserUploadedStill = Boolean(
    pendingStillAsset?.metadata_json &&
      (pendingStillAsset.metadata_json as { origin?: string }).origin === 'user-upload'
  )

  const videoAsset = useMemo(() => {
    if (!slot?.generatedAssetId) return null
    return props.assets.find((a) => a.id === slot.generatedAssetId) ?? null
  }, [slot, props.assets])

  const isBusy = props.busySoundbiteId === props.soundbite.id
  const aspectRatio = props.editFormat === 'vertical' ? ('9:16' as const) : ('16:9' as const)
  const regens = productionMeta?.regens ?? { conceptRegensUsed: 0, stillRegensUsed: 0, videoRegensUsed: 0, courtesyRegenUsed: false }
  const courtesyRegenUsed = regens.courtesyRegenUsed ?? false

  const persistedDuration = clampProductionVideoDuration(
    productionMeta?.videoDurationSeconds ?? defaultVideoDuration(props.soundbite)
  )
  const videoDuration = durationDraft ?? persistedDuration
  const videoCredits = estimateImageToVideoCredits(videoDuration)
  const promptsAreTemplate = activePkg ? isTemplateProductionPackage(activePkg) : false
  const isStarterIdea = Boolean(activePkg?.isStarterIdea)
  const needsScenePrompt = (promptsAreTemplate || isStarterIdea) && !hasPreview && !videoReady
  const canRegenerate = Boolean(
    props.onGenerateBrollPrompt && !props.manualMode && !hasPreview && !videoReady
  )

  const previewStillSrc = useMemo(() => {
    const path = pendingStillAsset?.local_path?.trim()
    if (!path) return ''
    return localMediaUrl(path)
  }, [pendingStillAsset?.local_path])

  // Fall back to the local object URL while the real asset path propagates through state.
  const effectivePreviewSrc = previewStillSrc || localUploadPreview || ''

  // Once the real preview is ready, release the object URL.
  useEffect(() => {
    if (previewStillSrc && localUploadPreview) {
      const url = localUploadPreview
      setLocalUploadPreview(null)
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    }
  }, [previewStillSrc, localUploadPreview])

  useEffect(() => {
    if (durationDraft != null && durationDraft === persistedDuration) {
      setDurationDraft(null)
    }
  }, [durationDraft, persistedDuration])

  const insufficientPreviewCredits =
    props.outOfCredits || (props.availableCredits != null && props.availableCredits < PREVIEW_IMAGE_CREDITS)
  const insufficientVideoCredits =
    props.outOfCredits || (props.availableCredits != null && props.availableCredits < videoCredits)

  useEffect(() => {
    if (recommended?.id && !activePackageId) setActivePackageId(recommended.id)
  }, [recommended?.id, activePackageId])

  useEffect(() => {
    if (activePkg && !isEditingPrompts) {
      setEditMotion(activePkg.motionPrompt)
      setEditFrame(activePkg.stillImagePrompt)
    }
  }, [activePkg, isEditingPrompts])

  function cycleOffer(): void {
    if (offers.length <= 1) return
    const idx = offers.findIndex((o) => o.id === activePackageId)
    const next = offers[(idx + 1) % offers.length]
    if (next) {
      setActivePackageId(next.id)
      setLocalPkgOverride(null)
    }
  }

  async function commitDuration(seconds: number): Promise<void> {
    if (!slot) return
    const clamped = clampProductionVideoDuration(seconds)
    if (clamped === persistedDuration) return
    const next = patchProductionSlotMetadata(props.sequence, slot.id, {
      videoDurationSeconds: clamped
    })
    await props.onPersistSequence(next, { recordHistory: false })
  }

  function resolveMotionPrompt(): string {
    return editMotion.trim() || activePkg?.motionPrompt?.trim() || basePkg?.motionPrompt?.trim() || ''
  }

  async function savePromptEdits(): Promise<void> {
    const trimmedMotion = editMotion.trim()
    const trimmedFrame = editFrame.trim()
    if (!trimmedMotion) {
      props.onError('Motion prompt is required.')
      return
    }
    if (!trimmedFrame && !hasPreview) {
      props.onError('Opening frame prompt is required unless you upload an opening frame image.')
      return
    }
    const updated: ProductionPackage = props.manualMode
      ? buildManualPackage(trimmedMotion, trimmedFrame || UPLOADED_STILL_PLACEHOLDER_PROMPT)
      : {
          ...(activePkg ?? buildManualPackage(trimmedMotion, trimmedFrame)),
          motionPrompt: trimmedMotion,
          stillImagePrompt: trimmedFrame
        }
    if (slot) {
      const next = patchProductionSlotMetadata(props.sequence, slot.id, {
        package: updated,
        activePackageId: updated.id
      })
      await props.onPersistSequence(next)
    } else {
      setLocalPkgOverride(updated)
    }
    setIsEditingPrompts(false)
    props.onError(null)
  }

  async function ensureSlot(pkg: ProductionPackage): Promise<{ slot: BrollSlot; sequence: TimelineSequence } | null> {
    const existing = findBrollSlotForSoundbite(props.sequence, props.soundbite.id)
    if (existing) return { slot: existing, sequence: props.sequence }
    const mapped = mapSoundbiteProductionToTimeline({
      sequence: props.sequence,
      projectId: props.projectId,
      soundbiteId: props.soundbite.id,
      sourceStart: props.soundbite.start_time,
      sourceEnd: props.soundbite.end_time,
      pkg,
      promptType: pkg.style ?? 'literal'
    })
    if (!mapped) {
      props.onError('Could not place this moment on the timeline — build an intro or rough cut first.')
      return null
    }
    const withPkg = patchProductionSlotMetadata(mapped.sequence, mapped.slot.id, {
      activePackageId: pkg.id,
      package: pkg,
      pipelinePhase: 'concept',
      videoDurationSeconds: defaultVideoDuration(props.soundbite)
    })
    await props.onPersistSequence(withPkg)
    return { slot: mapped.slot, sequence: withPkg }
  }

  async function onCreatePreviewImage(isRegen = false, courtesyRegen = false) {
    if (!activePkg) return
    const bridge = window.storyteller?.generateProductionStill
    if (!bridge) {
      props.onError('Production generation requires the Storyteller desktop app.')
      return
    }
    if (isRegen && !courtesyRegen && regens.stillRegensUsed >= PRODUCTION_REGEN_LIMITS.still) {
      props.onError('Preview image regeneration limit reached for this slot.')
      return
    }
    props.onError(null)
    props.onBusyChange(props.soundbite.id)
    setStatusLine('Creating preview image…')
    try {
      const mapped = await ensureSlot(activePkg)
      if (!mapped) return
      const { slot: slotRow, sequence: baseSeq } = mapped
      const accessToken = props.accessToken ?? (await getGatewayAccessToken())
      const res = await bridge({
        projectId: props.projectId,
        slotId: slotRow.id,
        productionPackage: activePkg,
        aspectRatio,
        accessToken: accessToken ?? undefined,
        courtesyRegen: courtesyRegen || undefined
      })
      if (!res.ok) {
        const failSeq = patchProductionSlotMetadata(baseSeq, slotRow.id, {
          status: 'failed',
          errorMessage: res.error
        })
        await props.onPersistSequence(failSeq)
        props.onError(null)
        return
      }
      const stillAsset = res.asset as Asset
      props.onAddAssets([stillAsset])
      const updatedRegens = isRegen
        ? courtesyRegen
          ? { ...regens, courtesyRegenUsed: true }
          : { ...regens, stillRegensUsed: regens.stillRegensUsed + 1 }
        : regens
      const next = patchProductionSlotMetadata(baseSeq, slotRow.id, {
        status: 'empty',
        errorMessage: undefined,
        pendingStillAssetId: stillAsset.id,
        pipelinePhase: 'still-pending-approval',
        regens: updatedRegens
      })
      await props.onPersistSequence(next)
      setStatusLine('Preview ready — choose length and generate video when you are happy with the frame.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const mappedSlot = findBrollSlotForSoundbite(props.sequence, props.soundbite.id)
      if (mappedSlot) {
        await props.onPersistSequence(
          patchProductionSlotMetadata(props.sequence, mappedSlot.id, {
            status: 'failed',
            errorMessage: msg
          })
        )
      }
      props.onError(null)
    } finally {
      props.onBusyChange(null)
    }
  }

  async function onUploadOpeningFrame(file: File) {
    const motion = resolveMotionPrompt()
    if (!motion) {
      props.onError('Write your motion prompt before uploading an opening frame.')
      return
    }
    if (!props.supabase) {
      props.onError('Sign in to upload an opening frame for video generation.')
      return
    }
    const saveBridge = window.storyteller?.saveProductionUploadedStill
    if (!saveBridge) {
      props.onError('Opening frame upload requires the Storyteller desktop app.')
      return
    }
    const framePrompt = editFrame.trim() || UPLOADED_STILL_PLACEHOLDER_PROMPT
    const pkg = buildManualPackage(motion, framePrompt)

    props.onError(null)
    setUploadingFrame(true)
    // Show a local preview immediately so the user sees their image right away.
    const previewObjectUrl = URL.createObjectURL(file)
    setLocalUploadPreview(previewObjectUrl)
    setUploadedFilename(file.name)
    setStatusLine('Uploading opening frame…')
    try {
      const mapped = await ensureSlot(pkg)
      if (!mapped) return
      const { slot: slotRow, sequence: baseSeq } = mapped

      const uploadAssetId = crypto.randomUUID()
      const upload = await uploadReferenceImageToStorage(props.supabase, {
        projectId: props.projectId,
        file,
        assetId: uploadAssetId
      })
      if (upload.error || !upload.storagePath) {
        URL.revokeObjectURL(previewObjectUrl)
        setLocalUploadPreview(null)
        props.onError(upload.error ?? 'Upload failed')
        return
      }

      const bytes = new Uint8Array(await file.arrayBuffer())
      const saved = await saveBridge({
        projectId: props.projectId,
        slotId: slotRow.id,
        bytes,
        filename: file.name,
        mimeType: file.type || 'image/png'
      })
      if (!saved.ok) {
        URL.revokeObjectURL(previewObjectUrl)
        setLocalUploadPreview(null)
        props.onError(saved.error)
        return
      }

      const asset = {
        ...(saved.asset as Asset),
        storage_path: upload.storagePath,
        is_uploaded: true,
        upload_status: 'complete' as const
      }
      props.onAddAssets([asset])

      const next = patchProductionSlotMetadata(baseSeq, slotRow.id, {
        package: pkg,
        activePackageId: pkg.id,
        status: 'empty',
        errorMessage: undefined,
        pendingStillAssetId: asset.id,
        pipelinePhase: 'still-pending-approval'
      })
      await props.onPersistSequence(next)
      setLocalPkgOverride(pkg)
      setIsEditingPrompts(false)
      setStatusLine('Opening frame ready — choose length and generate video.')
    } catch (e) {
      URL.revokeObjectURL(previewObjectUrl)
      setLocalUploadPreview(null)
      props.onError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploadingFrame(false)
      // localUploadPreview is kept on success — the cleanup effect revokes it once
      // the real previewStillSrc is ready.
    }
  }

  async function uploadApprovedStill(
    stillAsset: Asset
  ): Promise<{ refUrl: string; uploadAssetId: string; storagePath: string } | null> {
    if (!slot || !stillAsset.local_path) {
      props.onError('Preview image file is missing — create it again.')
      return null
    }
    if (!props.supabase) {
      props.onError('Sign in to generate video from your preview image.')
      return null
    }
    const read = await window.storyteller?.readLocalFile?.(stillAsset.local_path)
    if (!read?.ok || !read.bytes) {
      props.onError('Could not read the preview image from disk.')
      return null
    }
    const ext = stillAsset.local_path.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    const blob = new Blob([read.bytes], { type: mime })
    const uploadAssetId = crypto.randomUUID()
    const upload = await uploadReferenceImageToStorage(props.supabase, {
      projectId: props.projectId,
      file: new File([blob], `still-${uploadAssetId}.${ext}`, { type: mime }),
      assetId: uploadAssetId
    })
    if (upload.error || !upload.storagePath) {
      props.onError(upload.error ?? 'Upload failed')
      return null
    }
    const signed = await getSignedAssetUrl(props.supabase, upload.storagePath, 60 * 60)
    if (!signed) {
      props.onError('Image uploaded but signing failed — try again.')
      return null
    }
    return { refUrl: signed, uploadAssetId, storagePath: upload.storagePath }
  }

  async function onUseImageAndGenerateVideo(isRegen = false) {
    if (!slot || !activePkg || !pendingStillAsset) return
    const bridge = window.storyteller?.generateProductionVideo
    if (!bridge) {
      props.onError('Production generation requires the Storyteller desktop app.')
      return
    }
    if (isRegen && regens.videoRegensUsed >= PRODUCTION_REGEN_LIMITS.video) {
      props.onError('Video regeneration limit reached for this slot.')
      return
    }
    props.onError(null)
    props.onBusyChange(props.soundbite.id)
    setStatusLine('Uploading preview image and generating video…')
    try {
      const uploaded = await uploadApprovedStill(pendingStillAsset)
      if (!uploaded) return
      setSignedStillUrl(uploaded.refUrl)
      const slotMeta = slot.metadata ?? {}
      let baseSeq = patchProductionSlotMetadata(props.sequence, slot.id, {
        approvedStillAssetId: pendingStillAsset.id,
        pendingStillAssetId: undefined,
        pipelinePhase: 'still-approved',
        referenceImageAssetId: uploaded.uploadAssetId,
        videoDurationSeconds: videoDuration
      })
      baseSeq = setSlotStatus(baseSeq, slot.id, {
        metadata: { ...slotMeta, approvedStillStoragePath: uploaded.storagePath }
      })
      await props.onPersistSequence(baseSeq)

      const genSeq = patchProductionSlotMetadata(baseSeq, slot.id, {
        status: 'generating',
        pipelinePhase: 'video',
        errorMessage: undefined
      })
      await props.onPersistSequence(genSeq)
      const accessToken = props.accessToken ?? (await getGatewayAccessToken())
      const res = await bridge({
        projectId: props.projectId,
        slotId: slot.id,
        motionPrompt: activePkg.motionPrompt,
        stillLocalPath: pendingStillAsset.local_path!,
        referenceImageUrl: uploaded.refUrl,
        durationSeconds: videoDuration,
        aspectRatio,
        productionPackageId: activePkg.id,
        accessToken: accessToken ?? undefined
      })
      if (!res.ok) {
        await props.onPersistSequence(
          patchProductionSlotMetadata(baseSeq, slot.id, {
            status: 'failed',
            errorMessage: res.error
          })
        )
        props.onError(null)
        return
      }
      const videoAssetResult = res.asset as Asset
      props.onAddAssets([videoAssetResult])
      const durSec = videoAssetResult.duration_seconds ?? videoDuration
      let next = attachProductionVideo(baseSeq, slot.id, videoAssetResult.id, durSec)
      next = patchProductionSlotMetadata(next, slot.id, {
        regens: isRegen
          ? { ...regens, videoRegensUsed: regens.videoRegensUsed + 1 }
          : regens
      })
      await props.onPersistSequence(next)
      setStatusLine('Video attached to timeline.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (slot) {
        await props.onPersistSequence(
          patchProductionSlotMetadata(props.sequence, slot.id, {
            status: 'failed',
            errorMessage: msg
          })
        )
      }
      props.onError(null)
    } finally {
      props.onBusyChange(null)
    }
  }

  if (offers.length === 0 && !props.manualMode) {
    return (
      <div style={{ fontSize: 13, color: '#a1a1aa', marginTop: 8, display: 'grid', gap: 10 }}>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          No B-roll prompts yet — generate one grounded motion + frame prompt for this soundbite, or re-run
          Review analysis.
        </p>
        {props.onGenerateBrollPrompt && (
          <button
            type="button"
            style={{ ...primaryBtn, width: 'fit-content', opacity: props.generatingBrollPrompt ? 0.6 : 1 }}
            disabled={props.generatingBrollPrompt || isBusy}
            onClick={() => void props.onGenerateBrollPrompt?.()}
          >
            {props.generatingBrollPrompt ? 'Generating prompt…' : 'Generate B-roll prompt'}
          </button>
        )}
      </div>
    )
  }

  if (!activePkg && !props.manualMode) return null

  const showPromptCopy =
    props.manualMode || !activePkg || !promptsAreTemplate || hasPreview || videoReady

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {slot && (
        <div style={{ fontSize: 12, color: '#71717a', textAlign: 'right' }}>
          {formatSlotWindowLabel(slot)}
        </div>
      )}

      {/* Prompts — motion first */}
      {needsScenePrompt && props.onGenerateBrollPrompt && !props.manualMode && (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            display: 'grid',
            gap: 8
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: '#fde68a', lineHeight: 1.5 }}>
            {isStarterIdea
              ? 'Starter idea — a quick keyword match, not yet grounded in this exact line. Regenerate with AI for a scene-specific prompt.'
              : 'No scene-specific prompt yet — generate one grounded in this soundbite.'}
          </p>
          <button
            type="button"
            style={{ ...primaryBtn, width: 'fit-content', opacity: props.generatingBrollPrompt ? 0.6 : 1 }}
            disabled={props.generatingBrollPrompt || isBusy}
            onClick={() => void props.onGenerateBrollPrompt?.()}
          >
            {props.generatingBrollPrompt ? 'Generating prompt…' : 'Regenerate with AI'}
          </button>
        </div>
      )}

      {showPromptCopy && (
      <>
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6ee7c5', marginBottom: 6 }}>
            Proposed B-roll (motion)
          </div>
          {isEditingPrompts ? (
            <textarea
              value={editMotion}
              onChange={(e) => setEditMotion(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 10,
                borderRadius: 8,
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(110,231,197,0.25)',
                color: '#f4f4f5',
                fontSize: 13,
                lineHeight: 1.45,
                resize: 'vertical'
              }}
            />
          ) : activePkg ? (
            <p style={{ fontSize: 13, color: '#e4e4e7', lineHeight: 1.5, margin: 0 }}>{activePkg.motionPrompt}</p>
          ) : (
            <p style={{ fontSize: 13, color: '#71717a', lineHeight: 1.5, margin: 0 }}>Describe camera motion and action…</p>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#71717a', marginBottom: 6 }}>
            Opening frame
          </div>
          {isEditingPrompts ? (
            <>
              <textarea
                value={editFrame}
                onChange={(e) => setEditFrame(e.target.value)}
                rows={3}
                placeholder="Describe the opening frame, or upload your own image below"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: 10,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#f4f4f5',
                  fontSize: 13,
                  lineHeight: 1.45,
                  resize: 'vertical'
                }}
              />
              {props.manualMode && !hasPreview && (
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      color: uploadingFrame ? '#6ee7c5' : '#a1a1aa',
                      fontSize: 12,
                      width: 'fit-content',
                      cursor: uploadingFrame || isBusy ? 'default' : 'pointer',
                      opacity: isBusy && !uploadingFrame ? 0.6 : 1
                    }}
                  >
                    {uploadingFrame ? 'Uploading…' : 'Upload opening frame'}
                    <input
                      type="file"
                      accept={OPENING_FRAME_ACCEPT}
                      disabled={uploadingFrame || isBusy}
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const picked = e.currentTarget.files?.[0]
                        e.currentTarget.value = ''
                        if (picked) void onUploadOpeningFrame(picked)
                      }}
                    />
                  </label>
                  {localUploadPreview ? (
                    <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', maxHeight: 120 }}>
                      <img
                        src={localUploadPreview}
                        alt="Selected opening frame"
                        style={{ width: '100%', maxHeight: 120, objectFit: 'cover', display: 'block', opacity: uploadingFrame ? 0.65 : 1 }}
                      />
                      {uploadingFrame && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', fontSize: 12, color: '#6ee7c5', fontWeight: 500 }}>
                          Uploading…
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: '#71717a' }}>
                      Upload is free — you are only charged for video generation.
                    </span>
                  )}
                </div>
              )}
            </>
          ) : activePkg ? (
            <p style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.5, margin: 0 }}>
              {isUserUploadedStill ? 'User-uploaded opening frame' : activePkg.stillImagePrompt}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: '#71717a', lineHeight: 1.5, margin: 0 }}>Describe the opening frame…</p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {isEditingPrompts ? (
          <>
            <button type="button" style={primaryBtn} onClick={() => void savePromptEdits()}>
              Save prompts
            </button>
            <button type="button" style={ghostBtn} onClick={() => setIsEditingPrompts(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" style={ghostBtn} onClick={() => setIsEditingPrompts(true)}>
            Edit prompts
          </button>
        )}
        {offers.length > 1 && !hasPreview && !videoReady && (
          <button type="button" style={ghostBtn} disabled={isBusy} onClick={cycleOffer}>
            Try another idea
          </button>
        )}
        {canRegenerate && !needsScenePrompt && !isEditingPrompts && (
          <button
            type="button"
            style={{ ...ghostBtn, opacity: props.generatingBrollPrompt ? 0.6 : 1 }}
            disabled={props.generatingBrollPrompt || isBusy}
            onClick={() => void props.onGenerateBrollPrompt?.()}
          >
            {props.generatingBrollPrompt ? 'Regenerating…' : 'Regenerate with AI'}
          </button>
        )}
      </div>
      </>
      )}

      {/* Phase: no preview yet */}
      {showPromptCopy && !hasPreview && !videoReady && activePkg && (
        <div style={{ display: 'grid', gap: 8 }}>
          {props.manualMode && (
            <p style={{ fontSize: 12, color: '#71717a', margin: 0, lineHeight: 1.5 }}>
              Upload your own opening frame (free) or generate a preview with AI ({PREVIEW_IMAGE_CREDITS} credits).
            </p>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: isBusy || insufficientPreviewCredits ? 0.5 : 1 }}
              disabled={isBusy || insufficientPreviewCredits}
              onClick={() => void onCreatePreviewImage(false)}
            >
              {isBusy ? 'Creating preview…' : `Create preview image · ${PREVIEW_IMAGE_CREDITS} credits`}
            </button>
            {insufficientPreviewCredits && (
              <span style={{ fontSize: 12, color: '#fca5a5' }}>Not enough credits for a preview image.</span>
            )}
          </div>
        </div>
      )}

      {/* Phase: preview ready, video not done */}
      {hasPreview && !videoReady && pendingStillAsset && (
        <>
          {effectivePreviewSrc && (
            <ExpandableImagePreview
              src={effectivePreviewSrc}
              alt="Preview frame for B-roll"
              title="Opening frame preview"
              objectFit="cover"
              maxHeight={props.editFormat === 'vertical' ? 320 : 200}
            />
          )}

          <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0, lineHeight: 1.5 }}>
            {isUserUploadedStill
              ? uploadedFilename
                ? <><span style={{ color: '#6ee7c5' }}>✓ {uploadedFilename}</span> — becomes the first frame of your video.</>
                : 'Your uploaded image becomes the first frame of your video.'
              : 'The preview image becomes the first frame of your video.'}
          </p>

          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'grid',
              gap: 10
            }}
          >
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, color: '#d4d4d8' }}>
                Video length: <strong style={{ color: '#f4f4f5' }}>{videoDuration} sec</strong>
              </span>
              <input
                type="range"
                min={6}
                max={15}
                step={1}
                value={videoDuration}
                disabled={isBusy}
                onChange={(e) => setDurationDraft(Number(e.target.value))}
                onMouseUp={() => void commitDuration(videoDuration)}
                onTouchEnd={() => void commitDuration(videoDuration)}
                style={{ width: '100%', accentColor: '#6ee7c5' }}
              />
              <span style={{ fontSize: 11, color: '#71717a' }}>6 sec — 15 sec (Storyteller AI limit)</span>
            </label>
            <div style={{ fontSize: 13, color: '#d4d4d8' }}>
              Estimated cost: <strong style={{ color: '#6ee7c5' }}>{videoCredits} credits</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: isBusy || insufficientVideoCredits ? 0.5 : 1 }}
              disabled={isBusy || insufficientVideoCredits}
              onClick={() => void onUseImageAndGenerateVideo(false)}
            >
              {isBusy
                ? 'Generating video…'
                : isUserUploadedStill
                  ? `Generate video · ${videoCredits} credits (${videoDuration}s)`
                  : `Use this image & generate video · ${videoCredits} credits (${videoDuration}s)`}
            </button>
            {!isUserUploadedStill && !courtesyRegenUsed && !isBusy && (
              <button
                type="button"
                style={{ ...ghostBtn, fontSize: 12 }}
                title="This image doesn't look right — get one free retry"
                onClick={() => void onCreatePreviewImage(true, true)}
              >
                👎 Didn't look right (free retry)
              </button>
            )}
            {!isUserUploadedStill && regens.stillRegensUsed < PRODUCTION_REGEN_LIMITS.still && (
              <button
                type="button"
                style={ghostBtn}
                disabled={isBusy || insufficientPreviewCredits}
                onClick={() => void onCreatePreviewImage(true)}
              >
                Regenerate preview image · {PREVIEW_IMAGE_CREDITS} credits
              </button>
            )}
            {isUserUploadedStill && !isBusy && (
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  ...ghostBtn,
                  fontSize: 12,
                  color: uploadingFrame ? '#6ee7c5' : undefined,
                  cursor: uploadingFrame ? 'default' : 'pointer',
                  opacity: uploadingFrame ? 0.85 : 1
                }}
              >
                {uploadingFrame ? 'Uploading…' : 'Replace image'}
                <input
                  type="file"
                  accept={OPENING_FRAME_ACCEPT}
                  disabled={uploadingFrame || isBusy}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const picked = e.currentTarget.files?.[0]
                    e.currentTarget.value = ''
                    if (picked) void onUploadOpeningFrame(picked)
                  }}
                />
              </label>
            )}
            {!isUserUploadedStill && (
              <span style={{ fontSize: 12, color: '#71717a' }}>
                Preview regens: {regenBadge(regens.stillRegensUsed, PRODUCTION_REGEN_LIMITS.still)}
              </span>
            )}
            {insufficientVideoCredits && (
              <span style={{ fontSize: 12, color: '#fca5a5' }}>Not enough credits for this video length.</span>
            )}
          </div>
        </>
      )}

      {/* Phase: video ready */}
      {videoReady && videoAsset && (
        <>
          {videoAsset.local_path && (
            <InlineClipPlayer
              sourcePath={videoAsset.local_path}
              startTime={0}
              endTime={videoAsset.duration_seconds ?? videoDuration}
              aspectRatio={props.editFormat === 'vertical' ? '9 / 16' : '16 / 9'}
              maxHeight={props.editFormat === 'vertical' ? 360 : 220}
              objectFit="cover"
              autoPlay={false}
            />
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6ee7c5' }}>Ready on timeline</span>
            {!courtesyRegenUsed && !isBusy && (
              <button
                type="button"
                style={{ ...ghostBtn, fontSize: 12 }}
                title="This video doesn't look right — get one free retry of the still image"
                onClick={() => void onCreatePreviewImage(true, true)}
              >
                👎 Didn't look right (free still retry)
              </button>
            )}
            {regens.videoRegensUsed < PRODUCTION_REGEN_LIMITS.video && (
              <button
                type="button"
                style={ghostBtn}
                disabled={isBusy || insufficientVideoCredits}
                onClick={() => void onUseImageAndGenerateVideo(true)}
              >
                Regenerate video · {videoCredits} credits ({videoDuration}s)
              </button>
            )}
          </div>
        </>
      )}

      {statusLine && <div style={{ fontSize: 12, color: '#a1a1aa' }}>{statusLine}</div>}
      {slot?.status === 'failed' && slot.errorMessage && (
        <div style={{ fontSize: 12, color: '#fca5a5' }}>{slot.errorMessage}</div>
      )}
    </div>
  )
}
