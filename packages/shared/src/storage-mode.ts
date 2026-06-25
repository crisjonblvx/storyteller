export const STORAGE_MODES = ['local', 'cloud'] as const
export type StorageMode = (typeof STORAGE_MODES)[number]
