/**
 * Called by electron-builder's `afterSign` hook.
 * Notarizes the macOS app with Apple's notary service.
 *
 * Required environment variables (set in CI or your local shell before running `npm run pack`):
 *   APPLE_ID              — your Apple ID email (e.g. you@example.com)
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID         — your 10-character Apple Team ID (from developer.apple.com)
 */
import { notarize } from '@electron/notarize'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context

  if (electronPlatformName !== 'darwin') return

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      '[notarize] Skipping — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to notarize.'
    )
    return
  }

  const pkgJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
  const appName = pkgJson.build.productName
  const appBundleId = pkgJson.build.appId
  const appPath = join(appOutDir, `${appName}.app`)

  console.log(`[notarize] Notarizing ${appBundleId} at ${appPath}...`)

  await notarize({
    appBundleId,
    appPath,
    appleId,
    appleIdPassword,
    teamId
  })

  console.log('[notarize] Notarization complete.')
}
