import type { Asset } from '@storyteller/shared'
import { useLocalAssetsStore } from '@renderer/stores/local-assets'

type ThumbnailAsset = Pick<Asset, 'id' | 'project_id' | 'local_path' | 'proxy_path' | 'asset_type'>

const inFlight = new Set<string>()

function isThumbnailCandidate(asset: ThumbnailAsset): boolean {
  if (!asset.local_path?.trim()) return false
  if (asset.proxy_path?.trim()) return false
  return asset.asset_type === 'video' || asset.asset_type === 'image' || asset.asset_type === 'photo'
}

/** Disk path suitable for `<img src>` — never a raw video file. */
export function assetThumbnailPath(asset: ThumbnailAsset): string | null {
  if (asset.proxy_path?.trim()) return asset.proxy_path
  if (asset.asset_type === 'image' || asset.asset_type === 'photo') {
    return asset.local_path?.trim() || null
  }
  return null
}

export function assetThumbnailUrl(asset: ThumbnailAsset): string | null {
  const path = assetThumbnailPath(asset)
  if (!path) return null
  return window.storyteller?.toMediaUrl?.(path) ?? null
}

export async function backfillAssetThumbnail(asset: ThumbnailAsset): Promise<boolean> {
  if (!isThumbnailCandidate(asset)) return false
  if (inFlight.has(asset.id)) return false

  const bridge = window.storyteller
  if (!bridge?.extractAssetThumbnail) return false

  inFlight.add(asset.id)
  try {
    const localPath = asset.local_path!.trim()
    const verified = await bridge.verifyLocalMediaPath?.(localPath)
    if (verified && !verified.exists) return false

    const res = await bridge.extractAssetThumbnail({ sourcePath: localPath, assetId: asset.id })
    if (res.ok) {
      const store = useLocalAssetsStore.getState()
      const inLocal = (store.byProject[asset.project_id] ?? []).some((a) => a.id === asset.id)
      if (inLocal) {
        store.updateAssetProxyPath(asset.project_id, asset.id, res.path)
      } else if ('created_at' in asset && asset.created_at) {
        store.addAssets(asset.project_id, [{ ...(asset as Asset), proxy_path: res.path }])
      }
      return true
    }
    return false
  } catch {
    return false
  } finally {
    inFlight.delete(asset.id)
  }
}

/** Best-effort ffmpeg thumbnails for assets missing `proxy_path`. */
export function backfillMissingThumbnails(assets: ThumbnailAsset[]): void {
  for (const asset of assets) {
    if (isThumbnailCandidate(asset)) {
      void backfillAssetThumbnail(asset)
    }
  }
}
