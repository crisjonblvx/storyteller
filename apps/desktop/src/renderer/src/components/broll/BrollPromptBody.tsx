import { useEffect, useRef, useState } from 'react'

/**
 * Inline editor for one B-roll prompt card. Two visual modes:
 *
 *  - **view**: renders `body` as static text and an "Edit" pencil link in the
 *    bottom-right. Clicking either flips into edit mode.
 *  - **edit**: a textarea pre-filled with `initialText`, plus two number
 *    inputs for `segment_start` / `segment_end`. Cmd/Ctrl-Enter saves, Esc
 *    cancels, the textarea autofocuses on mount.
 *
 * The component is dumb on purpose — `onSave` returns a partial patch that
 * the parent applies to the active prompt list (heuristic / deterministic /
 * AI). We only call `onSave` after light validation: text must be non-empty
 * after trim, and `end > start` (otherwise the timeline mapper produces a
 * zero-length slot).
 *
 * Note: `body` (what's shown in view mode) and `initialText` (what's edited)
 * intentionally diverge — `body` may be the per-provider override (Runway /
 * Kling), but the user is always editing the canonical `prompt_text` so the
 * change applies regardless of which provider tab is active.
 */
export function BrollPromptBody(props: {
  index: number
  body: string
  isEditing: boolean
  initialText: string
  initialStart: number
  initialEnd: number
  onStartEdit: () => void
  onCancel: () => void
  onSave: (patch: { prompt_text: string; segment_start: number; segment_end: number }) => void
}) {
  const { body, isEditing, initialText, initialStart, initialEnd, onStartEdit, onCancel, onSave } = props
  const [text, setText] = useState(initialText)
  const [startStr, setStartStr] = useState(initialStart.toFixed(2))
  const [endStr, setEndStr] = useState(initialEnd.toFixed(2))
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * Re-seed local state every time we enter edit mode so the user starts from
   * the current canonical values (and so a save by another card doesn't leak
   * into ours). We watch `isEditing` rather than running once on mount.
   */
  useEffect(() => {
    if (isEditing) {
      setText(initialText)
      setStartStr(initialStart.toFixed(2))
      setEndStr(initialEnd.toFixed(2))
      setError(null)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [isEditing, initialText, initialStart, initialEnd])

  function tryCommit(): void {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('Prompt text is required.')
      return
    }
    const startNum = Number.parseFloat(startStr)
    const endNum = Number.parseFloat(endStr)
    if (!Number.isFinite(startNum) || startNum < 0) {
      setError('Start must be a number ≥ 0.')
      return
    }
    if (!Number.isFinite(endNum) || endNum <= startNum) {
      setError('End must be greater than start.')
      return
    }
    onSave({ prompt_text: trimmed, segment_start: startNum, segment_end: endNum })
  }

  if (!isEditing) {
    return (
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          justifyContent: 'space-between'
        }}
      >
        <div
          onClick={onStartEdit}
          style={{
            flex: 1,
            lineHeight: 1.6,
            color: '#f4f4f5',
            fontSize: 15,
            cursor: 'text',
            borderRadius: 6,
            padding: '4px 6px',
            margin: '-4px -6px',
            transition: 'background 0.15s'
          }}
          title="Click to edit this prompt"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {body}
        </div>
        <button
          type="button"
          onClick={onStartEdit}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#a1a1aa',
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            cursor: 'pointer',
            flexShrink: 0
          }}
          title="Edit prompt text and timing"
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
            return
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            tryCommit()
          }
        }}
        rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid rgba(110,231,197,0.4)',
          background: '#141416',
          color: '#f4f4f5',
          fontSize: 14,
          lineHeight: 1.5,
          resize: 'vertical',
          fontFamily: 'inherit'
        }}
        placeholder="Describe the shot you want generated. Cmd/Ctrl-Enter saves, Esc cancels."
      />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
          <span>Start (sec)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={startStr}
            onChange={(e) => {
              setStartStr(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
                return
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                tryCommit()
              }
            }}
            style={{
              width: 100,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: '#141416',
              color: '#f4f4f5',
              fontSize: 13
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
          <span>End (sec)</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={endStr}
            onChange={(e) => {
              setEndStr(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
                return
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                tryCommit()
              }
            }}
            style={{
              width: 100,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: '#141416',
              color: '#f4f4f5',
              fontSize: 13
            }}
          />
        </label>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent',
            color: '#f4f4f5',
            fontSize: 13,
            cursor: 'pointer'
          }}
          title="Esc"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={tryCommit}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            background: '#6ee7c5',
            color: '#061210',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(110,231,197,0.2)'
          }}
          title="Cmd/Ctrl-Enter"
        >
          Save
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div>}
      <div style={{ fontSize: 11, color: '#71717a' }}>
        Editing the canonical prompt — applies regardless of which provider tab is active. After saving, click
        "Map prompts to timeline slots" to push timing changes to the timeline.
      </div>
    </div>
  )
}
