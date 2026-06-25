import './styles.css'

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Missing #app')

app.innerHTML = `
  <div class="page">
    <header class="header">
      <a class="brand" href="/">Content Creators</a>
      <span class="badge">Apps</span>
    </header>

    <main class="hero hub">
      <h1>Apps</h1>
      <p class="subtitle">Download desktop tools from Content Creators.</p>

      <section class="cards hub-cards">
        <a class="card card-featured" href="/storyteller/">
          <div class="card-row">
            <img src="/icon.png" alt="" width="48" height="48" />
            <div>
              <strong>Storyteller</strong>
              <span>AI-guided storytelling studio · Beta</span>
            </div>
          </div>
        </a>
      </section>
    </main>

    <footer class="footer">
      <span>contentcreators.life</span>
    </footer>
  </div>
`
