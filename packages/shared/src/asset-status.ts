/** Cloud upload leg: `not_uploaded` = local-only; `complete` = object in Storage when applicable */
export const ASSET_UPLOAD_STATUSES = ['not_uploaded', 'pending', 'uploading', 'complete', 'failed'] as const
export type AssetUploadStatus = (typeof ASSET_UPLOAD_STATUSES)[number]

export const ASSET_PROBE_STATUSES = ['pending', 'success', 'skipped', 'error'] as const
export type AssetProbeStatus = (typeof ASSET_PROBE_STATUSES)[number]
