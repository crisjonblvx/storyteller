export const TOP_LAYER_DIRECTOR_VERSION = '1.0'

const TOP_LAYER_DIRECTOR_TEMPLATE = `You are an Emmy-winning broadcast graphics designer, premium documentary title designer, commercial art director, typography director, and cinematic materials/lighting specialist.
Your job is NOT to create a flat infographic.
Your job is to design a cinematic hero frame that communicates one powerful idea instantly.
The graphic element should feel photographed, manufactured, dimensional, and physically present in space — not placed on a slide.

CREATIVE INTENT:
Create a premium title-card or documentary graphic frame worthy of Netflix, HBO, Apple TV+, Bloomberg Originals, or a luxury brand campaign.
The viewer should understand the main idea in under one second.
The hero element must dominate visually.

COMPOSITION:
Use strong negative space, clear visual hierarchy, and cinematic balance.
Avoid clutter.
Avoid small explanatory labels unless absolutely necessary.
The eye should land immediately on the hero number, phrase, symbol, or visual metaphor.

TYPOGRAPHY:
Typography should feel expensive, intentional, and physically constructed.
Use bold, dimensional letterforms when appropriate.
Supporting type must be minimal, secondary, and restrained.
Never let secondary text compete with the hero element.

MATERIALS:
Use believable premium materials: brushed titanium, machined steel, forged silver, smoked glass, black obsidian, carbon fiber, etched metal, frosted acrylic, engraved stone, subtle oxidation, edge wear, machining marks, micro scratches, and realistic bevels.
Surfaces should have tactile detail and believable imperfections.

LIGHTING:
Use cinematic motivated lighting.
Prioritize rim light, soft key light, practical bloom, subtle volumetric haze, reflective falloff, and controlled contrast.
No generic glow effects.
Bloom should feel caused by a real light source.

DEPTH:
The frame should feel like a camera photographed a designed object in a real environment.
Use depth, reflections, shadows, atmosphere, and surface contact.
Avoid the feeling of Photoshop layers stacked on a background.

COLOR:
Use restrained premium color grading.
Rich blacks.
Natural highlights.
Controlled metallics.
No oversaturated neon unless the preset demands it.

RESTRAINT:
Luxury comes from restraint.
Use fewer elements, larger scale, stronger materials, and better lighting.

DO NOT CREATE:
flat typography, vector art, PowerPoint styling, Canva templates, corporate slide decks, stock infographic design, cheap metallic text, plastic materials, generic glow, cluttered layouts, tiny unreadable text, excessive labels, fake HUD overload, random charts, AI poster aesthetics, fantasy concept art, 8k/masterpiece/trending tags.

FINAL SCENE:
{SCENE}`

/**
 * Wraps a top-layer scene description in the Top Layer Prompt Director system,
 * transforming a plain infographic or stat description into a fully art-directed
 * cinematic brief for premium documentary graphics.
 *
 * Mirrors cinematicPromptDirector.ts structurally — same single-function contract,
 * same {SCENE} substitution pattern — but designed for typography, stat cards,
 * empire graphics, timeline graphics, and financial overlays.
 */
export function buildTopLayerPrompt(sceneDescription: string): string {
  return TOP_LAYER_DIRECTOR_TEMPLATE.replace('{SCENE}', sceneDescription.trim())
}
