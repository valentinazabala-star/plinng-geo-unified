// src/prompts/gmbImagePrompt.ts
// GMB image generation prompt — isolated from SEO article image prompts

export interface GmbImagePromptParams {
  mainKeyword: string;
  postType?: string;   // e.g. "update", "offer", "event", "announcement"
  postIntent?: string; // e.g. "inform / attract visits / promote action"
}

export function buildGmbImagePrompt(params: GmbImagePromptParams): string {
  const {
    mainKeyword,
    postType = 'update',
    postIntent = 'inform / attract visits',
  } = params;

  return `Create a high-quality image for a Google My Business post.

This image will be generated at the same time as the post and must visually support its message and objective.

Image purpose
The image must be contextually useful, not decorative.
It should help users quickly understand:
• what the business offers,
• what is being announced (update, offer, event, or information),
• or what they can expect when visiting or contacting the business.
Think of it as a visual complement to a Google My Business post, designed to capture attention in Google Search and Google Maps.

Editorial & visual style references
Use visual standards commonly found in high-quality, real-world business listings and editorial-style local content, similar to visuals used by:
• Google Business Profile featured posts
• Google Maps business photos
• Editorial sections of El País, BBC, and The Guardian for local or service-related content

Style characteristics
• Clean, realistic, and natural
• Clear visual focus on the subject
• Natural or soft lighting
• Authentic environments and situations
• Professional but approachable composition
• No exaggerated effects
• No stock-photo clichés

Technical requirements (mandatory)
• Size: 1200 × 900 px
• Aspect ratio: 4:3
• Orientation: horizontal
• Optimized for Google My Business posts
• Well-framed to avoid cropping on Google surfaces
• No text overlays
• No watermarks
• No logos unless explicitly requested

Local relevance & usefulness
• The image should visually reinforce proximity, availability, or real interaction with the business.
• It must represent something the user could realistically see, experience, or receive.
• Avoid abstract or overly conceptual visuals that do not translate well to a local business context.

Post context
Post type: ${postType}

Main keyword or core topic: ${mainKeyword}

Post intent: ${postIntent}

Generate only the image.`;
}
