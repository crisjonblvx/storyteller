import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset } from '@storyteller/shared'
import type { BeatsPerCut } from '@storyteller/timeline'
import { AssetUploadZone } from '@renderer/components/AssetUploadZone'
import { UploadedAssetsPanel } from '@renderer/components/UploadedAssetsPanel'

interface MusicVideoIngestPanelProps {
  projectId: string
  projectTitle: string
  assets: Asset[]
  assetsLoading: boolean
  assetsError: string | null
  supabase: SupabaseClient | null
  userId?: string
  vibeVision: string
  musicLocalPath?: string
  beatsPerCut: BeatsPerCut
  beatTimestamps: number[]
  detectedBpm: number | null
  beatAnalyzing: boolean
  beatAnalysisError: string | null
  assembling: boolean
  onVibeVisionChange: (v: string) => void
  onBeatsPerCutChange: (n: BeatsPerCut) => void
  onUploaded: () => void
  onMusicFilePicked: (path: string) => void
  onAssemble: () => void
}

const BEATS_PER_CUT_OPTIONS: { value: BeatsPerCut; label: string }[] = [
  { value: 1, label: '1 beat — rapid fire' },
  { value: 2, label: '2 beats — energetic' },
  { value: 4, label: '4 beats — balanced' },
  { value: 8, label: '8 beats — cinematic' }
]

export function MusicVideoIngestPanel({
  projectId,
  projectTitle,
  assets,
  assetsLoading,
  assetsError,
  supabase,
  userId,
  vibeVision,
  musicLocalPath,
  beatsPerCut,
  beatTimestamps,
  detectedBpm,
  beatAnalyzing,
  beatAnalysisError,
  assembling,
  onVibeVisionChange,
  onBeatsPerCutChange,
  onUploaded,
  onMusicFilePicked,
  onAssemble
}: MusicVideoIngestPanelProps) {
  const musicFilename = musicLocalPath
    ? musicLocalPath.split(/[/\\]/).pop() ?? musicLocalPath
    : null

  async function handlePickMusic() {
    const result = await window.storyteller?.pickMediaFiles?.({ multiple: false })
    if (!result?.ok || !result.paths?.length) return
    onMusicFilePicked(result.paths[0]!)
  }

  const beatsReady = beatTimestamps.length >= 2
  const approxClipDuration = detectedBpm
    ? ((60 / detectedBpm) * beatsPerCut).toFixed(1)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Vibe & Vision */}
      <div style={{
        background: 'rgba(168,85,247,0.06)',
        border: '1px solid rgba(168,85,247,0.2)',
        borderRadius: 12,
        padding: 20
      }}>
        <label
          htmlFor="mv-vibe-vision"
          style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#d4b8f7', marginBottom: 8 }}
        >
          Vibe & Vision
        </label>
        <p style={{ fontSize: 12, color: '#71717a', marginBottom: 12, lineHeight: 1.5 }}>
          Describe the mood, energy, and visual style you're going for. This guides AI B-roll generation and visual tone.
        </p>
        <textarea
          id="mv-vibe-vision"
          value={vibeVision}
          onChange={(e) => onVibeVisionChange(e.target.value)}
          placeholder="e.g. Dark and atmospheric — moody slow motion with rain, neon reflections, and silhouettes. Cuts hard on every 4 beats. Energy builds to an explosive drop."
          rows={3}
          style={{
            width: '100%',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(168,85,247,0.3)',
            borderRadius: 8,
            padding: '10px 14px',
            color: '#e4e4e7',
            fontSize: 13,
            lineHeight: 1.5,
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Music track */}
      <div style={{
        background: '#1c1c1f',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 20
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>
          Music Track
        </div>
        <p style={{ fontSize: 12, color: '#71717a', marginBottom: 16, lineHeight: 1.5 }}>
          Import the audio track. Storyteller will detect the BPM and beat timestamps — clips will snap to the beat.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void handlePickMusic()}
            disabled={beatAnalyzing}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: beatAnalyzing ? 'not-allowed' : 'pointer',
              background: beatAnalyzing ? '#3f3f46' : '#a855f7',
              color: '#fff',
              border: 'none',
              opacity: beatAnalyzing ? 0.7 : 1
            }}
          >
            {beatAnalyzing ? 'Analyzing…' : musicLocalPath ? 'Change Music' : 'Import Music'}
          </button>

          {musicFilename && !beatAnalyzing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: '#a1a1aa' }}>{musicFilename}</span>
              {detectedBpm && (
                <span style={{ fontSize: 11, color: '#a855f7', fontWeight: 600 }}>
                  {detectedBpm} BPM · {beatTimestamps.length} beats detected
                </span>
              )}
            </div>
          )}

          {beatAnalyzing && (
            <span style={{ fontSize: 12, color: '#a1a1aa' }}>Detecting beats…</span>
          )}
        </div>

        {beatAnalysisError && (
          <p style={{ color: '#f87171', fontSize: 12, marginTop: 10 }}>{beatAnalysisError}</p>
        )}
      </div>

      {/* Cut density */}
      {beatsReady && detectedBpm && (
        <div style={{
          background: '#1c1c1f',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 20
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7', marginBottom: 8 }}>
            Cut Frequency
          </div>
          <p style={{ fontSize: 12, color: '#71717a', marginBottom: 14, lineHeight: 1.5 }}>
            How many beats between each video cut. At {detectedBpm} BPM:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BEATS_PER_CUT_OPTIONS.map((opt) => {
              const durSec = ((60 / detectedBpm) * opt.value).toFixed(1)
              const isSelected = beatsPerCut === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onBeatsPerCutChange(opt.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(168,85,247,0.15)' : 'transparent',
                    color: isSelected ? '#d4b8f7' : '#a1a1aa',
                    border: isSelected ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(255,255,255,0.06)',
                    textAlign: 'left'
                  }}
                >
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>{opt.label}</span>
                  <span style={{ fontSize: 11, color: isSelected ? '#a855f7' : '#52525b' }}>~{durSec}s / clip</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Video footage */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7', marginBottom: 12 }}>
          Footage
        </div>
        <AssetUploadZone
          projectId={projectId}
          projectTitle={projectTitle}
          projectMode="music_video"
          supabaseClient={supabase}
          userId={userId}
          onUploaded={onUploaded}
        />
        <div style={{ marginTop: 16 }}>
          <UploadedAssetsPanel
            assets={assets}
            loading={assetsLoading}
            error={assetsError}
            supabase={supabase}
          />
        </div>
      </div>

      {/* Assemble */}
      {beatsReady && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="button"
            onClick={onAssemble}
            disabled={assembling}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: assembling ? 'not-allowed' : 'pointer',
              background: assembling ? '#3f3f46' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
              color: '#fff',
              border: 'none',
              opacity: assembling ? 0.7 : 1
            }}
          >
            {assembling ? 'Building cut…' : 'Build Beat-Synced Cut →'}
          </button>
          {approxClipDuration && (
            <span style={{ fontSize: 12, color: '#71717a' }}>
              ~{approxClipDuration}s per clip at {beatsPerCut} beat{beatsPerCut > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
