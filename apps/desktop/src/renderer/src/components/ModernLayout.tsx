/**
 * Modern 3-Panel Layout Component for Storyteller
 * Inspired by professional video editing tools
 */

import React from 'react'

interface ModernLayoutProps {
  children: React.ReactNode
  leftSidebar?: React.ReactNode
  rightSidebar?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}

/**
 * Modern 3-panel layout:
 * - Left: Resource panel (assets, media)
 * - Center: Main workspace (preview + timeline)
 * - Right: AI Suggestions panel
 */
export function ModernLayout({
  children,
  leftSidebar,
  rightSidebar,
  header,
  footer
}: ModernLayoutProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--bg-primary)',
        fontFamily: 'var(--font-sans)'
      }}
    >
      {/* Header / Step Navigation */}
      {header && (
        <header
          style={{
            flexShrink: 0,
            height: '64px',
            background: 'var(--surface-1)',
            borderBottom: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            zIndex: 100
          }}
        >
          {header}
        </header>
      )}

      {/* Main Content Area */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden'
        }}
      >
        {/* Left Sidebar - Resources */}
        {leftSidebar && (
          <aside
            style={{
              width: '280px',
              flexShrink: 0,
              background: 'var(--surface-1)',
              borderRight: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            {leftSidebar}
          </aside>
        )}

        {/* Center - Main Workspace */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg-primary)'
          }}
        >
          {/* Preview Area */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: '16px'
            }}
          >
            {children}
          </div>

          {/* Footer / Timeline */}
          {footer && (
            <div
              style={{
                flexShrink: 0,
                height: '280px',
                background: 'var(--surface-1)',
                borderTop: '1px solid var(--border-default)',
                overflow: 'hidden'
              }}
            >
              {footer}
            </div>
          )}
        </main>

        {/* Right Sidebar - AI Suggestions */}
        {rightSidebar && (
          <aside
            style={{
              width: '320px',
              flexShrink: 0,
              background: 'var(--surface-1)',
              borderLeft: '1px solid var(--border-default)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            {rightSidebar}
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * Modern Step Navigation Component
 */
interface Step {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
}

interface StepNavigationProps {
  steps: Step[]
  activeStep: string
  onStepClick: (stepId: string) => void
  completedSteps?: string[]
}

export function StepNavigation({
  steps,
  activeStep,
  onStepClick,
  completedSteps = []
}: StepNavigationProps) {
  const currentIndex = steps.findIndex((s) => s.id === activeStep)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flex: 1,
        justifyContent: 'center'
      }}
    >
      {steps.map((step, index) => {
        const isActive = step.id === activeStep
        const isCompleted = completedSteps.includes(step.id)
        const isPast = index < currentIndex

        return (
          <React.Fragment key={step.id}>
            <button
              onClick={() => onStepClick(step.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 20px',
                borderRadius: '12px',
                border: 'none',
                background: isActive
                  ? 'var(--accent-subtle)'
                  : isCompleted
                    ? 'transparent'
                    : 'transparent',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
            >
              {/* Step Indicator */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 600,
                  background: isActive
                    ? 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)'
                    : isCompleted
                      ? 'var(--success)'
                      : 'var(--surface-3)',
                  color: isActive || isCompleted ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  boxShadow: isActive
                    ? 'var(--shadow-glow-sm)'
                    : isCompleted
                      ? '0 0 10px var(--success-glow)'
                      : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                {isCompleted && !isActive ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>

              {/* Step Label */}
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive
                    ? 'var(--accent-primary)'
                    : isCompleted
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                {step.label}
              </span>

              {/* Active Indicator */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-8px',
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    background: 'var(--accent-primary)',
                    boxShadow: '0 0 8px var(--accent-primary)'
                  }}
                />
              )}
            </button>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div
                style={{
                  width: '40px',
                  height: '2px',
                  background: isPast
                    ? 'linear-gradient(90deg, var(--success) 0%, var(--success) 100%)'
                    : 'var(--surface-3)',
                  borderRadius: '1px',
                  margin: '0 4px'
                }}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/**
 * AI Suggestions Panel (Right Sidebar)
 */
interface AISuggestion {
  id: string
  type: 'broll' | 'text' | 'audio' | 'style'
  title: string
  description: string
  confidence: number
  onApply: () => void
}

interface AISuggestionsPanelProps {
  suggestions: AISuggestion[]
  isLoading?: boolean
}

export function AISuggestionsPanel({ suggestions, isLoading }: AISuggestionsPanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px',
          borderBottom: '1px solid var(--border-default)'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '4px'
          }}
        >
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--accent-purple)',
              boxShadow: '0 0 10px var(--accent-purple-glow)'
            }}
          />
          <h3
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}
          >
            Creative AI
          </h3>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
          Intelligent suggestions for your story
        </p>
      </div>

      {/* Suggestions List */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px'
        }}
      >
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '20px'
            }}
          >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: '80px',
                  background: 'var(--surface-2)',
                  borderRadius: '12px',
                  animation: 'pulse 2s infinite'
                }}
              />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                onClick={suggestion.onApply}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-accent)'
                  e.currentTarget.style.background = 'var(--surface-3)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-default)'
                  e.currentTarget.style.background = 'var(--surface-2)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px'
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background:
                        suggestion.type === 'broll'
                          ? 'rgba(0, 212, 255, 0.15)'
                          : suggestion.type === 'text'
                            ? 'rgba(168, 85, 247, 0.15)'
                            : 'var(--surface-4)',
                      color:
                        suggestion.type === 'broll'
                          ? 'var(--accent-primary)'
                          : suggestion.type === 'text'
                            ? 'var(--accent-purple)'
                            : 'var(--text-secondary)'
                    }}
                  >
                    {suggestion.type}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)'
                    }}
                  >
                    {Math.round(suggestion.confidence * 100)}% match
                  </span>
                </div>
                <h4
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '4px'
                  }}
                >
                  {suggestion.title}
                </h4>
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5
                  }}
                >
                  {suggestion.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Resource Panel (Left Sidebar)
 */
interface ResourcePanelProps {
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
}

export function ResourcePanel({ title, children, actions }: ResourcePanelProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <h3
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}
        >
          {title}
        </h3>
        {actions && <div style={{ display: 'flex', gap: '8px' }}>{actions}</div>}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px'
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Modern Card Component
 */
interface ModernCardProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
  action?: React.ReactNode
  variant?: 'default' | 'elevated' | 'outlined'
}

export function ModernCard({
  children,
  title,
  subtitle,
  action,
  variant = 'default'
}: ModernCardProps) {
  const variantStyles = {
    default: {
      background: 'var(--surface-2)',
      border: '1px solid var(--border-default)'
    },
    elevated: {
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-default)',
      boxShadow: 'var(--shadow-lg)'
    },
    outlined: {
      background: 'transparent',
      border: '1px solid var(--border-default)'
    }
  }

  return (
    <div
      style={{
        borderRadius: '16px',
        overflow: 'hidden',
        ...variantStyles[variant]
      }}
    >
      {(title || subtitle || action) && (
        <div
          style={{
            padding: '20px',
            borderBottom: variant !== 'outlined' ? '1px solid var(--border-default)' : 'none',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between'
          }}
        >
          <div>
            {title && (
              <h3
                style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: subtitle ? '4px' : 0
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{subtitle}</p>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div style={{ padding: '20px' }}>{children}</div>
    </div>
  )
}
