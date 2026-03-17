# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server on http://localhost:3000
npm run build     # TypeScript check + production build
npm run preview   # Preview production build locally
```

No test suite or linter is configured.

## Environment Variables

Copy `.env` and populate these before running:

| Variable | Purpose |
|---|---|
| `VITE_GEMINI_API_KEY` | Google Gemini API key (also exposed as `process.env.API_KEY`) |
| `VITE_WP_DOMAIN` | WordPress site 1 (cienciacronica.com) |
| `VITE_WORDPRESS_TOKEN` | JWT token for site 1 |
| `VITE_WP_DOMAIN_2` | WordPress site 2 (elinformedigital.com) |
| `VITE_WORDPRESS_TOKEN_2` | JWT token for site 2 |
| `VITE_WP_DOMAIN_3` | WordPress site 3 (laprensa360.com) |
| `VITE_WORDPRESS_TOKEN_3` | JWT token for site 3 |
| `VITE_WP_DOMAIN_EN` | WordPress site 4 (wall-trends.com) |
| `VITE_WORDPRESS_TOKEN_EN` | JWT token for site 4 |
| `VITE_WP_DOMAIN_5` | WordPress site 5 (masproposals.com) |
| `VITE_WORDPRESS_TOKEN_5` | JWT token for site 5 |
| `VITE_CLICKUP_API_KEY` | ClickUp API key for task status updates |
| `VITE_ORBIDI_API_KEY` | Orbidi API key for fetching client briefs |

Vite exposes env vars only with the `VITE_` prefix in client code via `import.meta.env.*`. The `GEMINI_API_KEY` is also mapped to `process.env.API_KEY` and `process.env.GEMINI_API_KEY` in `vite.config.ts` for compatibility with the `@google/genai` SDK.

## Architecture

The entire application lives in two large files:

### `src/App.tsx` (~4200 lines)
Single React component (`App`) with all UI and orchestration logic. It is **not** split into sub-components. Key areas within the file:

- **Lines 1–1108**: Pure utility functions (no React). Includes HTML/text post-processing: `enforceParagraphLength`, `limitStrongUsagePerParagraph`, `removeInternalLinks`, `insertInternalLinks`, `toSentenceCase`, `smartTruncate`, `extractWebsiteFromBriefHTML`, and the Orbidi brief parser.
- **Lines 1109–1230**: `App` component state declarations. All state is flat `useState` at the top level — no context, no reducers.
- **Lines 1230+**: Event handlers and async workflows: `handleDataAcquisition`, `handleCsvUpload`, `handleGenerateKeywords`, `handleGenerateOutline`, `handleWriteAllSections`, `handlePublish`, ClickUp/Prodline update functions.
- **Bottom third**: JSX render — step-based UI (`AppStep.ACCOUNT → KEYWORDS → OUTLINE → WRITING`).

**Two operating modes** toggled by `isManualMode`:
1. **Auto mode** (default): Fetches brief from Orbidi API by account UUID, extracts metadata, then auto-runs the full pipeline.
2. **CSV/Manual mode**: User uploads a CSV with columns `account_uuid, kw, task_count, task_clickup_ids`; each row is processed sequentially via `processBatchRow`.

**`WP_CATEGORY_CATALOG`** (lines 16–160): Hardcoded per-site WordPress category lists used by the AI to pick the best category for each article.

### `src/geminiService.ts` (~1500 lines)
All AI logic. No React. Exported functions called by `App.tsx`:

- `resolveLanguageProfile(langCode)` — returns a `LanguageProfile` with grammar rules, vocabulary preferences, punctuation rules, tone instructions, and template strings for one of 8 languages (`es/en/pt/fr/it/de/nl/ca`).
- `generateKeywords(brief, contentType, language)` — generates primary + secondary keywords.
- `generateArticleOutline(brief, keywords, article, languageProfile)` — returns title, meta, intro, and section stubs.
- `generateSectionContent(section, article, languageProfile, locationContext?)` — writes a full section with HTML formatting.
- `polishText(html, languageProfile)` — AI-assisted final pass for readability.
- `generateImage(prompt, size)` — calls `gemini-3-pro-image-preview` and returns a base64 JPEG.
- `pickBestWordPressCategory(params)` — uses AI to select from the allowed category list.
- `generateGmbPost(params)` — generates a structured GMB post using the GMB text prompt; returns a `GmbPost` object.
- `buildGmbImagePromptFn(params)` — thin wrapper around `buildGmbImagePrompt` from `src/prompts/`.

**Models** (defined in `MODELS` const): Both `PRO` and `FLASH` map to `gemini-2.5-flash`; `IMAGE` uses `gemini-3-pro-image-preview`. All calls use exponential backoff via `RETRY_CONFIG` (3 attempts, 1 s base delay, ×2 multiplier).

### `src/types.ts`
Shared TypeScript types: `Article`, `Section`, `ContentType` (`on_blog | off_page | gmb`), `SupportedLanguageCode`, `AppStep` (enum-like `as const` object — includes `CONTENT_TYPE` step).

### `src/prompts/`
Isolated prompt builders for GMB content:
- `gmbTextPrompt.ts` — exports `buildGmbTextPrompt(params)`, `parseGmbPost(rawText)`, and the `GmbPost` interface
- `gmbImagePrompt.ts` — exports `buildGmbImagePrompt(params)`

## Key Patterns

- **No React Router** — navigation is pure state (`step` field of type `AppStep`).
- **Content type flow** — Manual mode: `ACCOUNT → KEYWORDS → CONTENT_TYPE → OUTLINE/WRITING`. Batch/CSV mode: `CONTENT_TYPE` step is skipped; the type is read from the optional `content_type` CSV column (default `on_blog`).
- **Publishing target** is determined by `resolvePublishingTarget(contentType, language)` inside `App.tsx`:
  - `on_blog` → `VITE_WP_DOMAIN_5` (masproposals.com)
  - `off_page` → random from `VITE_WP_DOMAIN`, `VITE_WP_DOMAIN_2`, `VITE_WP_DOMAIN_3`
  - `gmb` → `VITE_WP_DOMAIN_5` (same as on_blog)
  - English language → always `VITE_WP_DOMAIN_EN` (wall-trends.com)
- **GMB path** skips the outline and `startWriting` pipeline entirely. `startWritingGmb()` calls `generateGmbPost` + `buildGmbImagePromptFn`/`generateImage`, then assembles a minimal `Article` (one section) and jumps to `AppStep.WRITING`. In batch mode, `autoGenerateOutline` detects `contentTypeRef.current === 'gmb'` and calls `startWritingGmb` directly.
- **WordPress publishing** uses the WP REST API with JWT Bearer tokens. Images are uploaded via `/wp/v2/media`, posts via `/wp/v2/posts`.
- **ClickUp updates** hit two custom field endpoints: one for the published URL, one to set status to done.
- **Orbidi integration** fetches brief HTML from `https://eu.api.orbidi.com/prod-line/space-management/accounts/{uuid}/brief` and task details from `/prod-line/task/task-management/tasks/{taskId}/properties`.
- **Language detection** is done by the AI during keyword generation; the result drives which `LanguageProfile` is loaded and used for all subsequent generation steps.
- **HTML post-processing** pipeline (applied in `App.tsx` after each section is written): paragraph length enforcement (max 60 words) → strong tag limiting (max 2 per `<p>`) → internal link injection → business name normalization.
