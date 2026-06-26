/** Shared download config — values come from Vercel env at build time. */
export function downloadConfig() {
  const owner = (import.meta.env.VITE_GITHUB_OWNER || 'crisjonblvx').trim()
  const repo = (import.meta.env.VITE_GITHUB_REPO || 'storyteller').trim()
  const version = (import.meta.env.VITE_APP_VERSION || '1.0.1').trim()
  const productName = (import.meta.env.VITE_PRODUCT_NAME || 'Storyteller').trim()

  const tag = version.startsWith('v') ? version : `v${version}`

  function asset(filename: string) {
    return `https://github.com/${owner}/${repo}/releases/download/${tag}/${filename}`
  }

  return {
    owner,
    repo,
    version,
    productName,
    tag,
    releasesUrl: `https://github.com/${owner}/${repo}/releases/latest`,
    downloads: {
      macArm64: asset(`${productName}-${version}-arm64.dmg`),
      macIntel: asset(`${productName}-${version}-x64.dmg`),
      macUniversal: asset(`${productName}-${version}-universal.dmg`),
      win: asset(`${productName} Setup ${version}.exe`)
    }
  }
}

export type OsKind = 'mac-arm' | 'mac-intel' | 'mac' | 'win' | 'other'

export function detectOs(): OsKind {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  const platform = navigator.platform || ''
  if (/Win/i.test(ua)) return 'win'
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) {
    // Apple Silicon Macs often report MacIntel in UA; prefer arm64 DMG as default on Mac.
    return 'mac-arm'
  }
  return 'other'
}

export function primaryDownload(config: ReturnType<typeof downloadConfig>, os: OsKind) {
  if (os === 'win') return { label: 'Download for Windows', url: config.downloads.win }
  if (os === 'mac-arm') return { label: 'Download for Mac (Apple Silicon)', url: config.downloads.macArm64 }
  if (os === 'mac-intel') return { label: 'Download for Mac (Intel)', url: config.downloads.macIntel }
  return { label: 'View all downloads', url: config.releasesUrl }
}
