/**
 * Component exports for Storyteller Desktop
 */

// Layout
export { ModernLayout, StepNavigation, AISuggestionsPanel, ResourcePanel, ModernCard } from './ModernLayout.js'

// Error handling
export { RouteErrorBoundary } from './RouteErrorBoundary.js'

// Query Provider
export { QueryProvider } from './QueryProvider.js'

// Asset management
export { AssetUploadZone } from './AssetUploadZone.js'
export { UploadedAssetsPanel } from './UploadedAssetsPanel.js'

// Timeline
export { TimelineEditor } from './TimelineEditor.js'
export { IntroBuilderPanel } from './IntroBuilderPanel.js'

// Preview
export { ClipPreviewModal } from './ClipPreviewModal.js'
export { ExpandableImagePreview, ImageLightbox } from './ExpandableImagePreview.js'
export { InlineClipPlayer } from './InlineClipPlayer.js'

// Overlays
export { OverlayLayer } from './overlays/OverlayLayer.js'
export {
  AddHookOverlayPanel,
  AddPausePanel,
  AddStatOverlayPanel,
  AddTextOverlayPanel
} from './overlays/EnhancePanels.js'

// B-roll
export { BrollPromptBody } from './broll/BrollPromptBody.js'

// System
export { SystemStatusBar } from './SystemStatusBar.js'
