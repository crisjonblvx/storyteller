/**
 * In a packaged Electron app, binaries listed in `asarUnpack` are extracted to
 * `app.asar.unpacked/` on disk, but npm packages that compute their binary path
 * via `__dirname` return a virtual `app.asar/…` path.  `child_process.spawn()`
 * is a native syscall — it cannot resolve paths inside the ASAR virtual
 * filesystem → ENOENT.  Rewrite the path to the real on-disk location.
 *
 * Safe to call in dev: when the path contains no `app.asar` segment (normal
 * `node_modules/` paths) it is returned unchanged.
 */
export function resolveUnpackedBinary(p: string): string {
  return p.replace(/([/\\])app\.asar([/\\])/g, '$1app.asar.unpacked$2')
}
