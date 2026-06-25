import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RouteErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const isDev = import.meta.env.DEV
      return (
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            padding: 40,
            flexDirection: 'column',
            gap: 16,
            maxWidth: 560
          }}
        >
          <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: 'var(--muted)', margin: 0 }}>{this.state.error.message}</p>
          {isDev && (
            <pre
              style={{
                fontSize: 11,
                overflow: 'auto',
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: '#0c0d11',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {this.state.error.stack}
            </pre>
          )}
          <Link
            to="/"
            style={{
              display: 'inline-block',
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              color: 'var(--text)',
              textDecoration: 'none',
              width: 'fit-content'
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      )
    }
    return this.props.children
  }
}
