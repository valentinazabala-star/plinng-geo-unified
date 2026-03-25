/**
 * Prodline Deliverable Service
 *
 * Port de production-line-microservice/api/services/marketing_actions/resolvers.py
 *
 * Después de publicar en WordPress, este servicio:
 *   1. Determina la imagen por defecto según el tipo de artículo (content_type del CSV)
 *   2. Intenta descargar la imagen de Google Drive
 *   3. Crea una propuesta en Prodline con la URL del artículo + la imagen
 *      POST /task-management/tasks/{taskId}/deliverable
 *   4. Actualiza el campo assigned_team = 'content_factory'
 *      POST /task/task-management/tasks/{taskId}/properties
 *
 * El task UUID viene del CSV: columna task_prodline_ids (comma-separated).
 * El artículo i → task UUID i de esa lista.
 *
 * Columna opcional en el CSV: deliverable_type
 *   Valores aceptados: seo_article | seo_off_page | seo_on_my_page |
 *                      strategy_seo | gmb_post_notice | gmb_setup | gmb_optimization
 *   Si no está, se mapea automáticamente desde content_type.
 */

import type { ContentType } from './types';

// ─── Imágenes por defecto (mismo dict que resolvers.py) ──────────────────────

const DEFAULT_COVER_IMAGES: Record<string, string> = {
  seo_off_page:     'https://drive.google.com/file/d/13idlTtc0LdmkJmFaXeCi7imyXwd4McuZ/view?usp=drive_link',
  seo_on_my_page:   'https://drive.google.com/file/d/1MptJ7ch11zml1iDMwbLruEYK4sGLEIfb/view?usp=drive_link',
  seo_article:      'https://drive.google.com/file/d/16HDcIbHosMMqaMUpM1k0zlfo0HzK8b8H/view?usp=drive_link',
  strategy_seo:     'https://drive.google.com/file/d/1otIQF0IuU-rfmTGp-Jpye4kFdwkCKWdQ/view?usp=drive_link',
  gmb_post_notice:  'https://drive.google.com/file/d/12NJRnf0t9midbiDLYTTzIIgDS7Kc32L4/view?usp=drive_link',
  gmb_setup:        'https://drive.google.com/file/d/1NrWJ3e20oMMZZkIYBUVbm-PJYDe6JsF2/view?usp=drive_link',
  gmb_optimization: 'https://drive.google.com/file/d/1NrWJ3e20oMMZZkIYBUVbm-PJYDe6JsF2/view?usp=drive_link',
};

// ─── content_type del CSV → clave de imagen ───────────────────────────────────
//   on_blog  → seo_article     (Artículos SEO en blog)
//   off_page → seo_off_page    (Acciones SEO Off-Page)
//   gmb      → gmb_post_notice (Post de Noticias GMB)

const CONTENT_TYPE_MAP: Record<ContentType, string> = {
  on_blog:  'seo_article',
  off_page: 'seo_off_page',
  gmb:      'gmb_post_notice',
};

export function resolveDeliverableImageUrl(
  contentType: ContentType,
  deliverableTypeOverride?: string,
): string {
  const key =
    deliverableTypeOverride && deliverableTypeOverride in DEFAULT_COVER_IMAGES
      ? deliverableTypeOverride
      : CONTENT_TYPE_MAP[contentType] ?? 'seo_article';
  return DEFAULT_COVER_IMAGES[key];
}

// ─── Google Drive: shared URL → download URL ─────────────────────────────────

