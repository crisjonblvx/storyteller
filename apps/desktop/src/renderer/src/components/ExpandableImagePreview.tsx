import { useEffect, useState, type CSSProperties } from 'react'

export type ImageLightboxProps = {
  open: boolean
  src: string
  alt: string
  title?: string
  onClose: () => void
}

export function ImageLightbox(props: ImageLightboxProps) {
  const { open, src, alt, title, onClose } = props

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Image preview: ${title}` : alt}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(8,8,11,0.82)',
        backdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          width: 'min(1200px, 96vw)',
          maxHeight: '94vh',
          background: '#15151a',
          color: '#f4f4f5',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: '#1c1c1f'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                color: '#6ee7c5',
                textTransform: 'uppercase',
                letterSpacing: '0.06em'
              }}
            >
              Image preview
            </div>
            {(title || alt) && (
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 2
                }}
                title={title ?? alt}
              >
                {title ?? alt}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close image preview"
            style={{
              background: 'transparent',
              color: '#a1a1aa',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              padding: '8px 14px',
              cursor: 'pointer',
              fontSize: 13,
              flexShrink: 0
            }}
          >
            Close (Esc)
          </button>
        </header>

        <div
          style={{
            background: '#000',
            display: 'grid',
            placeItems: 'center',
            minHeight: 200,
            maxHeight: 'calc(94vh - 64px)',
            padding: 16
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{
              maxWidth: '100%',
              maxHeight: 'calc(94vh - 96px)',
              objectFit: 'contain',
              display: 'block',
              borderRadius: 8
            }}
          />
        </div>
      </div>
    </div>
  )
}

export type ExpandableImagePreviewProps = {
  src: string
  alt: string
  title?: string
  style?: CSSProperties
  objectFit?: 'cover' | 'contain'
  maxHeight?: number | string
}

function ExpandIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  )
}

export function ExpandableImagePreview(props: ExpandableImagePreviewProps) {
  const { src, alt, title, style, objectFit = 'cover', maxHeight } = props
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  const inlineStyle: CSSProperties = {
    width: '100%',
    maxHeight: maxHeight ?? 200,
    objectFit,
    borderRadius: 10,
    background: '#0a0a0b',
    border: '1px solid rgba(255,255,255,0.08)',
    display: 'block',
    ...style
  }

  return (
    <>
      <div
        style={{ position: 'relative', width: '100%' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <img src={src} alt={alt} style={inlineStyle} />
        <button
          type="button"
          aria-label="View full size"
          title="View full size"
          onClick={() => setOpen(true)}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: hovered ? '6px 10px' : 6,
            borderRadius: 8,
            border: '1px solid rgba(110,231,197,0.35)',
            background: 'rgba(8,8,11,0.78)',
            color: '#6ee7c5',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            opacity: hovered ? 1 : 0.85,
            transition: 'opacity 120ms ease, padding 120ms ease',
            backdropFilter: 'blur(4px)'
          }}
        >
          <ExpandIcon />
          {hovered ? 'Full size' : null}
        </button>
      </div>

      <ImageLightbox
        open={open}
        src={src}
        alt={alt}
        title={title}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
