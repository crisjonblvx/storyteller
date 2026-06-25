import '../styles.css'
import {
  adminFetch,
  clearStoredToken,
  formatDate,
  formatUsd,
  getStoredToken,
  setStoredToken,
  shortId,
  type AdminActivityItem,
  type AdminOverview,
  type AdminUserRow
} from './admin-api'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Missing #app')

let token = getStoredToken()

function renderLogin(error?: string) {
  app!.innerHTML = `
    <div class="page admin-page">
      <header class="header">
        <a class="brand" href="/">Content Creators</a>
        <span class="badge">Admin</span>
      </header>
      <main class="admin-login">
        <h1>Storyteller Admin</h1>
        <p class="subtitle">Operator dashboard — usage and spend observability.</p>
        <form class="admin-form" id="login-form">
          <label>
            <span>Admin password</span>
            <input type="password" name="password" autocomplete="current-password" required />
          </label>
          ${error ? `<p class="admin-error">${escapeHtml(error)}</p>` : ''}
          <button type="submit" class="btn btn-primary">Sign in</button>
        </form>
      </main>
      <footer class="footer">
        <a href="/storyteller">← Storyteller download</a>
      </footer>
    </div>
  `

  document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const password = new FormData(form).get('password') as string
    const btn = form.querySelector('button') as HTMLButtonElement
    btn.disabled = true
    try {
      const res = await adminFetch<{ token: string }>('/v1/admin/login', {
        method: 'POST',
        body: { password }
      })
      setStoredToken(res.token)
      token = res.token
      await loadDashboard()
    } catch (err) {
      renderLogin(err instanceof Error ? err.message : 'Login failed')
    }
  })
}

async function loadDashboard() {
  if (!token) {
    renderLogin()
    return
  }

  app!.innerHTML = `
    <div class="page admin-page">
      <header class="header admin-header">
        <div>
          <a class="brand" href="/">Content Creators</a>
          <span class="badge">Admin</span>
        </div>
        <div class="admin-toolbar">
          <button type="button" class="btn btn-secondary btn-sm" id="refresh-btn">Refresh</button>
          <button type="button" class="btn btn-secondary btn-sm" id="logout-btn">Log out</button>
        </div>
      </header>
      <main class="admin-main">
        <p class="admin-loading">Loading dashboard…</p>
      </main>
    </div>
  `

  document.querySelector('#logout-btn')?.addEventListener('click', () => {
    clearStoredToken()
    token = null
    renderLogin()
  })
  document.querySelector('#refresh-btn')?.addEventListener('click', () => void loadDashboard())

  try {
    const [overview, usersRes, activityRes] = await Promise.all([
      adminFetch<AdminOverview>('/v1/admin/overview', { token }),
      adminFetch<{ users: AdminUserRow[] }>('/v1/admin/users', { token }),
      adminFetch<{ items: AdminActivityItem[]; total: number }>('/v1/admin/activity?limit=40', {
        token
      })
    ])
    renderDashboard(overview, usersRes.users, activityRes.items, activityRes.total)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load dashboard'
    if (msg.toLowerCase().includes('token') || msg.toLowerCase().includes('unauthorized')) {
      clearStoredToken()
      token = null
      renderLogin('Session expired — sign in again.')
      return
    }
    const main = document.querySelector('.admin-main')
    if (main) {
      main.innerHTML = `<p class="admin-error">${escapeHtml(msg)}</p>`
    }
  }
}

function renderDashboard(
  overview: AdminOverview,
  users: AdminUserRow[],
  activity: AdminActivityItem[],
  activityTotal: number
) {
  const main = document.querySelector('.admin-main')
  if (!main) return

  main.innerHTML = `
    <section class="admin-cards">
      <div class="admin-card">
        <span class="admin-card-label">Est. spend (MTD)</span>
        <strong class="admin-card-value">${formatUsd(overview.estimatedUsdMtd)}</strong>
      </div>
      <div class="admin-card">
        <span class="admin-card-label">Users</span>
        <strong class="admin-card-value">${overview.userCount}</strong>
        <span class="admin-card-sub">${overview.activeUsersMtd} active MTD</span>
      </div>
      <div class="admin-card">
        <span class="admin-card-label">Jobs (MTD)</span>
        <strong class="admin-card-value">${overview.jobsMtd}</strong>
      </div>
      <div class="admin-card">
        <span class="admin-card-label">Credits consumed</span>
        <strong class="admin-card-value">${overview.creditsConsumedMtd.toLocaleString()}</strong>
      </div>
    </section>

    <section class="admin-section">
      <h2>Users</h2>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th>Balance</th>
              <th>Allowances (mo)</th>
              <th>Credits MTD</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            ${users.length === 0 ? '<tr><td colspan="6" class="admin-empty">No users yet</td></tr>' : users.map(renderUserRow).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="admin-section">
      <h2>Recent activity <span class="admin-muted">(${activityTotal} total)</span></h2>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Intent</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Credits</th>
              <th>Est. USD</th>
            </tr>
          </thead>
          <tbody>
            ${activity.length === 0 ? '<tr><td colspan="7" class="admin-empty">No jobs yet</td></tr>' : activity.map(renderActivityRow).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <p class="admin-footnote">
      MTD since ${formatDate(overview.periodStart)} UTC. USD estimates use rough COGS from pricing docs — not invoice amounts.
      Transcription/analyze runs locally or via gateway are not fully logged yet.
    </p>
  `
}

function renderUserRow(u: AdminUserRow): string {
  return `
    <tr>
      <td>${escapeHtml(u.email || shortId(u.userId))}</td>
      <td><code>${escapeHtml(u.planId)}</code></td>
      <td>${u.balance.toLocaleString()}</td>
      <td class="admin-allowances">EP ${u.episodePassesUsed} · CB ${u.clipBatchesUsed} · AV ${u.aiVideosUsed}</td>
      <td>${u.creditsSpentMtd.toLocaleString()}</td>
      <td>${formatDate(u.lastActivity)}</td>
    </tr>
  `
}

function renderActivityRow(a: AdminActivityItem): string {
  return `
    <tr>
      <td>${formatDate(a.createdAt)}</td>
      <td>${escapeHtml(a.userEmail || '—')}</td>
      <td><code>${escapeHtml(a.intent)}</code></td>
      <td>${escapeHtml(a.provider)}</td>
      <td><span class="admin-status admin-status-${a.status}">${escapeHtml(a.status)}</span></td>
      <td>${a.creditsReserved}</td>
      <td>${formatUsd(a.estimatedUsd)}</td>
    </tr>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

if (token) {
  void loadDashboard()
} else {
  renderLogin()
}
