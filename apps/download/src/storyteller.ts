import { downloadConfig, detectOs, primaryDownload } from './config'
import './styles.css'

const cfg = downloadConfig()
const os = detectOs()
const primary = primaryDownload(cfg, os)

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Missing #app')

app.innerHTML = `
  <div class="page">
    <header class="header">
      <a class="brand" href="/">Content Creators</a>
      <span class="badge">Beta</span>
    </header>

    <main class="hero">
      <div class="icon-wrap" aria-hidden="true">
        <img src="/icon.png" alt="" width="96" height="96" />
      </div>
      <h1>${cfg.productName}</h1>
      <p class="subtitle">
        AI-guided storytelling studio for creators. Cut faster, generate B-roll, and ship polished video.
      </p>
      <p class="version">Version ${cfg.version}</p>

      <div class="actions">
        <a class="btn btn-primary" href="${primary.url}" rel="noopener">
          ${primary.label}
        </a>
        <a class="btn btn-secondary" href="${cfg.releasesUrl}" rel="noopener" target="_blank">
          All releases on GitHub
        </a>
      </div>

      <section class="cards">
        <a class="card" href="${cfg.downloads.macArm64}">
          <strong>Mac · Apple Silicon</strong>
          <span>${cfg.productName}-${cfg.version}-arm64.dmg</span>
        </a>
        <a class="card" href="${cfg.downloads.macIntel}">
          <strong>Mac · Intel</strong>
          <span>${cfg.productName}-${cfg.version}.dmg</span>
        </a>
        <a class="card" href="${cfg.downloads.win}">
          <strong>Windows</strong>
          <span>${cfg.productName} Setup ${cfg.version}.exe</span>
        </a>
      </section>

      <section class="note">
        <h2>First launch on Mac</h2>
        <p>
          This beta is not notarized yet. If macOS blocks the app, right-click <strong>${cfg.productName}</strong>
          in Applications and choose <strong>Open</strong>, then confirm once.
        </p>
        <p>
          Sign in with your Storyteller account. AI features connect to
          <code>storyteller-api.contentcreators.life</code>.
        </p>
      </section>
    </main>

    <footer class="footer">
      <a href="/">← All apps</a>
    </footer>
  </div>
`
