/**
 * OpenTimelineIO (OTIO) Export for Storyteller
 *
 * Provides OTIO export functionality for interchange with professional NLEs.
 * OTIO is Pixar's open format that works with Final Cut Pro, Premiere Pro,
 * DaVinci Resolve, Nuke, Blender, and many other tools.
 *
 * @see https://opentimelineio.readthedocs.io/
 */

export * from './types.js'
export { timelineToOtio, serializeOtio } from './converter.js'