function extractDriveFileId(driveUrl: string): string | null {
  const match = driveUrl.match(/\/file\/d\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Descarga la imagen de Google Drive.
 * Retorna null si hay error de CORS o el archivo no es una imagen.
 * En ese caso el caller enviará la URL de Drive como external_url de respaldo.
 */
async function downloadDriveImage(driveUrl: string): Promise<Blob | null> {
  const fileId = extractDriveFileId(driveUrl);
  if (!fileId) return null;

  try {
    const res = await fetch(
      `https://drive.google.com/uc?export=download&id=${fileId}`,
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    // Si Google devuelve HTML (scan de virus / login redirect) no sirve
    if (blob.type.startsWith('text/html')) return null;
    return blob;
  } catch {
    // CORS u otro error de red → el caller usará la URL como fallback
    return null;
  }
}

// ─── Mapeos para el nuevo endpoint directo ───────────────────────────────────

const CONTENT_TYPE_TO_PRODUCT: Record<ContentType, 'SEO' | 'GMB'> = {
  on_blog:  'SEO',
  off_page: 'SEO',
  gmb:      'GMB',
};

// Palabras clave que el backend usa para detectar la imagen de portada
// (deben coincidir con DeliverableTypes en el microservicio)
const CONTENT_TYPE_TO_TITLE_KEYWORD: Record<ContentType, string> = {
  on_blog:  'Artículos SEO en blog',
  off_page: 'Acciones SEO Off-Page',
  gmb:      'Post de Noticias',
};

// ─── API endpoints ────────────────────────────────────────────────────────────

const PRODLINE_BASE = 'https://eu.api.orbidi.com/prod-line';
const PRODLINE_DEV_BASE = import.meta.env.VITE_PRODLINE_DEV_BASE ?? 'https://api-dev.orbidi.com/prod-line';

export interface ProdlineProposalResult {
  success: boolean;
  imageUploaded: boolean;  // true si se subió el archivo; false si se envió como link
  error?: string;
}

/**
 * Crea una propuesta de tarea en Prodline.
 *
 * Endpoint: POST /task-management/tasks/{taskId}/deliverable
 * Body multipart:
 *   - attachments: JSON string con [{type:"external_url", attachment: articleUrl}, ...]
 *   - cover_image: Blob de la imagen (si descarga exitosa)
 *
 * Si Google Drive bloquea la descarga por CORS, envía la URL de Drive
 * como segundo attachment de tipo external_url.
 */
export async function createProdlineProposal(
  taskId: string,
  articleUrl: string,
  contentType: ContentType,
  apiKey: string,
  deliverableTypeOverride?: string,
): Promise<ProdlineProposalResult> {
  const driveUrl = resolveDeliverableImageUrl(contentType, deliverableTypeOverride);

  // El backend Django hace json.loads(request.data.get('attachments', [])),
  // por lo que siempre hay que enviar multipart/form-data con 'attachments' como JSON string.
  const attachments: object[] = [
    { type: 'external_url', content: articleUrl, index: 1 },
  ];

  const formData = new FormData();

  const imageBlob = await downloadDriveImage(driveUrl);
  let imageUploaded = false;

  if (imageBlob) {
    formData.append('cover_image', imageBlob, 'cover-seo.jpg');
    attachments.push({ type: 'img', index: 2 });
    imageUploaded = true;
  }

  formData.append('attachments', JSON.stringify(attachments));

  try {
    const res = await fetch(
      `${PRODLINE_BASE}/task-management/tasks/${taskId}/deliverable`,
      {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        body: formData,
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { success: false, imageUploaded, error: `${res.status}: ${body}` };
    }
    return { success: true, imageUploaded };
  } catch (err: unknown) {
    return { success: false, imageUploaded, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Actualiza el campo assigned_team = 'content_factory' en Prodline.
 *
 * Endpoint: POST /task/task-management/tasks/{taskId}/properties
 * (ya existía en updateProdlineTasks, ahora se hace por artículo automáticamente)
 */
export async function assignProdlineTask(
  taskId: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${PRODLINE_BASE}/task/task-management/tasks/${taskId}/properties`,
      {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ assigned_team: 'content_factory' }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Nuevo endpoint directo (sin ClickUp) ─────────────────────────────────────

export interface MarketingActionSyncResult {
  success: boolean;
  error?: string;
  should_retry?: boolean;
}

/**
 * Actualiza el deliverable de una tarea existente en Prodline (PUT).
 * Se usa en el flujo de feedback cuando la tarea ya tiene una propuesta previa.
 * Si el PUT falla (endpoint no soportado), intenta con POST como fallback.
 */
export async function updateProdlineDeliverable(
  taskId: string,
  articleUrl: string,
  contentType: ContentType,
  apiKey: string,
): Promise<ProdlineProposalResult> {
  const driveUrl = resolveDeliverableImageUrl(contentType);
  const attachments: object[] = [
    { type: 'external_url', content: articleUrl, index: 1 },
  ];

  const formData = new FormData();
  const imageBlob = await downloadDriveImage(driveUrl);
  let imageUploaded = false;

  if (imageBlob) {
    formData.append('cover_image', imageBlob, 'cover-seo.jpg');
    attachments.push({ type: 'img', index: 2 });
    imageUploaded = true;
  }
  formData.append('attachments', JSON.stringify(attachments));

  const endpoint = `${PRODLINE_BASE}/task-management/tasks/${taskId}/deliverable`;
  const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' };

  // Intentar PUT primero (actualizar existente)
  try {
    const resPut = await fetch(endpoint, { method: 'PUT', headers, body: formData });
    if (resPut.ok) return { success: true, imageUploaded };
    const bodyPut = await resPut.text();
    // Si PUT no soportado (404/405), caer en POST
    if (resPut.status !== 404 && resPut.status !== 405) {
      return { success: false, imageUploaded, error: `PUT ${resPut.status}: ${bodyPut}` };
    }
  } catch { /* red error, intentar POST */ }

  // Fallback: POST
  try {
    const formData2 = new FormData();
    if (imageBlob) formData2.append('cover_image', imageBlob, 'cover-seo.jpg');
    formData2.append('attachments', JSON.stringify(attachments));
    const resPost = await fetch(endpoint, { method: 'POST', headers, body: formData2 });
    if (resPost.ok) return { success: true, imageUploaded };
    const bodyPost = await resPost.text();
    return { success: false, imageUploaded, error: `POST ${resPost.status}: ${bodyPost}` };
  } catch (err: unknown) {
    return { success: false, imageUploaded, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Cambia el estado de una tarea en Prodline a TASK_IN_PROGRESS.
 * Se usa en el flujo de feedback antes de hacer el sync del deliverable.
 *
 * Endpoint: PATCH /task-management/tasks/{taskUuid}
 */
export async function setTaskInProgress(
  taskUuid: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${PRODLINE_BASE}/task/task-management/tasks/${taskUuid}/properties`,
      {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ status: 'TASK_IN_PROGRESS' }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sincroniza el deliverable usando el nuevo endpoint directo.
 *
 * Endpoint: POST /webhook/marketing-actions
 * El backend descarga la imagen de portada desde Google Drive,
 * crea la propuesta y cambia el estado de la tarea a PENDING_TO_REVIEW.
 */
export async function syncMarketingActionDirect(
  taskUuid: string,
  articleUrl: string,
  contentType: ContentType,
  _apiKey: string,
): Promise<MarketingActionSyncResult> {
  const apiKey = _apiKey;
  const productType = CONTENT_TYPE_TO_PRODUCT[contentType];
  const titleKeyword = CONTENT_TYPE_TO_TITLE_KEYWORD[contentType];

  try {
    const res = await fetch(`${PRODLINE_BASE}/webhook/marketing-actions`, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        task_uuid: taskUuid,
        title: titleKeyword,
        product_type: productType,
        link_publicacion: articleUrl,
      }),
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok) {
      const detail = data.error ?? data.detail ?? text ?? res.statusText;
      return { success: false, error: `${res.status}: ${detail}` };
    }
    return { success: Boolean(data.success ?? true) };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
