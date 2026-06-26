import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RouteErrorBoundary } from '@renderer/components/RouteErrorBoundary'
import { useAuthStore } from '@renderer/stores/auth'
import { LoginPage } from '@renderer/pages/LoginPage'
import { DashboardPage } from '@renderer/pages/DashboardPage'
import { ProjectSetupPage } from '@renderer/pages/ProjectSetupPage'
import { ProjectWorkspacePage } from '@renderer/pages/ProjectWorkspacePage'
import { QuickReelPage } from '@renderer/pages/QuickReelPage'
import { AssetLibraryPage } from '@renderer/pages/AssetLibraryPage'
import { PostLoginIntro } from '@renderer/components/PostLoginIntro'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, demo, loading } = useAuthStore()
  const loc = useLocation()
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--muted)' }}>
        Loading…
      </div>
    )
  }
  if (!user && !demo) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

export default function App() {
  const init = useAuthStore((s) => s.init)
  useEffect(() => {
    void init()
  }, [init])

  return (
    <>
      <RouteErrorBoundary>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <ProjectSetupPage />
          </Protected>
        }
      />
      <Route
        path="/projects"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route
        path="/quickstart"
        element={
          <Protected>
            <QuickReelPage />
          </Protected>
        }
      />
      <Route
        path="/assets"
        element={
          <Protected>
            <AssetLibraryPage />
          </Protected>
        }
      />
      <Route path="/project/new" element={<Navigate to="/" replace />} />
      <Route
        path="/project/:projectId/setup"
        element={
          <Protected>
            <ProjectSetupPage />
          </Protected>
        }
      />
      <Route
        path="/project/:projectId"
        element={
          <Protected>
            <ProjectWorkspacePage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </RouteErrorBoundary>
    <PostLoginIntro />
    </>
  )
}
