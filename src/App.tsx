import React, { useState } from 'react';
import { AppStep } from './types';
import type { Article, Section, ContentType, ContentContext } from './types';
import { createProdlineProposal, assignProdlineTask, syncMarketingActionDirect } from './prodlineDeliverable';
import {
  generateArticleOutline,
  generateSectionContent,
  generateKeywords,
  generateImage,
  generateImageRaw,
  pickBestWordPressCategory,
  polishText,
  resolveLanguageProfile,
  generateGmbPost,
  buildGmbImagePromptFn,
  analyzeWebsite,
} from './geminiService';
import type { GmbPost } from './geminiService';
import { buildOnBlogImagePrompt } from './prompts/onBlogPrompt';
import { buildOffPageImagePrompt } from './prompts/offPagePrompt';

type CommunicationLanguage = 'spanish' | 'english';

const WP_CATEGORY_CATALOG: Record<string, string[]> = {
  'masproposals.com': [
    'SEO On page - Blog',
    'Uncategorized',
  ],
  'elinformedigital.com': [
    'Clother',
    'Arquitectura',
    'Arte, diseño y fotografía',
    'Bienestar y relajación',
    'Bodas y Relaciones de pareja',
    'Cocina, gastronomía y restauración',
    'Cosmética y Belleza',
    'Danza y Artes Escénicas',
    'Dating y Amor',
    'Decoración e interiorismo',
    'Deportes y recreación',
    'Economía',
    'Educación',
    'Entretenimiento',
    'Erotismo y sexualidad',
    'Gaming y Entretenimiento Digital',
    'Hogar',
    'Ingeniería y tecnología',
    'Inmobiliaria',
    'Innovación y Sostenibilidad',
    'Legal, asesorías y abogados',
    'Marketing y Publicidad',
    'Mascotas',
    'Maternidad y Bebés',
    'Moda e Imagen',
    'Motores',
    'Negocios y Emprendimiento',
    'Organización de eventos',
    'Productos especializados y alternativos',
    'Salud',
    'Turismo',
    'TV, cine y música',
    'Uncategorized',
  ],
  'cienciacronica.com': [
    'Marketing y Publicidad',
    'Arquitectura y construcción',
    'Arte, diseño y fotografía',
    'Bienestar y relajación',
    'Bodas y Relaciones de pareja',
    'Cannabis y GrowShop',
    'Clother',
    'Cocina, gastronomía y restauración',
    'Computers, Games',
    'Cosmética y Belleza',
    'Danza y Artes Escénicas',
    'Dating y Amor',
    'Decoración e interiorismo',
    'Deportes y Recreación',
    'Economía',
    'Educación',
    'Entretenimiento',
    'Erotismo y sexualidad',
    'Gaming y Entretenimiento Digital',
    'Hogar',
    'Ingeniería y tecnología',
    'Inmobiliaria',
    'Innovación y Sostenibilidad',
    'Legal, asesorías y abogados',
    'Mascotas',
    'Maternidad y Bebés',
    'Moda e Imagen',
    'Motores',
    'Negocios y Emprendimiento',
    'Salud',
    'Servicios',
    'Transportes',
    'Turismo y viajes',
    'TV, cine y música',
  ],
  'laprensa360.com': [
    'Uncategorized',
    'Arquitectura',
    'Arte, diseño y fotografía',
    'Bienestar y relajación',
    'Bodas y Relaciones de pareja',
    'Cannabis y GrowShop',
    'Clother',
    'Cocina, gastronomía y restauración',
    'Cosmética y Belleza',
    'Dating y Amor',
    'Decoración e interiorismo',
    'Deportes y recreación',
    'Economía',
    'Educación',
    'Entretenimiento',
    'Erotismo y sexualidad',
    'Hogar',
    'Ingeniería y tecnología',
    'Inmobiliaria',
    'Innovación y Sostenibilidad',
    'Legal, asesorías y abogados',
    'Marketing y Publicidad',
    'Mascotas',
    'Maternidad y Bebés',
    'Moda e Imagen',
    'Motores',
    'Negocios y Emprendimiento',
    'Salud',
    'Servicios',
    'Turismo',
    'TV, cine y música',
  ],
  'wall-trends.com': [
    'Sin categoría',
    'Architecture',
    'Art, Design & Photography',
    'Business & Entrepreneurship',
    'Clothing',
    'Cosmetics & Beauty',
    'Cuisine, Gastronomy & Restaurants',
    'Dating & Love',
    'Decoration & Interior Design',
    'Economy',
    'Education',
    'Engineering & Technology',
    'Entertainment',
    'Eroticism & Sexuality',
    'Fashion & Image',
    'GrowShop',
    'Health',
    'Home & Living',
    'Innovation & Sustainability',
    'Legal, Consulting & Law Firms',
    'Marketing & Advertising',
    'Motherhood & Babies',
    'Motors',
    'Pets',
    'Real Estate',
    'Sports & Recreation',
    'Tourism',
    'TV, Cinema & Music',
    'Weddings & Relationships',
    'Wellness & Relaxation',
  ],
};

// 📄 Fila de producción SEO desde CSV (formato clásico)
interface CsvRow {
  account_uuid: string;
  kw: string;  // Keywords separadas por comas
  task_count: number;  // Número de artículos a generar
  task_clickup_ids: string;  // IDs de ClickUp separados por comas
  task_prodline_ids?: string;  // IDs de Prodline separados por comas (opcional)
  content_type?: ContentType;  // Tipo de contenido opcional (on_blog | off_page | gmb); default on_blog
}

// 📄 Fila de producción SEO desde CSV (formato v2 — multi-tipo por cuenta)
interface CsvRowV2 {
  account_uuid: string;
  kw: string;                // Keywords separadas por comas
  count_onblog: number;      // Artículos SEO on-blog a generar
  count_offpa: number;       // Artículos SEO off-page a generar
  count_postnoticias: number; // Posts GMB a generar
  task_uuid_onblog: string;      // UUIDs Prodline para on-blog (comma-separated)
  task_uuid_offpage: string;     // UUIDs Prodline para off-page (comma-separated)
  task_uuid_postnoticias: string; // UUIDs Prodline para GMB (comma-separated)
}

// 🔧 Normaliza cualquier imagen base64 a 1536×864 usando canvas
const resizeImageTo1536x864 = (base64Image: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1536;
      canvas.height = 864;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo obtener contexto canvas"));
        return;
      }

      const imgRatio = img.width / img.height;
      const targetRatio = 1536 / 864;

      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;

      if (imgRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1536, 864);

      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };

    img.onerror = () =>
      reject(new Error("No se pudo cargar la imagen para redimensionar"));

    img.src = base64Image;
  });
};

// 🔧 Normaliza imagen GMB a 1200×900 (4:3) usando canvas
const resizeImageTo1200x900 = (base64Image: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 900;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo obtener contexto canvas"));
        return;
      }

      const imgRatio = img.width / img.height;
      const targetRatio = 1200 / 900; // 4:3

      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 1200, 900);
      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };

    img.onerror = () =>
      reject(new Error("No se pudo cargar la imagen GMB para redimensionar"));

    img.src = base64Image;
  });
};

// Converts a title string to sentence case for any language.
// Handles leading punctuation (e.g. "¿que" -> "¿Que") and preserves acronyms/proper nouns.
const toSentenceCase = (title: string): string => {
  if (!title) return title;
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) return normalized;

  const capitalizeFirstAlphabetic = (text: string): string => {
    return text.replace(/^([^A-Za-zÀ-ÖØ-öø-ÿÑñ]*)([A-Za-zÀ-ÖØ-öø-ÿÑñ])(.*)$/u, (_m, prefix, first, rest) => {
      return `${prefix}${first.toUpperCase()}${rest.toLowerCase()}`;
    });
  };

  const isAcronym = (word: string): boolean => {
    const plain = word.replace(/[^A-Za-z0-9]/g, '');
    return plain.length > 1 && plain === plain.toUpperCase() && /[A-Z]/.test(plain);
  };

  const looksLikeProperNoun = (word: string): boolean => {
    if (!word) return false;
    // Keep mixed-case brands and already-capitalized proper nouns.
    return /[A-Z].*[a-z]/.test(word) && /^[A-ZÁÉÍÓÚÑ]/.test(word);
  };

  const words = normalized.split(' ');
  return words
    .map((word, index) => {
      if (index === 0) return capitalizeFirstAlphabetic(word);
      if (isAcronym(word) || looksLikeProperNoun(word)) return word;
      return word.toLowerCase();
    })
    .join(' ');
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Normaliza variantes del nombre comercial en el texto asegurando que
// se use exactamente la forma proporcionada en `businessName`.
// NO sustituye por términos alternativos como "la agencia"; preserva
// el nombre tal cual aparece en el brief.
// Trunca un texto en el último espacio antes del límite para no cortar palabras.
// Trunca texto de forma inteligente: nunca corta palabras, nunca deja conjunciones/preposiciones al final.
const smartTruncate = (text: string, max: number): string => {
  if (!text) return text;
  if (text.length <= max) return text;

  let result = text.substring(0, max);

  // 1. Retroceder hasta el último espacio para no cortar palabras
  const lastSpace = result.lastIndexOf(' ');
  if (lastSpace > max * 0.5) result = result.substring(0, lastSpace);

  // 2. Eliminar palabras finales que sean conjunciones, preposiciones o artículos
  const dangling = /\s+(y|e|o|u|ni|pero|sino|aunque|que|de|del|con|en|a|al|por|para|sin|sobre|ante|bajo|como|si|más|su|sus|un|una|unos|unas|las|los|la|le|lo|se|es|ha|han|era|fue|ser|está|están|muy|bien|mal|ya|no|también|cuando|donde|quien|cual|cuya|cuyo|tanto|tan|así|aun|aún|incluso|además|pues|luego|entonces)$/i;
  while (dangling.test(result)) {
    result = result.replace(dangling, '').trimEnd();
  }

  // 3. Si termina en coma, quitarla
  result = result.replace(/[,;:]\s*$/, '').trimEnd();

  // 4. Si no termina en punto/exclamación/interrogación, agregar punto
  if (!/[.!?]$/.test(result)) result = result + '.';

  return result;
};

const removeExtraBusinessNames = (text: string, businessName: string): string => {
  if (!businessName) return text;
  const esc = escapeRegExp(businessName);
  // Reemplazar variantes (espacios/espacios extras/pegar palabras) por la forma exacta
  const parts = businessName.trim().split(/\s+/).map(escapeRegExp);
  const pattern = parts.join("\\s*");
  return text.replace(new RegExp(pattern, 'gi'), businessName);
};

// normaliza variantes del nombre comercial (espacios opcionales)
// y se asegura de que no esté pegado a la palabra siguiente
const normalizeBusinessNameInText = (text: string, businessName: string): string => {
  if (!businessName) return text;
  const parts = businessName.trim().split(/\s+/).map(escapeRegExp);
  const pattern = parts.join("\\s*");
  let result = text.replace(new RegExp(pattern, 'gi'), businessName);
  // si hay nombre seguido inmediatamente por otra palabra sin espacio,
  // insertamos un espacio
  result = result.replace(new RegExp(escapeRegExp(businessName) + '(?=\\S)', 'g'), `${businessName} `);
  // eliminar sufijos pegados (ej: NombreABC) asegurando la forma exacta
  const esc = escapeRegExp(businessName);
  result = result.replace(new RegExp('\\b' + esc + '(?=\\w)', 'gi'), businessName);
  return result;
};

/**
 * Aplica un regex de reemplazo SOLO sobre nodos de texto del HTML,
 * nunca dentro de etiquetas ni atributos (href, src, class, etc.).
 * Esto evita corromper URLs en href cuando el texto a reemplazar
 * aparece dentro de una ruta o dominio.
 */
const replaceInTextNodesOnly = (html: string, regex: RegExp, replacement: string): string => {
  return html.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, textNode) => {
    if (tag) return tag; // preservar etiquetas intactas
    if (textNode) return textNode.replace(regex, replacement);
    return match;
  });
};

const stripBusinessNameMentions = (text: string, businessName?: string | null): string => {
  if (!text || !businessName) return text;
  const parts = businessName.trim().split(/\s+/).map(escapeRegExp);
  if (parts.length === 0) return text;
  const pattern = parts.join("\\s*");
  const regex = new RegExp(pattern, 'gi');
  // Reemplazar SOLO en texto visible — nunca dentro de atributos HTML (href, src, etc.)
  return replaceInTextNodesOnly(text, regex, 'la empresa').trim();
};

// Divide un párrafo HTML en varios <p> con un máximo de `maxSentences` oraciones
// por párrafo. Intenta respetar el HTML interno conservando las etiquetas.
const splitParagraphByMaxSentences = (pTag: string, maxSentences = 5): string => {
  const innerMatch = pTag.match(/^<p>([\s\S]*?)<\/p>$/i);
  if (!innerMatch) return pTag;
  const inner = innerMatch[1].trim();

  // Split por puntos, signos de interrogación o exclamación conservando los separadores
  const parts: string[] = [];
  const re = /([\s\S]*?[\.\?\!]+)(\s+|$)/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(inner)) !== null) {
    parts.push(m[1].trim());
    lastIndex = re.lastIndex;
  }
  // Si quedó texto sin terminar (sin punto final), lo añadimos
  if (lastIndex < inner.length) {
    const rest = inner.slice(lastIndex).trim();
    if (rest.length) parts.push(rest);
  }

  if (parts.length === 0) return pTag;

  const groups: string[] = [];
  for (let i = 0; i < parts.length; i += maxSentences) {
    groups.push(parts.slice(i, i + maxSentences).join(' '));
  }

  return groups.map(g => `<p>${g.trim()}</p>`).join('\n');
};

// Divide un párrafo HTML usando saltos de línea internos como criterio de separación.
// Si un <p> contiene más de `maxLines` líneas (contadas por '\n'), lo divide en
// varias etiquetas <p> consecutivas. Conserva el HTML dentro de cada línea.
const splitParagraphByMaxLines = (pTag: string, maxLines = 5): string => {
  const innerMatch = pTag.match(/^<p>([\s\S]*?)<\/p>$/i);
  if (!innerMatch) return pTag;
  const inner = innerMatch[1];
  const lines = inner.split(/\r?\n/);
  if (lines.length <= maxLines) return pTag;

  const groups: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    groups.push(lines.slice(i, i + maxLines).join('\n'));
  }
  return groups.map(g => `<p>${g}</p>`).join('\n');
};

// Divide un párrafo si sobrepasa cierto número de palabras (aprox. 5 líneas).
const splitParagraphByMaxWords = (pTag: string, maxWords = 75): string => {
  const innerMatch = pTag.match(/^<p>([\s\S]*?)<\/p>$/i);
  if (!innerMatch) return pTag;
  const inner = innerMatch[1].trim();
  const words = inner.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return pTag;
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    groups.push(words.slice(i, i + maxWords).join(' '));
  }
  return groups.map(g => `<p>${g}</p>`).join('\n');
};

// Aplica normas de longitud sobre cada párrafo HTML.
// Un párrafo de 5 líneas en WordPress ≈ 60 palabras (12 palabras/línea × 5).
// Los bloques <ul> se conservan intactos.
const enforceParagraphLength = (html: string): string => {
  // Separar el HTML en bloques: <p>...</p> y <ul>...</ul>
  const blockRegex = /(<ul>[\s\S]*?<\/ul>)|(<p>[\s\S]*?<\/p>)/gi;
  return html.replace(blockRegex, (block) => {
    // No tocar listas
    if (/^<ul>/i.test(block)) return block;
    // Solo dividir párrafos largos
    return splitParagraphByMaxWords(block, 60);
  });
};

// Limita el uso de <strong> dentro de cada párrafo <p>.
// Los bloques <ul> (viñetas) se conservan INTACTOS — las negritas en viñetas son obligatorias.
const limitStrongUsagePerParagraph = (html: string, maxStrongPerPara = 2): string => {
  return html.replace(/(<ul>[\s\S]*?<\/ul>)|(<p>[\s\S]*?<\/p>)/gi, (block) => {
    // No tocar listas: las negritas en <li> son mandatorias
    if (/^<ul>/i.test(block)) return block;
    const strongMatches = block.match(/<strong>[\s\S]*?<\/strong>/gi) || [];
    if (strongMatches.length <= maxStrongPerPara) return block;
    let kept = 0;
    return block.replace(/<strong>([\s\S]*?)<\/strong>/gi, (m, inner) => {
      kept++;
      if (kept <= maxStrongPerPara) return `<strong>${inner}</strong>`;
      return inner;
    });
  });
};

// Convierte listas estilo markdown (* item o - item) en HTML <ul><li>.
// Además convierte **texto** a <strong>texto</strong> dentro de cada item.
const normalizeBulletLists = (html: string): string => {
  const lines = html.split(/\r?\n/);
  let inList = false;
  let result = '';
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^([-\*])\s+/.test(trimmed)) {
      // Convertir **texto** → <strong>texto</strong> dentro del item
      let content = trimmed.replace(/^([-\*])\s+/, '');
      content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (!inList) {
        inList = true;
        result += '<ul>';
      }
      result += `<li>${content}</li>`;
    } else {
      if (inList) {
        result += '</ul>';
        inList = false;
      }
      result += line;
    }
    result += '\n';
  });
  if (inList) result += '</ul>';
  return result;
};

const normalizeWebsiteUrl = (candidate: string | null | undefined): string | null => {
  if (!candidate) return null;
  const clean = candidate
    .trim()
    .replace(/[\]\[(){}<>"'`]/g, '')
    .replace(/[.,;:]+$/g, '');
  if (!clean) return null;

  const baseCandidate = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  try {
    const parsed = new URL(baseCandidate);
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    const host = parsed.hostname.toLowerCase();
    // Filtrar dominios que NO son webs de clientes
    const blockedDomains = /clickup\.com$|google\.com$|googleapis\.com$|googletagmanager\.com$|gmail\.com$|googlemail\.com$|facebook\.com$|instagram\.com$|linkedin\.com$|youtube\.com$|x\.com$|twitter\.com$|orbidi\.com$|cloudfront\.net$|amazonaws\.com$|s3\.amazonaws\.com$|herokuapp\.com$|hotmail\.com$|outlook\.com$|yahoo\.com$|yahoo\.es$|live\.com$|msn\.com$|aol\.com$|icloud\.com$|protonmail\.com$|zoho\.com$|tiktok\.com$|pinterest\.com$|whatsapp\.com$|telegram\.org$|wa\.me$|bit\.ly$|goo\.gl$|tinyurl\.com$|mailchimp\.com$|hubspot\.com$|calendly\.com$|canva\.com$|figma\.com$|notion\.so$|slack\.com$|trello\.com$|asana\.com$|stripe\.com$|paypal\.com$|apple\.com$|microsoft\.com$|amazon\.com$|wikipedia\.org$|vimeo\.com$|spotify\.com$|threads\.net$|wp\.com$|wordpress\.com$|wpengine\.com$|typeform\.com$|airtable\.com$|zapier\.com$|make\.com$|intercom\.io$|zendesk\.com$|freshdesk\.com$|salesforce\.com$|adobe\.com$|wix\.com$|squarespace\.com$|webflow\.io$|netlify\.app$|vercel\.app$|github\.com$|gitlab\.com$|jsdelivr\.net$|cdnjs\.cloudflare\.com$|cloudflare\.com$/i;
    if (blockedDomains.test(host)) {
      return null;
    }
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const extractFirstWebsiteFromText = (text: string): string | null => {
  if (!text) return null;
  // Paso 1: URLs con protocolo o www.
  const urlRegex = /(https?:\/\/[^\s"'<>]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[\w\-./%]*)?)/gi;
  const matches = text.match(urlRegex) || [];
  for (const raw of matches) {
    const idx = text.indexOf(raw);
    if (idx > 0 && text[idx - 1] === '@') continue;
    const normalized = normalizeWebsiteUrl(raw);
    if (normalized) return normalized;
  }
  // Paso 2: Dominios sueltos sin protocolo ni www (ej: "centroexpresarte.com")
  // Solo dentro de contexto de website (no se usa en escaneo global)
  const bareDomainRegex = /\b([a-z0-9][\w-]+\.(?:com|es|net|org|eu|cat|info|biz|co|me|io|dev|pro|site|online|store|shop|agency|studio|design|art|health|clinic|center|dental|consulting|legal|tech|cloud|app|work|space|page|blog|web|xyz)(?:\.[a-z]{2,3})?)\b/gi;
  const domainMatches = text.match(bareDomainRegex) || [];
  for (const raw of domainMatches) {
    const idx = text.indexOf(raw);
    if (idx > 0 && text[idx - 1] === '@') continue;
    const normalized = normalizeWebsiteUrl(raw);
    if (normalized) return normalized;
  }
  return null;
};

/**
 * Extrae la web del cliente desde un campo de texto libre (como `body` del JSON de Orbidi).
 * Busca primero en el contexto de la sección "¿Tienes página web?" y luego en todo el texto.
 */
const extractWebsiteFromBodyText = (text: string): string | null => {
  if (!text) return null;

  // Si el brief contiene "¿Tienes página web?" pero NO "Tengo página web",
  // el cliente no tiene web — retornar null inmediatamente sin seguir buscando.
  const hasPaginaWebQuestion = /[¿?]?\s*Tienes\s+p[áa]gina\s+web/i.test(text);
  const hasTengoPaginaWeb = /Tengo\s+p[áa]gina\s+web/i.test(text);

  if (hasPaginaWebQuestion && !hasTengoPaginaWeb) {
    // El cliente respondió que NO tiene web (campo vacío o "No tengo página web")
    return null;
  }

  // Estrategia A: línea a línea después de "Tengo página web"
  // El brief de Plinng/Orbidi tiene el formato:
  //   ¿Tienes página web?\n  Tengo página web\n  famlingerie.com\n
  if (hasTengoPaginaWeb) {
    const lines = text.split('\n');
    let inWebSection = false;
    for (const line of lines) {
      const t = line.trim();
      if (/Tengo\s+p[áa]gina\s+web/i.test(t)) {
        inWebSection = true;
        continue;
      }
      if (inWebSection) {
        // Salir SOLO si llegamos a una nueva sección — ignorar líneas vacías
        if (/^(?:Añade|Agrega|Redes\s+sociales|¿|Analicemos|Exploremos|Hablemos|Construyamos|¡Gracias)/i.test(t)) break;
        // Saltar líneas vacías — la web puede estar separada por línea en blanco
        if (!t) continue;
        // Este es el candidato — puede ser dominio suelto, www o URL completa
        const found = normalizeWebsiteUrl(t) || extractFirstWebsiteFromText(t);
        if (found) return found;
        // Si la línea tiene texto pero no es URL válida, seguir buscando
      }
    }

    // Estrategia B: bloque completo después de "Tengo página web"
    const webSectionRegex = /Tengo\s+p[áa]gina\s+web([\s\S]{0,400}?)(?=\nA[ñn]ade|\nRedes|\nAgrega|\n¡Gracias|$)/i;
    const sectionMatch = text.match(webSectionRegex);
    if (sectionMatch?.[1]) {
      const found = extractFirstWebsiteFromText(sectionMatch[1]);
      if (found) return found;
    }
  }

  // Estrategia C: solo si NO hay pregunta de "¿Tienes página web?" en el texto
  // (evita falsos positivos en briefs que sí tienen la pregunta pero sin respuesta)
  if (!hasPaginaWebQuestion) {
    const labelLineRegex = /(?:p[áa]gina\s*web|sitio\s*web|website|tu\s*web)\s*[:\n]\s*([^\n]{3,100})/gi;
    for (const m of [...text.matchAll(labelLineRegex)]) {
      const candidate = (m[1] || '').trim();
      const found = normalizeWebsiteUrl(candidate) || extractFirstWebsiteFromText(candidate);
      if (found) return found;
    }
  }

  return null;
};

// 🌐 Extrae la web del cliente desde HTML con varias estrategias de fallback.
const extractWebsiteFromBriefHTML = (html: string): string | null => {
  if (!html) return null;

  // Normalizar entidades HTML comunes antes de buscar
  const normalized = html
    .replace(/&iquest;/gi, '¿')
    .replace(/&aacute;/gi, 'á')
    .replace(/&nbsp;/g, ' ');

  // 0) Estrategia prioritaria: buscar FIELD_WEBSITE_URL en comentarios HTML del brief Orbidi
  //    Formato: <!-- {'id': 'FIELD_WEBSITE_URL', ..., 'value': 'https://www.example.com'} -->
  const fieldComment = normalized.match(/FIELD_WEBSITE_URL[\s\S]*?['"]value['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (fieldComment?.[1]) {
    const fromField = normalizeWebsiteUrl(fieldComment[1]);
    if (fromField) {
      console.log('[extractWebsiteFromBriefHTML] URL from FIELD_WEBSITE_URL:', fromField);
      return fromField;
    }
  }

  // 1) Bloque "¿Tienes página web?" — esta sección es la fuente de verdad.
  //    Si existe la pregunta pero NO "Tengo página web" → cliente sin web, parar todo.
  const sectionMatch = normalized.match(/[¿?]?Tienes\s+p[áa]gina\s+web\??([\s\S]{0,3000}?)(?=<h[1-6]\b|<\/form|<\/section|<\/article|$)/i);
  if (sectionMatch) {
    const block = sectionMatch[1].replace(/<[^>]+>/g, '\n');
    console.log('[extractWebsiteFromBriefHTML] Bloque "¿Tienes página web?":', block.trim().slice(0, 300));
    if (!/Tengo\s+p[áa]gina\s+web/i.test(block)) {
      // Campo vacío o sin respuesta → definitivamente no tiene web
      console.log('[extractWebsiteFromBriefHTML] Campo vacío — cliente sin web');
      return null;
    }
    // Tiene web — extraer el dominio del bloque
    const fromBodyText = extractWebsiteFromBodyText(block);
    if (fromBodyText) return fromBodyText;
    const fromSection = extractFirstWebsiteFromText(block);
    if (fromSection) return fromSection;
    // Si llegamos aquí, tiene "Tengo página web" pero no pudimos extraer el dominio
    // No caer a estrategias generales que pueden inventar URLs
    return null;
  }

  // Si el brief NO tiene la pregunta "¿Tienes página web?" (formato diferente),
  // intentar con estrategias más conservadoras solo con contexto explícito de web.

  // 2) Bloque <p> dentro de label de website/sitio/url
  const labelBlocks = [...normalized.matchAll(/(?:website|sitio\s*web|p[áa]gina\s*web|url\s*del\s*sitio)[\s\S]{0,400}?<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const block of labelBlocks) {
    const found = extractFirstWebsiteFromText((block[1] || '').replace(/<[^>]+>/g, ' '));
    if (found) return found;
  }

  // 3) href en enlaces visibles — SOLO si aparece junto a palabras clave de "web del cliente"
  const websiteContextBlocks = [...normalized.matchAll(
    /(?:p[áa]gina\s*web|sitio\s*web|website|web\s*del\s*cliente|tu\s*web|su\s*web|url\s*del?\s*(?:negocio|empresa|cliente)?|direcci[oó]n\s*web)[^<]{0,300}href\s*=\s*["']([^"']+)["']|href\s*=\s*["']([^"']+)["'][^<]{0,300}(?:p[áa]gina\s*web|sitio\s*web|website)/gi
  )];
  for (const m of websiteContextBlocks) {
    const candidate = m[1] || m[2];
    if (!candidate || /^mailto:/i.test(candidate)) continue;
    const found = normalizeWebsiteUrl(candidate);
    if (found) return found;
  }

  // ⛔ NO hay estrategia 4 de href genérico — genera demasiados falsos positivos
  return null;
};

/**
 * Extrae la web del cliente desde un campo de texto libre (como `body` del JSON de Orbidi).
 * Busca primero en el contexto de la sección "¿Tienes página web?" y luego en todo el texto.
 */

const extractWebsiteFromStructuredData = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const websiteKeys = [
    'website', 'web', 'sitio_web', 'sitio web', 'pagina_web', 'pagina web',
    'url', 'url_web', 'url sitio', 'domain', 'dominio', 'client_website'
  ];
  const websiteKeySet = new Set(websiteKeys.map(k => k.toLowerCase()));

  // Campos de texto libre que pueden contener el brief completo
  const textBodyKeys = new Set(['body', 'content', 'contenido', 'text', 'texto', 'description', 'descripcion', 'brief', 'data']);

  const queue: unknown[] = [data];
  const textBodyCandidates: string[] = []; // Guardar campos de texto libre para búsqueda posterior

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      const keyLc = key.toLowerCase().trim();
      if (typeof value === 'string') {
        if (websiteKeySet.has(keyLc)) {
          const byKey = normalizeWebsiteUrl(value) || extractFirstWebsiteFromText(value);
          if (byKey) return byKey;
        }
        // Guardar campos de texto libre para búsqueda después de recorrer claves específicas
        if (textBodyKeys.has(keyLc) && value.length > 50) {
          textBodyCandidates.push(value);
        }
      } else if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  // Fallback: buscar en campos de texto libre (body, content, etc.)
  // extractWebsiteFromBodyText maneja correctamente todos los casos:
  // - "Tengo página web" + dominio → devuelve el dominio
  // - "¿Tienes página web?" sin respuesta → devuelve null (no inventa)
  // - Sin campo de web → devuelve null
  for (const bodyText of textBodyCandidates) {
    const found = extractWebsiteFromBodyText(bodyText);
    if (found) return found;
  }

  return null;
};

// Extrae el valor de un campo del brief HTML usando su label visible.
const extractFieldValueFromBriefHTML = (html: string, label: string): string | null => {
  const labelEscaped = escapeRegExp(label);
  const re = new RegExp(`${labelEscaped}[\\s\\S]{0,240}?<p[^>]*>\\s*([^<]+?)\\s*<\\/p>`, 'i');
  const m = html.match(re);
  return m?.[1]?.trim() || null;
};

const normalizeCommunicationLanguage = (raw: string | null | undefined): CommunicationLanguage | null => {
  if (!raw) return null;
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!normalized) return null;
  if (['english', 'ingles', 'inglés', 'en'].includes(normalized)) return 'english';
  // Regla de negocio: todo idioma distinto de inglés se trata como español.
  return 'spanish';
};

const formatLanguageLabel = (lang: CommunicationLanguage): string => {
  const l = (lang || '').toLowerCase();
  if (l === 'english') return 'Inglés';
  return 'Español';
};

const isEnglishLanguage = (lang: CommunicationLanguage): boolean => {
  const l = (lang || '').toLowerCase();
  return l === 'english' || l === 'en';
};

const extractCommunicationLanguageFromBriefHTML = (html: string): CommunicationLanguage | null => {
  // 1) Prioridad máxima: comentario estructurado FIELD_COMMUNICATION_LANGUAGE.
  // En ese bloque suelen aparecer values de opciones y, al final, el value seleccionado.
  const commentBlockMatch = html.match(/<!--([\s\S]*?FIELD_COMMUNICATION_LANGUAGE[\s\S]*?)-->/i);
  if (commentBlockMatch?.[1]) {
    const valueMatches = [...commentBlockMatch[1].matchAll(/['"\u2018\u2019\u201C\u201D]value['"\u2018\u2019\u201C\u201D]\s*:\s*['"\u2018\u2019\u201C\u201D]([^'"\u2018\u2019\u201C\u201D\n]+)/gi)];
    if (valueMatches.length > 0) {
      const lastValue = valueMatches[valueMatches.length - 1]?.[1];
      const fromComment = normalizeCommunicationLanguage(lastValue);
      if (fromComment) return fromComment;
    }
  }

  // 2) Fallback: leer valores <p> del bloque de pregunta de idioma.
  const questionBlockMatch = html.match(/¿En qué idioma te quieres comunicar con tus clientes\?[\s\S]{0,2000}/i);
  if (questionBlockMatch?.[0]) {
    const langsInBlock = [...questionBlockMatch[0].matchAll(/<p[^>]*>\s*([^<]+?)\s*<\/p>/gi)]
      .map(m => normalizeCommunicationLanguage(m[1]))
      .filter((v): v is CommunicationLanguage => Boolean(v));
    const unique = [...new Set(langsInBlock)];
    if (unique.length === 1) return unique[0];
  }

  return null;
};

const extractCommunicationLanguageFromText = (text: string): CommunicationLanguage | null => {
  if (!text) return null;
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Prioridad máxima: bloque estructurado del campo de idioma con value seleccionado al final.
  const communicationFieldBlock = normalized.match(/field_communication_language[\s\S]{0,3000}/i)?.[0];
  if (communicationFieldBlock) {
    const valueMatches = [...communicationFieldBlock.matchAll(/value\s*[:=]\s*['"]?([a-z_\-]+)['"]?/gi)];
    if (valueMatches.length > 0) {
      const lastValue = valueMatches[valueMatches.length - 1]?.[1];
      const selected = normalizeCommunicationLanguage(lastValue);
      if (selected) return selected;
    }
  }

  // Prioridad 1: valor explícito de selección (evita confundir opciones visibles con valor elegido)
  const explicitValueMatches = [...normalized.matchAll(/(?:communication_language|idioma|language)[\s\S]{0,220}?(?:selected|seleccionado|choice|option|value)\s*[:=]\s*['"]?([a-z_\-]+)['"]?/gi)];
  if (explicitValueMatches.length > 0) {
    const lastExplicit = explicitValueMatches[explicitValueMatches.length - 1]?.[1];
    const explicitLang = normalizeCommunicationLanguage(lastExplicit);
    if (explicitLang) return explicitLang;
  }

  // Prioridad 2: patrón "idioma/language ... <idioma>"
  const explicitInlineMatch = normalized.match(/(?:idioma|language|idioma de comunicacion)[\s\S]{0,160}?(english|ingles|spanish|espanol|frances|french|portugues|portuguese|aleman|german|italiano|italian|catalan)/i);
  const inlineLang = normalizeCommunicationLanguage(explicitInlineMatch?.[1]);
  if (inlineLang) return inlineLang;

  // Prioridad 3: inferencia SOLO si aparece un único idioma; si aparecen varios, devolver null.
  const detected: CommunicationLanguage[] = [];
  if (/(\bingles\b|\benglish\b)/i.test(normalized)) detected.push('english');
  if (/(\bespanol\b|\bspanish\b|\bcastellano\b)/i.test(normalized)) detected.push('spanish');
  // Si menciona otros idiomas, se mapea a español por política de proyecto.
  if (/(\bfrances\b|\bfrench\b|\bportugues\b|\bportuguese\b|\baleman\b|\bgerman\b|\bdeutsch\b|\bitaliano\b|\bitalian\b|\bcatalan\b)/i.test(normalized)) {
    detected.push('spanish');
  }

  const unique = [...new Set(detected)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return null;

  return null;
};

/**
 * Genera 3 enlaces internos estándar del dominio del cliente
 * Estructura universal: home, blog, contacto
 */
const generateClientInternalLinks = (domain: string): string[] => {
  const normalized = normalizeWebsiteUrl(domain);
  if (!normalized) {
    console.warn('[generateClientInternalLinks] Dominio inválido, no se generan enlaces:', domain);
    return [];
  }
  const base = normalized.replace(/\/$/, "");
  const isEnglishDomain = /wall-trends\.com$/i.test(base);

  // Rutas reales del dominio del cliente (sin hash para evitar redirigir a inicio)
  return isEnglishDomain
    ? [`${base}/`, `${base}/blog/`, `${base}/contact/`]
    : [`${base}/`, `${base}/blog/`, `${base}/contacto/`];
};

/**
 * Envuelve con un enlace una frase relevante que YA EXISTE en el párrafo.
 * Estrategia: buscar sustantivos clave del anchorText en el texto del párrafo;
 * si no coincide, enlazar las últimas palabras significativas antes del punto.
 */
const insertLinkAtEndOfParagraph = (
  pTag: string,
  href: string,
  anchorText: string
): string => {
  const innerMatch = pTag.match(/^<p>([\s\S]*?)<\/p>$/);
  if (!innerMatch) return pTag;
  const inner = innerMatch[1];

  // Si ya tiene enlace, no tocar
  if (inner.includes('<a ')) return pTag;

  // Texto plano del párrafo para búsqueda
  const plain = inner.replace(/<[^>]+>/g, '');

  // Palabras de búsqueda según el tipo de anchorText
  // "servicios" → busca: servicios, servicio, soluciones, oferta, productos
  // "blog"      → busca: información, artículo, guía, recursos, contenido
  // "contacto"  → busca: consulta, asesor, contactar, solicitar, experto, especialista
  const searchMap: Record<string, string[]> = {
    servicios: ['servicios', 'servicio', 'soluciones', 'solución', 'oferta', 'productos', 'opciones'],
    blog:      ['información', 'artículo', 'guía', 'recursos', 'contenido', 'conocer', 'saber'],
    contacto:  ['consulta', 'asesor', 'asesoría', 'contactar', 'solicitar', 'experto', 'especialista', 'profesional'],
  };

  const searchWords = searchMap[anchorText.toLowerCase()] || [anchorText];

  // Buscar la primera coincidencia en el texto
  for (const word of searchWords) {
    const regex = new RegExp(`\b(${word}(?:es|s|a|as)?)\b`, 'i');
    const match = plain.match(regex);
    if (match && match[1]) {
      const found = match[1];
      // Envolver la primera ocurrencia en el HTML preservando etiquetas
      const escaped = found.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Solo reemplazar si no está ya dentro de una etiqueta
      const linkified = inner.replace(
        new RegExp(`(?<![=>\w])${escaped}(?![\w<])`, 'i'),
        `<a href="${href}" target="_blank" rel="noopener noreferrer">${found}</a>`
      );
      if (linkified !== inner) {
        return `<p>${linkified}</p>`;
      }
    }
  }

  // Fallback garantizado: insertar enlace al final del párrafo siempre
  {
    const withoutEnd = inner.replace(/([.!?]\s*)$/, '');
    const endMark = inner.match(/([.!?]\s*)$/)?.[1] || '.';
    // Tomar las últimas 3 palabras significativas como anchor text
    const plainWords = plain.replace(/[.!?]+$/, '').trim().split(/\s+/).filter(w => w.length > 2);
    const anchorWords = plainWords.slice(-3).join(' ');
    if (anchorWords) {
      const escaped = anchorWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const linked = `<a href="${href}" target="_blank" rel="noopener noreferrer">${anchorWords}</a>`;
      const replaced = withoutEnd.replace(new RegExp(escaped + '$', 'i'), linked);
      if (replaced !== withoutEnd) return `<p>${replaced}${endMark}</p>`;
      // Si no coincide exacto, append directo al final
      return `<p>${withoutEnd} ${linked}${endMark}</p>`;
    }
  }

  // Último recurso: append del enlace al final del párrafo sin modificar el texto
  return `<p>${inner.replace(/([.!?]\s*)$/, '')} <a href="${href}" target="_blank" rel="noopener noreferrer">${anchorText}</a>.</p>`;
};



const insertInternalLinksIntoSections = (
  sections: Section[],
  links: string[]
): Section[] => {
  if (!links.length || links.length < 3) {
    console.warn("⚠️ Se requieren al menos 3 enlaces internos");
    return sections;
  }

  const linksToInsert = links.slice(0, 3);
  let insertedCount = 0;

  // Anchor texts semánticos por tipo de página destino
  // Se usan para buscar coincidencias en el texto del párrafo
  const anchorTexts = [
    "servicios",          // home → busca "servicios" en el párrafo
    "blog",               // blog → busca "blog" o cualquier tema relacionado
    "contacto"            // contacto → busca palabras de acción: "consulta", "asesor", "contacto"
  ];

  const updatedSections = sections.map((section, sectionIndex) => {
    if (insertedCount >= 3 || !section.content) return section;

    // Buscar todos los párrafos <p>...</p> que NO tengan ya un enlace
    const paragraphRegex = /<p>(?:(?!<a\s).)*?<\/p>/g;
    const paragraphMatches = section.content.match(paragraphRegex);
    if (!paragraphMatches || paragraphMatches.length === 0) return section;

    for (const p of paragraphMatches) {
      if (p.includes('<a href=')) continue; // saltar si ya tiene enlace
      
      const textOnly = p.replace(/<[^>]+>/g, '').trim();
      const wordCount = textOnly.split(/\s+/).filter(w => w.length > 0).length;

      // Solo insertar en párrafos con al menos 8 palabras de texto
      if (wordCount >= 8) {
        const anchorText = anchorTexts[insertedCount];
        const href = linksToInsert[insertedCount];
        const newParagraph = insertLinkAtEndOfParagraph(p, href, anchorText);

        section.content = section.content.replace(p, newParagraph);
        insertedCount++;
        console.log(`[Enlaces] ✓ Enlace ${insertedCount}/3 en sección ${sectionIndex} | anchor: "${anchorText}"`);
        break;
      }
    }

    return section;
  });

  // Pasada de rescate: si quedan enlaces sin insertar, forzar en cualquier <p>
  if (insertedCount < 3) {
    console.log(`[Enlaces] Pasada rescate: ${insertedCount}/3 insertados. Forzando en cualquier párrafo disponible...`);
    for (const section of updatedSections) {
      if (insertedCount >= 3 || !section.content) continue;
      const paragraphRegex = /<p>[\s\S]*?<\/p>/g;
      const matches = section.content.match(paragraphRegex);
      if (!matches) continue;
      for (const p of matches) {
        if (p.includes('<a href=')) continue;
        const anchorText = anchorTexts[insertedCount];
        const href = linksToInsert[insertedCount];
        // Forzar inserción — el nuevo fallback siempre inserta
        const newParagraph = insertLinkAtEndOfParagraph(p, href, anchorText);
        // Verificar que realmente se insertó un enlace
        if (newParagraph.includes('<a href=')) {
          section.content = section.content.replace(p, newParagraph);
          insertedCount++;
          console.log(`[Enlaces] ✓ Enlace rescate ${insertedCount}/3`);
        } else {
          // Último recurso absoluto: inyectar enlace invisible al final de la sección
          const fallbackLink = `<p><a href="${href}" target="_blank" rel="noopener noreferrer">${anchorText}</a></p>`;
          section.content = section.content + fallbackLink;
          insertedCount++;
          console.log(`[Enlaces] ✓ Enlace inyectado al final de sección ${insertedCount}/3`);
        }
        if (insertedCount >= 3) break;
      }
    }
  }

  console.log(`[Enlaces] RESULTADO FINAL: ${insertedCount} de 3 enlaces`);
  return updatedSections;
};

// 📖 Mejora automática de legibilidad (Readability Boost)
// Objetivo: Flesch-Kincaid > 60 (OK to Easy)
// ⚠️  Opera SOLO sobre texto plano dentro de cada etiqueta HTML.
//     Nunca destruye etiquetas <strong>, <a>, <ul>, <li> ni parte frases por la mitad.
const improveReadability = (html: string, lang: string = 'spanish'): string => {
  if (!html) return html;

  let improved = html;
  const isSpanish = (lang || 'spanish').toLowerCase() === 'spanish';

  if (isSpanish) {
    // 1️⃣ Simplifica conectores complejos — solo en texto visible (fuera de etiquetas)
    const complexConnectors: [string, string][] = [
      ['debido a que', 'porque'],
      ['a pesar de que', 'aunque'],
      ['con el fin de', 'para'],
      ['en el caso de que', 'si'],
      ['de tal manera que', 'así'],
      ['a través de', 'por'],
      ['no obstante,', 'sin embargo,'],
      ['en consecuencia,', 'por eso,'],
      ['por lo tanto,', 'por eso,'],
      ['cabe destacar que', ''],
      ['cabe mencionar que', ''],
      ['es importante destacar que', ''],
      ['es fundamental mencionar que', ''],
      ['hay que tener en cuenta que', ''],
      ['en este sentido,', ''],
      ['en definitiva,', 'en resumen,'],
      ['en primer lugar,', 'primero,'],
      ['en segundo lugar,', 'segundo,'],
      ['en tercer lugar,', 'tercero,'],
      ['asimismo,', 'también,'],
      ['igualmente,', 'también,'],
      ['por otro lado,', 'además,'],
      ['por otra parte,', 'además,'],
    ];

    complexConnectors.forEach(([complex, simple]) => {
      // Reemplazar solo en segmentos de texto, NO dentro de atributos HTML
      const escaped = complex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      improved = improved.replace(new RegExp(`(?<=>|^|\\s)(${escaped})(?=\\s|<|$)`, 'gi'), simple);
    });

    // 2️⃣ Simplificación de vocabulario (palabras completas solamente)
    const wordSimplifications: [string, string][] = [
      ['utilizar', 'usar'],
      ['efectuar', 'hacer'],
      ['implementar', 'aplicar'],
      ['optimizar', 'mejorar'],
      ['incrementar', 'aumentar'],
      ['disminuir', 'bajar'],
      ['adicionalmente', 'además'],
      ['posteriormente', 'después'],
      ['anteriormente', 'antes'],
      ['aproximadamente', 'cerca de'],
      ['específicamente', 'en concreto'],
      ['realizar', 'hacer'],
      ['llevar a cabo', 'hacer'],
      ['obtener', 'conseguir'],
      ['proporcionar', 'dar'],
      ['requerir', 'necesitar'],
      ['permitir', 'dejar'],
      ['garantizar', 'asegurar'],
      ['considerar', 'tener en cuenta'],
      ['demostrar', 'mostrar'],
      ['mediante', 'con'],
      ['actualmente', 'hoy'],
    ];

    wordSimplifications.forEach(([complex, simple]) => {
      improved = improved.replace(new RegExp(`\\b${complex}\\b`, 'gi'), simple);
    });
  } // end isSpanish

  // 3️⃣ Correcciones de formato y puntuación (universal) — no tocan etiquetas
  improved = improved.replace(/\s{2,}/g, ' ');
  improved = improved.replace(/\.{2,}/g, '.');
  improved = improved.replace(/\.\s*\./g, '.');
  improved = improved.replace(/\.([A-ZÁÉÍÓÚÑA-Z])/g, '. $1');
  improved = improved.replace(/,\s*\./g, '.');
  improved = improved.replace(/\s+\./g, '.');
  improved = improved.replace(/\s+,/g, ',');

  // 4️⃣ Corregir bullets sin punto final dentro de <li>
  improved = improved.replace(/([^.!?¿¡\s])(<\/li>)/g, '$1.$2');

  // 5️⃣ Limpiar espacios al inicio/fin de párrafos
  improved = improved.replace(/<p>\s+/g, '<p>');
  improved = improved.replace(/\s+<\/p>/g, '</p>');

  // 6️⃣ Dividir párrafos <p> que superen 60 palabras en párrafos más cortos.
  //    ⚠️ Sólo se dividen en límites de oración (punto, !, ?) para no romper frases.
  //    Las listas <ul> no se tocan.
  improved = improved.replace(/(<ul>[\s\S]*?<\/ul>)|(<p>[\s\S]*?<\/p>)/gi, (block) => {
    if (/^<ul>/i.test(block)) return block; // nunca tocar listas

    const innerMatch = block.match(/^<p>([\s\S]*?)<\/p>$/i);
    if (!innerMatch) return block;
    const inner = innerMatch[1];

    // Contar palabras del texto plano
    const plainText = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = plainText.split(' ').filter(Boolean).length;
    if (wordCount <= 55) return block; // párrafo corto → no tocar

    // Dividir por límites de oración preservando el HTML completo
    // Usamos una estrategia conservadora: split en ". " o "? " o "! " solo
    // cuando el siguiente carácter es mayúscula o ¿ ¡
    const sentences: string[] = [];
    const sentenceRegex = /(.+?[.!?])(?=\s+[A-ZÁÉÍÓÚÑ¿¡]|$)/g;
    let match;
    let lastIndex = 0;
    while ((match = sentenceRegex.exec(inner)) !== null) {
      sentences.push(match[1].trim());
      lastIndex = sentenceRegex.lastIndex;
    }
    if (lastIndex < inner.length) {
      const rest = inner.slice(lastIndex).trim();
      if (rest) sentences.push(rest);
    }

    if (sentences.length <= 1) return block; // no se pudo dividir

    // Agrupar en párrafos de máx 2 oraciones
    const groups: string[] = [];
    for (let i = 0; i < sentences.length; i += 2) {
      groups.push(sentences.slice(i, i + 2).join(' '));
    }

    return groups.map(g => `<p>${g}</p>`).join('\n');
  });

  return improved;
};

const App: React.FC = () => {
  // Configuración de Estados
  const [step, setStep] = useState<AppStep>(AppStep.ACCOUNT);
  const [accountUuid, setAccountUuid] = useState('');

  const [isManualMode, setIsManualMode] = useState(false); // false = EXTRACCIÓN AUTO, true = CARGA MASIVA CSV
  
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  
  // Datos del Proceso
  const [article, setArticle] = useState<Partial<Article>>({});
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [publishResult, setPublishResult] = useState<{ success: boolean; msg: string; url?: string } | null>(null);
  // 🚀 Prodline manual (modo auto): UUID del task para enviar deliverable post-publicación
  const [prodlineUuidInput, setProdlineUuidInput] = useState('');
  const [prodlineSubmitStatus, setProdlineSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [prodlineSubmitMsg, setProdlineSubmitMsg] = useState('');
  // 💼 Nombre del negocio extraído del brief (puede venir en JSON bajo varios campos)
  const [clientBusinessName, setClientBusinessName] = useState<string | null>(null);
  const clientBusinessNameRef = React.useRef<string | null>(null); // ref síncrono para evitar race conditions

  // 📄 Producción masiva desde CSV
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [currentRowIndex, setCurrentRowIndex] = useState(0);
  const [csvRowsV2, setCsvRowsV2] = useState<CsvRowV2[]>([]);
  const [isCsvV2Format, setIsCsvV2Format] = useState(false);
  
  // 🔗 Array de URLs publicadas (useRef para acceso inmediato sin esperar estado)
  const publishedUrlsRef = React.useRef<string[]>([]);
  
  // 🗺️ Mapa exacto de URLs: rowIndex → articleIndex → url
  const urlMapRef = React.useRef<Record<number, Record<number, string>>>({});
  
  // ✅ Control de flujo ClickUp → Prodline (manual y secuencial)
  const [clickupDone, setClickupDone] = React.useState(false);
  const [prodlineDone, setProdlineDone] = React.useState(false);
  const [showClickUpConfirm, setShowClickUpConfirm] = React.useState(false);
  
  // 📊 Ref para totalArticles (acceso inmediato sin esperar estado)
  const totalArticlesRef = React.useRef<number>(0);
  
  // 🔑 Ref para keywords originales de la cuenta actual
  const originalKeywordsRef = React.useRef<string[]>([]);
  
  // 🌐 Ref para website del cliente actual
  const clientWebsiteRef = React.useRef<string | null>(null);
  
  // 📊 Refs para progreso de cuentas
  const currentAccountRef = React.useRef<number>(0);
  const totalAccountsRef = React.useRef<number>(0);
  const currentArticleRef = React.useRef<number>(0); // Contador de artículos de la cuenta actual
  
  // 🛑 Flag para evitar ejecuciones múltiples
  const isProcessingRef = React.useRef<boolean>(false);
  
  const [batchProgress, setBatchProgress] = useState<{
    currentAccount: number;
    totalAccounts: number;
    currentArticle: number;
    totalArticles: number;
    publishedUrls: string[];
    isComplete: boolean;
    currentAccountUuid?: string; // UUID de la cuenta actual
  }>({
    currentAccount: 0,
    totalAccounts: 0,
    currentArticle: 0,
    totalArticles: 0,
    publishedUrls: [],
    isComplete: false
  });

  const [clientWebsite, setClientWebsite] = useState<string | null>(null);
  const [communicationLanguage, setCommunicationLanguage] = useState<CommunicationLanguage>('spanish');
  const communicationLanguageRef = React.useRef<CommunicationLanguage>('spanish');
  const [clientCompanyCategory, setClientCompanyCategory] = useState<string | null>(null);
  const [clientCompanySubcategory, setClientCompanySubcategory] = useState<string | null>(null);
  const clientCompanyCategoryRef = React.useRef<string | null>(null);
  const clientCompanySubcategoryRef = React.useRef<string | null>(null);

  // 📝 Modo Feedback
  const [isFeedbackMode, setIsFeedbackMode] = useState(false);
  const [feedbackAccountUuid, setFeedbackAccountUuid] = useState('');
  const [feedbackContentType, setFeedbackContentType] = useState<ContentType>('on_blog');
  const [feedbackWpUrl, setFeedbackWpUrl] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackTaskUuid, setFeedbackTaskUuid] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [feedbackStatusMsg, setFeedbackStatusMsg] = useState('');
  const feedbackInstructionsRef = React.useRef<string>('');

  // 🧠 Memoria de títulos generados por cuenta (persiste en localStorage entre sesiones)
  const [accountMemory, setAccountMemory] = useState<Record<string, string[]>>(() => {
    try {
      const stored = localStorage.getItem('plinng_account_memory_v1');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // 🌐 Configuración de WordPress
  const [wpDomain, setWpDomain] = useState<string>(import.meta.env.VITE_WP_DOMAIN || 'https://cienciacronica.com');
  const [wpJwtToken, setWpJwtToken] = useState<string>(import.meta.env.VITE_WORDPRESS_TOKEN || '');
  const [wpDomainSite3, setWpDomainSite3] = useState<string>(import.meta.env.VITE_WP_DOMAIN_3 || 'https://laprensa360.com');
  const [wpJwtTokenSite3, setWpJwtTokenSite3] = useState<string>(import.meta.env.VITE_WORDPRESS_TOKEN_3 || '');
  const [wpDomainSite2, setWpDomainSite2] = useState<string>(import.meta.env.VITE_WP_DOMAIN_2 || 'https://elinformedigital.com');
  const [wpJwtTokenSite2, setWpJwtTokenSite2] = useState<string>(import.meta.env.VITE_WORDPRESS_TOKEN_2 || '');
  const [wpDomainEnglish, setWpDomainEnglish] = useState<string>(import.meta.env.VITE_WP_DOMAIN_EN || 'https://www.wall-trends.com');
  const [wpJwtTokenEnglish, setWpJwtTokenEnglish] = useState<string>(import.meta.env.VITE_WORDPRESS_TOKEN_EN || '');
  // === Sitio 5: masproposals.com (de geo2-main) ===
  const [wpDomainSite5, setWpDomainSite5] = useState<string>(import.meta.env.VITE_WP_DOMAIN_5 || 'https://masproposals.com');
  const [wpJwtTokenSite5, setWpJwtTokenSite5] = useState<string>(import.meta.env.VITE_WORDPRESS_TOKEN_5 || '');

  // 🎯 Tipo de contenido seleccionado por el usuario
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const contentTypeRef = React.useRef<ContentType>('on_blog');

  const [contentContext, setContentContext] = useState<ContentContext | null>(null);
  const contentContextRef = React.useRef<ContentContext | null>(null);
  const [websiteAnalysisError, setWebsiteAnalysisError] = useState<string | null>(null);

  // 🗺️ Datos del post GMB generado (acceso síncrono para publish)
  const [gmbPostData, setGmbPostData] = useState<GmbPost | null>(null);
  const gmbPostDataRef = React.useRef<GmbPost | null>(null);

  // 🔄 Índice rotativo de portal off_page (para no repetir el mismo portal en publicaciones consecutivas)
  const offPagePortalIndexRef = React.useRef<number>(0);

  // 💾 Persistir memoria de cuentas en localStorage cada vez que cambia
  React.useEffect(() => {
    if (Object.keys(accountMemory).length > 0) {
      try { localStorage.setItem('plinng_account_memory_v1', JSON.stringify(accountMemory)); } catch { /* storage full */ }
    }
  }, [accountMemory]);

  // 📋 Capturar URLs publicadas automáticamente en modo CSV
  React.useEffect(() => {
    if (batchProgress.totalAccounts > 0 && publishResult?.success && publishResult.url) {
      if (!batchProgress.publishedUrls.includes(publishResult.url)) {
        setBatchProgress(prev => ({
          ...prev,
          publishedUrls: [...prev.publishedUrls, publishResult.url!]
        }));
        addLog(`✅ URL guardada: ${publishResult.url}`);
      }
    }
  }, [publishResult]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev.slice(-25), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const wait = (ms: number) => new Promise(res => setTimeout(res, ms));

  // 🔗 Actualizar campo de URL en ClickUp
  const updateClickUpTaskUrl = async (taskId: string, url: string): Promise<boolean> => {
    try {
      addLog(`🔄 Actualizando ClickUp task ${taskId} con URL...`);
      
      const CLICKUP_API_KEY = import.meta.env.VITE_CLICKUP_API_KEY;
      
      const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/959a5bb5-b1ac-44ec-b814-52f7b415ac91`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'Authorization': CLICKUP_API_KEY
        },
        body: JSON.stringify({ value: url })
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }

      addLog(`✅ URL poblada en ClickUp task ${taskId}`);
      return true;
    } catch (e: any) {
      addLog(`❌ Error poblando URL en ClickUp: ${e.message}`);
      return false;
    }
  };

  // ✅ Marcar tarea de ClickUp como completada
  const markClickUpTaskComplete = async (taskId: string): Promise<boolean> => {
    try {
      addLog(`🔄 Marcando ClickUp task ${taskId} como completada...`);
      
      const CLICKUP_API_KEY = import.meta.env.VITE_CLICKUP_API_KEY;
      
      const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/b39da2a6-e438-4786-aaa6-9774e49bfcc4`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'Authorization': CLICKUP_API_KEY
        },
        body: JSON.stringify({ value: 1 })
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }

      addLog(`✅ ClickUp task ${taskId} marcada como completada`);
      return true;
    } catch (e: any) {
      addLog(`❌ Error marcando tarea: ${e.message}`);
      return false;
    }
  };

  // 📋 Actualizar todas las tareas de ClickUp con las URLs generadas
  const updateClickUpTasks = async () => {
    if (csvRows.length === 0 || batchProgress.publishedUrls.length === 0) {
      addLog("❌ No hay URLs o filas CSV para actualizar");
      return;
    }

    addLog(`\n========================================`);
    addLog(`📋 ACTUALIZANDO CLICKUP`);
    addLog(`========================================`);

    setIsLoading(true);
    setLoadingStatus("Actualizando tareas en ClickUp...");

    let urlIndex = 0;
    let successCount = 0;

    try {
      for (const row of csvRows) {
        // Parsear los task IDs de ClickUp
        const taskIds = row.task_clickup_ids
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0);

        if (taskIds.length === 0) {
          addLog(`⚠️ No hay task IDs para cuenta ${row.account_uuid.slice(0, 12)}...`);
          continue;
        }

        addLog(`\n📦 Procesando ${taskIds.length} tareas de ClickUp...`);

        // Actualizar cada task con su URL correspondiente
        for (let i = 0; i < taskIds.length; i++) {
          if (urlIndex >= batchProgress.publishedUrls.length) {
            addLog(`⚠️ No hay más URLs disponibles`);
            break;
          }

          const taskId = taskIds[i];
          const url = batchProgress.publishedUrls[urlIndex];

          addLog(`\n🎯 Task ${i + 1}/${taskIds.length}: ${taskId}`);

          // 1. Poblar URL
          const urlSuccess = await updateClickUpTaskUrl(taskId, url);
          await wait(500);

          if (urlSuccess) {
            // 2. Marcar como completada
            const completeSuccess = await markClickUpTaskComplete(taskId);
            await wait(500);

            if (completeSuccess) {
              successCount++;
            }
          }

          urlIndex++;
        }
      }

      addLog(`\n========================================`);
      addLog(`✅ ACTUALIZACIÓN COMPLETADA`);
      addLog(`========================================`);
      addLog(`📊 ${successCount} tareas actualizadas exitosamente`);

      // Mostrar mensaje de éxito
      alert(`✅ ClickUp actualizado:\n\n${successCount} tareas actualizadas correctamente`);

    } catch (e: any) {
      addLog(`❌ Error general: ${e.message}`);
      alert(`Error actualizando ClickUp:\n\n${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // 📄 Parser CSV robusto que maneja valores con comas entre comillas
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  // 📄 Carga y lectura de CSV para producción masiva
  const handleCsvUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addLog("📄 Leyendo archivo CSV...");

    const text = await file.text();
    const lines = text.split("\n").filter(line => line.trim().length > 0);

    if (lines.length < 2) {
      alert("El archivo CSV está vacío o no tiene datos.");
      return;
    }

    // Parsear headers
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/"/g, ''));

    addLog(`📋 Columnas detectadas: ${headers.join(", ")}`);

    // ─── Detectar formato v2 (multi-tipo por cuenta) ───────────────────────
    const isV2 = headers.includes('count_onblog') || headers.includes('count_offpa') || headers.includes('count_offpage') || headers.includes('count_postnoticias');

    if (isV2) {
      if (!headers.includes('account_uuid')) {
        alert('Faltan columnas requeridas en el CSV v2: account_uuid\n\nColumnas encontradas: ' + headers.join(', '));
        return;
      }

      const v2rows: CsvRowV2[] = lines.slice(1).map(line => {
        const values = parseCSVLine(line).map(v => v.trim().replace(/^"|"$/g, ''));
        const col = (...names: string[]) => {
          for (const name of names) {
            const idx = headers.indexOf(name);
            if (idx >= 0) return values[idx] || '';
          }
          return '';
        };
        const num = (...names: string[]) => {
          const n = parseInt(col(...names), 10);
          return isNaN(n) || n < 0 ? 0 : n;
        };
        return {
          account_uuid: col('account_uuid'),
          kw: col('kw'),
          count_onblog: num('count_onblog'),
          count_offpa: num('count_offpage', 'count_offpa'),   // acepta ambas variantes
          count_postnoticias: num('count_postnoticias'),
          task_uuid_onblog: col('task_uuid_onblog'),
          task_uuid_offpage: col('task_uuid_offpage'),
          task_uuid_postnoticias: col('task_uuid_postnoticias'),
        };
      }).filter(row => row.account_uuid);

      if (v2rows.length === 0) {
        alert('No se encontraron filas válidas en el CSV v2.');
        return;
      }

      setCsvRowsV2(v2rows);
      setCsvRows([]);
      setIsCsvV2Format(true);
      setCurrentRowIndex(0);

      const totalArt = v2rows.reduce((s, r) => s + r.count_onblog + r.count_offpa + r.count_postnoticias, 0);
      addLog(`✅ CSV v2 cargado: ${v2rows.length} cuentas válidas`);
      addLog(`📊 Total piezas: ${totalArt} (on_blog + off_page + gmb)`);
      v2rows.slice(0, 5).forEach((row, i) => {
        addLog(`  Cuenta ${i + 1}: ${row.account_uuid.slice(0, 20)}... → blog:${row.count_onblog} offpage:${row.count_offpa} gmb:${row.count_postnoticias}`);
      });
      return;
    }

    // ─── Formato clásico ────────────────────────────────────────────────────
    const requiredColumns = ['account_uuid', 'kw', 'task_count', 'task_clickup_ids'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));

    if (missingColumns.length > 0) {
      alert(`Faltan columnas requeridas en el CSV: ${missingColumns.join(', ')}\n\nColumnas encontradas: ${headers.join(', ')}`);
      return;
    }

    const rows: CsvRow[] = lines.slice(1).map((line) => {
      const values = parseCSVLine(line).map(v => v.trim().replace(/^"|"$/g, ''));

      const accountUuid = values[headers.indexOf("account_uuid")] || "";
      const kw = values[headers.indexOf("kw")] || "";
      const taskCountStr = values[headers.indexOf("task_count")] || "1";
      const taskCount = parseInt(taskCountStr, 10);
      const taskClickupIds = values[headers.indexOf("task_clickup_ids")] || "";
      const taskProdlineIds = values[headers.indexOf("task_prodline_ids")] || "";
      const rawContentType = headers.includes("content_type")
        ? (values[headers.indexOf("content_type")] || "").toLowerCase().trim()
        : "";
      const parsedContentType: ContentType =
        rawContentType === "off_page" ? "off_page"
        : rawContentType === "gmb" ? "gmb"
        : "on_blog";

      return {
        account_uuid: accountUuid,
        kw: kw,
        task_count: isNaN(taskCount) || taskCount <= 0 ? 1 : taskCount,
        task_clickup_ids: taskClickupIds,
        task_prodline_ids: taskProdlineIds,
        content_type: parsedContentType,
      };
    }).filter(row => row.account_uuid && row.kw);

    if (rows.length === 0) {
      alert("No se encontraron filas válidas en el CSV.");
      return;
    }

    setCsvRows(rows);
    setCsvRowsV2([]);
    setIsCsvV2Format(false);
    setCurrentRowIndex(0);

    const totalArticles = rows.reduce((sum, row) => sum + row.task_count, 0);

    addLog(`✅ CSV cargado: ${rows.length} cuentas válidas`);
    addLog(`📊 Total artículos: ${totalArticles}`);

    rows.forEach((row, i) => {
      addLog(`  Cuenta ${i + 1}: ${row.task_count} artículos | UUID: ${row.account_uuid.slice(0, 12)}... | KW: ${row.kw.slice(0, 40)}...`);
    });
  };

  /**
   * Utilidad para convertir base64 a Blob para subir a WP
   */
  const base64ToBlob = (base64: string, contentType: string) => {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  /**
   * Sube la imagen a la biblioteca de medios de WordPress
   */
  const uploadImageToWP = async (base64: string, title: string, token: string, domain: string): Promise<number | null> => {
    try {
      addLog("Subiendo imagen a WordPress Media...");
      const blob = base64ToBlob(base64, 'image/png');
      const formData = new FormData();
      formData.append('file', blob, `seo-image-${Date.now()}.png`);
      formData.append('title', title);
      formData.append('alt_text', title);

      const response = await fetch(`${domain}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: { 
          'Authorization': token 
        },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Error subiendo imagen");
      }

      const media = await response.json();
      addLog(`Imagen subida con éxito (ID: ${media.id})`);
      return media.id;
    } catch (e: any) {
      addLog(`Error subiendo imagen: ${e.message}`);
      return null;
    }
  };

  const extractContextFromData = (data: any): string => {
    /**
     * ============================
     * CASO 1: HTML (web del cliente)
     * ============================
     */
    if (typeof data === 'string' && data.includes('<')) {
      const doc = new DOMParser().parseFromString(data, 'text/html');

      // ❌ Eliminamos ruido visual / legal
      doc.querySelectorAll(
        'nav, header, footer, script, style, img, svg, button, form, input, aside'
      ).forEach(el => el.remove());

      const chunks: string[] = [];

      // ✅ Extraer nombre del negocio del HTML — 3 métodos en cascada
      let htmlBusinessName: string | null = null;

      // Método 1: Comentario con FIELD_COMPANY_NAME (cualquier tipo de comilla)
      const commentMatch = data.match(/FIELD_COMPANY_NAME[\s\S]{0,200}?['\"\u2018\u2019\u201C\u201D]value['\"\u2018\u2019\u201C\u201D]\s*:\s*['\"\u2018\u2019\u201C\u201D]([^'\"\u2018\u2019\u201C\u201D\n]+)/);
      if (commentMatch?.[1]) {
        htmlBusinessName = commentMatch[1].trim();
        addLog(`🔍 Método 1 (comentario FIELD_COMPANY_NAME): "${htmlBusinessName}"`);
      }

      // Método 2: <label>Nombre del Negocio / Empresa</label><p>Valor</p>
      if (!htmlBusinessName) {
        doc.querySelectorAll('.field, .form-field, [class*="field"]').forEach(field => {
          const labelText = field.querySelector('label')?.textContent?.trim().toLowerCase() ?? '';
          if (labelText.includes('nombre') && (labelText.includes('negocio') || labelText.includes('empresa') || labelText.includes('compan'))) {
            const value = field.querySelector('p, input, span')?.textContent?.trim();
            if (value && value.length > 0) {
              htmlBusinessName = value;
              addLog(`🔍 Método 2 (DOM .field label): "${htmlBusinessName}"`);
            }
          }
        });
      }

      // Método 3: regex directo sobre el HTML crudo buscando el patrón label/valor
      if (!htmlBusinessName) {
        const rawMatch = data.match(/Nombre\s+del\s+[Nn]egocio[\s\S]{0,100}?<p[^>]*>\s*([^<]+?)\s*<\/p>/i);
        if (rawMatch?.[1]) {
          htmlBusinessName = rawMatch[1].trim();
          addLog(`🔍 Método 3 (regex HTML crudo): "${htmlBusinessName}"`);
        }
      }

      if (htmlBusinessName) {
        setClientBusinessName(htmlBusinessName);
        clientBusinessNameRef.current = htmlBusinessName;
        addLog(`✅ Nombre de negocio detectado: ${htmlBusinessName}`);
      } else {
        addLog(`⚠️ No se detectó nombre de negocio en el HTML`);
      }

      const htmlCategory = extractFieldValueFromBriefHTML(data, 'Categoría de la empresa');
      const htmlSubcategory = extractFieldValueFromBriefHTML(data, 'Subcategoría de la empresa');
      const htmlLanguage = extractCommunicationLanguageFromBriefHTML(data) || extractCommunicationLanguageFromText(data);
      setClientCompanyCategory(htmlCategory);
      setClientCompanySubcategory(htmlSubcategory);
      clientCompanyCategoryRef.current = htmlCategory;
      clientCompanySubcategoryRef.current = htmlSubcategory;
      if (htmlCategory) addLog(`📁 Categoría empresa detectada: ${htmlCategory}`);
      if (htmlSubcategory) addLog(`📂 Subcategoría empresa detectada: ${htmlSubcategory}`);
      if (htmlLanguage) {
        setCommunicationLanguage(htmlLanguage);
        communicationLanguageRef.current = htmlLanguage;
        addLog(`🌐 Idioma detectado en brief: ${formatLanguageLabel(htmlLanguage)}`);
      } else {
        addLog('⚠️ No se detectó idioma explícito en HTML. Se usará el idioma por defecto (español).');
      }

      // ✅ Prioridad a títulos reales
      doc.querySelectorAll('h1, h2, h3').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 5) chunks.push(text);
      });

      // ✅ Prioridad a párrafos con contenido semántico
      doc.querySelectorAll('p').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 80) chunks.push(text);
      });

      const context = chunks
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('. ')
        .slice(0, 12000);

      addLog("🧠 Contexto HTML limpio generado");
      addLog("📄 Preview contexto HTML:");
      addLog(context.slice(0, 400) + "...");

      return context;
    }

    /**
     * ============================
     * CASO 2: JSON (brief estructurado)
     * ============================
     */
    if (typeof data === 'object' && data !== null) {
      const chunks: string[] = [];

      // 🔑 SOLO campos que definen negocio
      const PRIORITY_KEYS = [
        'business_name',
        'company_name',
        'brand',
        'nombre',
        'nombre_del_negocio',
        'nombre del negocio',
        'client_name',
        'categoria de la empresa',
        'categoría de la empresa',
        'subcategoria de la empresa',
        'subcategoría de la empresa',
        'category',
        'subcategory',
        'communication_language',
        'language',
        'idioma',
        'idioma de comunicacion',
        'idioma de comunicación',
        'service',
        'services',
        'description',
        'business_description',
        'about',
        'objectives',
        'target_audience',
        'value_proposition',
        'notes'
      ];
      const PRIORITY_KEYS_LC = PRIORITY_KEYS.map(k => k.toLowerCase());

      let detectedBusinessName: string | null = null;
      let detectedCategory: string | null = null;
      let detectedSubcategory: string | null = null;
      let detectedLanguage: CommunicationLanguage | null = null;
      const walk = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        Object.entries(obj).forEach(([key, value]) => {
          const keyLc = key.toLowerCase();
          if (PRIORITY_KEYS_LC.includes(keyLc) && typeof value === 'string') {
            chunks.push(value);
            if (!detectedBusinessName && ['business_name','company_name','brand','nombre','nombre_del_negocio','nombre del negocio','client_name'].includes(keyLc)) {
              detectedBusinessName = value;
            }
            if (!detectedCategory && ['categoria de la empresa','categoría de la empresa','category'].includes(keyLc)) {
              detectedCategory = value;
            }
            if (!detectedSubcategory && ['subcategoria de la empresa','subcategoría de la empresa','subcategory'].includes(keyLc)) {
              detectedSubcategory = value;
            }
            if (!detectedLanguage && ['communication_language', 'language', 'idioma', 'idioma de comunicacion', 'idioma de comunicación'].includes(keyLc)) {
              detectedLanguage = normalizeCommunicationLanguage(value);
            }
          } else if (typeof value === 'object') {
            walk(value);
          }
        });
      };

      walk(data);

      const context = chunks
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('. ')
        .slice(0, 12000);

      if (detectedBusinessName) {
        setClientBusinessName(detectedBusinessName);
        clientBusinessNameRef.current = detectedBusinessName;
        addLog(`🏷️ Nombre de negocio detectado: ${detectedBusinessName}`);
      } else {
        setClientBusinessName(null);
        clientBusinessNameRef.current = null;
      }

      setClientCompanyCategory(detectedCategory);
      setClientCompanySubcategory(detectedSubcategory);
      clientCompanyCategoryRef.current = detectedCategory;
      clientCompanySubcategoryRef.current = detectedSubcategory;
      if (detectedCategory) addLog(`📁 Categoría empresa detectada: ${detectedCategory}`);
      if (detectedSubcategory) addLog(`📂 Subcategoría empresa detectada: ${detectedSubcategory}`);
      if (detectedLanguage) {
        setCommunicationLanguage(detectedLanguage);
        communicationLanguageRef.current = detectedLanguage;
        addLog(`🌐 Idioma detectado en brief: ${formatLanguageLabel(detectedLanguage)}`);
      } else {
        const rawJsonLanguage = extractCommunicationLanguageFromText(JSON.stringify(data));
        if (rawJsonLanguage) {
          setCommunicationLanguage(rawJsonLanguage);
          communicationLanguageRef.current = rawJsonLanguage;
          addLog(`🌐 Idioma detectado en JSON (fallback): ${formatLanguageLabel(rawJsonLanguage)}`);
        }
      }

      addLog("🧠 Contexto JSON estructurado generado");
      addLog("📄 Preview contexto JSON:");
      addLog(context.slice(0, 400) + "...");

      return context;
    }

    /**
     * ============================
     * FALLBACK (texto plano)
     * ============================
     */
    const plainText = String(data).slice(0, 5000);
    // Intentar extraer "Nombre del negocio" de texto plano
    const nameMatch = plainText.match(/nombre\s+del\s+negocio\s*[:\-]\s*(.+)/i);
    if (nameMatch && nameMatch[1]) {
      const extractedName = nameMatch[1].split('\n')[0].trim();
      setClientBusinessName(extractedName);
      clientBusinessNameRef.current = extractedName;
      addLog(`🏷️ Nombre de negocio detectado (texto): ${extractedName}`);
    }
    const plainLang = extractCommunicationLanguageFromText(plainText);
    if (plainLang) {
      setCommunicationLanguage(plainLang);
      communicationLanguageRef.current = plainLang;
      addLog(`🌐 Idioma detectado en texto plano: ${formatLanguageLabel(plainLang)}`);
    }
    return plainText;
  };

  const handleDataAcquisition = async (data: any, skipKeywordsAndStep: boolean = false): Promise<string | null> => {
    addLog("Interpretando información del Brief...");
    // Reiniciar idioma por defecto para evitar arrastrar idioma previo entre briefs.
    setCommunicationLanguage('spanish');
    communicationLanguageRef.current = 'spanish';
    const context = extractContextFromData(data);

    // Segundo intento de detección usando el payload completo por si el parser estructurado no capturó el idioma.
    const fullPayloadLanguage = extractCommunicationLanguageFromText(typeof data === 'string' ? data : JSON.stringify(data));
    // Solo usar fallback global para salir del default; no sobreescribir una detección estructurada previa.
    if (fullPayloadLanguage && communicationLanguageRef.current === 'spanish' && fullPayloadLanguage !== 'spanish') {
      setCommunicationLanguage(fullPayloadLanguage);
      communicationLanguageRef.current = fullPayloadLanguage;
      addLog(`🌐 Idioma detectado (fallback global): ${formatLanguageLabel(fullPayloadLanguage)}`);
    }

    let detectedWebsite: string | null = null;

    // 🌐 DETECCIÓN DE WEB DEL CLIENTE (HTML / JSON / texto)
    if (typeof data === "string") {
      // Intentar con el extractor HTML primero (funciona con HTML de Orbidi)
      let website = extractWebsiteFromBriefHTML(data);
      // Si no encontró nada y no parece HTML, intentar con extractor de texto plano
      if (!website && !/<[a-z][\s\S]*>/i.test(data)) {
        website = extractWebsiteFromBodyText(data);
      }

      if (website) {
        setClientWebsite(website);
        clientWebsiteRef.current = website;
        detectedWebsite = website;
        addLog(`🌐 Web del cliente detectada: ${website}`);
      } else {
        setClientWebsite(null);
        clientWebsiteRef.current = null;
        addLog("ℹ️ El brief no contiene web del cliente");
      }
    } else if (typeof data === 'object' && data !== null) {
      const website = extractWebsiteFromStructuredData(data);
      if (website) {
        setClientWebsite(website);
        clientWebsiteRef.current = website;
        detectedWebsite = website;
        addLog(`🌐 Web del cliente detectada (JSON): ${website}`);
      } else {
        setClientWebsite(null);
        clientWebsiteRef.current = null;
        addLog("ℹ️ JSON sin web de cliente detectable");
      }
    } else {
      const website = extractFirstWebsiteFromText(String(data || ''));
      if (website) {
        setClientWebsite(website);
        clientWebsiteRef.current = website;
        detectedWebsite = website;
        addLog(`🌐 Web del cliente detectada (texto): ${website}`);
      } else {
        setClientWebsite(null);
        clientWebsiteRef.current = null;
      }
    }
    
    addLog("📤 Contexto FINAL enviado a Gemini:");
    addLog(context.slice(0, 500));

    // Solo generar keywords y cambiar step si NO se indica lo contrario
    if (!skipKeywordsAndStep) {
      setIsLoading(true);
      setLoadingStatus("IA extrayendo datos del Brief...");
      try {
        const keywordsLanguage = communicationLanguageRef.current || communicationLanguage;
        addLog(`🔤 Generando keywords en: ${formatLanguageLabel(keywordsLanguage)}`);
        let suggestedKeywords = await generateKeywords(context, keywordsLanguage);
        // ensure no empty strings
        suggestedKeywords = suggestedKeywords.map(k => k.trim()).filter(k => k.length > 0);
        const primary = suggestedKeywords.length > 0 ? suggestedKeywords[0] : '';
        setKeywords(primary ? [primary] : []);
        addLog(`Keywords identificadas (uso solo la primera): ${primary}`);
        setStep(AppStep.KEYWORDS);
      } catch (e: any) {
        addLog(`Error Gemini: ${e.message}`);
        setKeywords([]);
        setStep(AppStep.KEYWORDS);
      } finally {
        setIsLoading(false);
      }
    }

    return detectedWebsite;
  };
 
  // 🔑 FUNCIÓN BASE reutilizable (UI + CSV)
  // breve de ejemplo que se utilizará cuando el servicio real falle
  const SAMPLE_BRIEF = `{
  "title": "Ejemplo de brief",
  "body": "Este es un texto de prueba que simula un brief válido. Puedes seguir el flujo de la aplicación sin depender del servicio externa."
}`;

  const fetchBriefByUuid = async (uuid: string): Promise<string> => {
    const ORBIDI_API_KEY = import.meta.env.VITE_ORBIDI_API_KEY;
    
    if (!uuid) {
      throw new Error("UUID es requerido");
    }
    
    if (!ORBIDI_API_KEY) {
      throw new Error("VITE_ORBIDI_API_KEY no está configurado en el archivo .env");
    }

    const authHeader = ORBIDI_API_KEY.startsWith("Bearer ")
      ? ORBIDI_API_KEY
      : `Bearer ${ORBIDI_API_KEY}`;

    const res = await fetch(
      `https://eu.api.orbidi.com/prod-line/space-management/accounts/${uuid}/brief`,
      {
        headers: {
          Accept: "application/json, text/html",
          Authorization: authHeader,
          "x-api-key": ORBIDI_API_KEY,
        },
      }
    );

    const text = await res.text();

    if (!res.ok) {
      // si Orbidi devuelve error, registramos para diagnóstico
      console.error("fetchBriefByUuid failed", { status: res.status, body: text });

      // para desarrollo local devolvemos un brief de ejemplo
      if (res.status >= 500) {
        const sample = `{
  "title": "Ejemplo de brief",
  "body": "Este es un texto de prueba que simula un brief válido. Puedes seguir el flujo de la aplicación sin depender del servicio externa."
}`;
        return sample;
      }

      throw new Error(`Error ${res.status}: no se pudo obtener el brief`);
    }

    return text;
  };
  
  // 🎛️ Wrapper UI (usa el UUID del input)
  // helpers ------------------------------------------------
  /**
   * Normaliza títulos eliminando preguntas repetidas y evitando
   * que un encabezado que termina en '?' vaya seguido de otro que
   * comience también con '¿' o '?'.
   *
   * @param t  texto a sanitizar
   * @param prev título previo (opcional) para detectar preguntas
   */
  const sanitizeTitle = (t: string, prev?: string): string => {
    if (!t) return t;

    let text = t.trim();
    const lang = (communicationLanguageRef.current || communicationLanguage || 'spanish').toLowerCase();
    const useSpanishQuestionMarks = lang === 'spanish';

    // si el título anterior termina en pregunta, quitamos
    // los signos iniciales del actual para evitar '??' o '¿¿'
    if (prev && prev.trim().endsWith("?")) {
      text = text.replace(/^[¿\?]+\s*/, "");
    }

    // tratar como pregunta si contiene al menos un signo de interrogación
    if (/[¿\?]/.test(text)) {
      // eliminar todos los signos de interrogación y de apertura
      text = text.replace(/[¿\?]/g, "").trim();
      // quedarnos sólo con la primera frase si venían varias
      const parts = text.split("?");
      if (parts.length > 1) {
        text = parts[0].trim();
      }
      // reconstruir formato de pregunta según idioma
      if (useSpanishQuestionMarks) {
        text = `¿${text.replace(/^¿/, "").replace(/\?$/, "")}?`;
      } else {
        text = `${text.replace(/^¿/, "").replace(/\?$/, "")}?`;
      }
    }

    // En idiomas no españoles, eliminar cualquier signo de apertura residual.
    if (!useSpanishQuestionMarks) {
      text = text.replace(/^¿+\s*/, '');
    }

    return text;
  };

  /**
   * Ajusta un texto para que tenga como máximo un número de palabras
   * determinado. Si ya es más corto, se devuelve tal cual.
   */
  const enforceWordCount = (text: string, maxWords: number): string => {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(" ");
  };

  /**
   * Force a text to have exactly `count` words.
   * If it's longer, truncate; if shorter, pad with a generic sentence.
   */
  const ensureWordCountExact = (text: string, count: number): string => {
    let words = text.split(/\s+/).filter(Boolean);
    if (words.length > count) {
      // if the word at the cutoff ends a sentence, trim normally
      const endsSentence = /[\.!?]$/.test(words[count - 1] || "");
      if (endsSentence) {
        return words.slice(0, count).join(" ");
      }
      // otherwise, extend until we hit the end of the current sentence
      for (let i = count; i < words.length; i++) {
        if (/[\.!?]$/.test(words[i])) {
          return words.slice(0, i + 1).join(" ");
        }
      }
      // if no sentence boundary found, just return the full text (better than chopping mid‑sentence)
      return words.join(" ");
    }
    if (words.length === count) {
      return words.join(" ");
    }
    // pad with fallback sentence repeatedly until we hit the target
    const padSentence = "La información se presenta de forma clara y práctica para ayudarte.";
    const padWords = padSentence.split(/\s+/).filter(Boolean);
    while (words.length < count) {
      const remaining = count - words.length;
      words = words.concat(padWords.slice(0, remaining));
      if (padWords.length === 0) break; // just in case
    }
    return words.join(" ");
  };

  const generateFallbackSections = (keywords: string[], lang?: string): Section[] => {
    const l = (lang || communicationLanguageRef.current || 'spanish').toLowerCase();
    // avoid generic "¿Qué es" questions that could trigger meaning-of-company replies
    const sectionTemplates = l === 'english'
      ? [
          { prefix: "Benefits of", suffix: "" },
          { prefix: "How does", suffix: " work" },
          { prefix: "Types of", suffix: "" },
          { prefix: "Tips for", suffix: "" },
        ]
      : l === 'french'
      ? [
          { prefix: "Avantages de", suffix: "" },
          { prefix: "Comment fonctionne", suffix: "" },
          { prefix: "Types de", suffix: "" },
          { prefix: "Conseils pour", suffix: "" },
        ]
      : l === 'portuguese'
      ? [
          { prefix: "Benefícios de", suffix: "" },
          { prefix: "Como funciona", suffix: "" },
          { prefix: "Tipos de", suffix: "" },
          { prefix: "Dicas sobre", suffix: "" },
        ]
      : l === 'german'
      ? [
          { prefix: "Vorteile von", suffix: "" },
          { prefix: "Wie funktioniert", suffix: "" },
          { prefix: "Arten von", suffix: "" },
          { prefix: "Tipps für", suffix: "" },
        ]
      : l === 'italian'
      ? [
          { prefix: "Vantaggi di", suffix: "" },
          { prefix: "Come funziona", suffix: "" },
          { prefix: "Tipi di", suffix: "" },
          { prefix: "Consigli su", suffix: "" },
        ]
      : l === 'catalan'
      ? [
          { prefix: "Beneficis de", suffix: "" },
          { prefix: "Com funciona", suffix: "" },
          { prefix: "Tipus de", suffix: "" },
          { prefix: "Consells sobre", suffix: "" },
        ]
      : [
          { prefix: "Beneficios de", suffix: "" },
          { prefix: "Cómo funciona", suffix: "" },
          { prefix: "Tipos de", suffix: "" },
          { prefix: "Consejos sobre", suffix: "" },
        ];

    return keywords.slice(0, 4).map((kw, i) => {
      const template = sectionTemplates[i] || { prefix: "Todo sobre", suffix: "" };
      return {
        id: `section-${i + 1}`,
        title: `${template.prefix} ${kw}${template.suffix}`,
        content: '',
        keywords: [kw]
      };
    });
  };

  // 🎛️ Wrapper UI (usa el UUID del input)
  const fetchBrief = async () => {
    const cleanUuid = accountUuid.trim();

    if (!cleanUuid) {
      alert("Falta el UUID del cliente");
      return;
    }

    setIsLoading(true);
    setLoadingStatus("Conectando con PLINNG...");

    try {
      const rawText = await fetchBriefByUuid(cleanUuid);

      // Detectar tipo de respuesta
      if (
        rawText.toLowerCase().includes("<!doctype html") ||
        rawText.includes("<html")
      ) {
        addLog("DETECTOR: Respuesta HTML recibida");
        await handleDataAcquisition(rawText);
      } else {
        addLog("ÉXITO: Datos JSON recibidos");
        const data = JSON.parse(rawText);
        await handleDataAcquisition(data);
      }
    } catch (e: any) {
      addLog(`FALLO: ${e.message}`);
      alert(`No se pudo obtener el brief: ${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // helper para limpiar frases meta de la introducción
  const cleanIntroductionText = (text: string): string => {
    let t = text || "";
    // Solo limpiar espacios redundantes y asegurar punto final
    // NO eliminar frases del contenido — eso trunca la introducción
    t = t.replace(/[\s]+/g, " ");
    t = t.trim();
    if (t && !/[.!?]$/.test(t)) t = t + ".";
    return t;
  };

  const proceedToOutline = async () => {
    if (keywords.length === 0) return alert("Indica keywords.");
    setIsLoading(true);
    setLoadingStatus("Generando Estructura H2...");
    try {
      const topicForOutline = keywords[0]; // solo la primera kw
      const contentLanguage = communicationLanguageRef.current || communicationLanguage;
      addLog(`🎯 Usando keyword principal para outline: ${topicForOutline}`);
      addLog(`🗣️ Idioma de redacción: ${formatLanguageLabel(contentLanguage)}`);
      const resolvedBusinessName = clientBusinessNameRef.current || clientBusinessName || undefined;
      addLog(`🏷️ Nombre de negocio detectado: ${resolvedBusinessName ?? '(no detectado)'} (bloqueado para redaccion)`);
      // enviamos únicamente la keyword principal a la función para evitar que Gemini disperse el tema
      if (contentContext) addLog('🧠 Inyectando CONTENT CONTEXT en el outline...');
      let outline = await generateArticleOutline(topicForOutline, [topicForOutline], contentTypeRef.current || 'on_blog', undefined, contentLanguage, undefined, undefined, contentContext || undefined);

      // sanitize in case Gemini returned two questions fused together
      if (outline.title) {
        outline.title = sanitizeTitle(outline.title);
        outline.title = toSentenceCase(outline.title);
        outline.title = stripBusinessNameMentions(outline.title, resolvedBusinessName);
      }
      if (outline.introduction) {
        // trim and remove accidental newlines
        outline.introduction = outline.introduction.trim().replace(/\n+/g, " ");
        outline.introduction = stripBusinessNameMentions(outline.introduction, resolvedBusinessName);
      }

      // ensure we always have a non-empty intro (fallback if model gave nothing)
      if (!outline.introduction || outline.introduction.split(/\s+/).filter(Boolean).length === 0) {
        const h1 = outline.title || keywords[0];
        const cleanH1 = h1.replace(/\?$/, '').trim();
        outline.introduction = `${cleanH1} ofrece claves y consejos directos para resolver esa duda, con ideas prácticas y orientadas a la acción.`;
        outline.introduction = cleanIntroductionText(outline.introduction);
      }
      if (outline.sections) {
        let lastTitle = outline.title || "";
        const seenSec = new Set<string>();
        outline.sections = outline.sections
          .map(s => {
            const clean = toSentenceCase(sanitizeTitle(s.title || "", lastTitle));
            lastTitle = clean;
            return {
              ...s,
              title: clean,
            };
          })
          .filter(s => {
            if (seenSec.has(s.title)) return false;
            seenSec.add(s.title);
            return true;
          });
      }

      addLog("📐 Outline recibido desde Gemini:");
      addLog(JSON.stringify(outline, null, 2));

      // 🔍 VERIFICAR si Gemini devolvió secciones con títulos válidos
      const hasValidSections = outline && 
                              Array.isArray(outline.sections) && 
                              outline.sections.length > 0 &&
                              outline.sections.every(s => s.title && s.title.trim().length > 0);

      if (!hasValidSections) {
        addLog("⚠️ Gemini no devolvió secciones válidas. Generando fallback inteligente...");

        const _fallbackLang = communicationLanguageRef.current || communicationLanguage;
        let fallbackSections = generateFallbackSections(keywords, _fallbackLang);
        const topicForFallback = keywords[0];
        const fallbackIntro = _fallbackLang === 'english'
          ? `This article covers ${topicForFallback} step by step, answering the main question with practical information.`
          : `En este artículo vamos a hablar sobre ${topicForFallback} y responder a la pregunta principal paso a paso.`;

        // sanitizamos los títulos de las secciones teniendo en cuenta el título
        // principal para evitar dos preguntas seguidas
        {
          let lastTitle = outline?.title || `Guía completa sobre ${keywords[0]}`;
          fallbackSections = fallbackSections.map(s => {
            const clean = toSentenceCase(sanitizeTitle(s.title, lastTitle));
            lastTitle = clean;
            return { ...s, title: clean };
          });
        }

        const _fl = communicationLanguageRef.current || communicationLanguage;
        const fallbackIntroText = _fl === 'english'
          ? `This article covers everything you need to know about ${keywords[0]}. Key aspects are analyzed so you can make an informed decision.`
          : `En este artículo encontrarás todo lo que necesitas saber sobre ${keywords[0]}. Analizamos los aspectos clave para que puedas tomar la mejor decisión con información clara y práctica.`;
        setArticle(prev => ({
          ...prev,
          title: outline?.title || (_fl === 'english' ? `Complete guide to ${keywords[0]}` : `Guía completa sobre ${keywords[0]}`),
          introduction: fallbackIntroText,
          sections: fallbackSections,
          primaryKeywords: keywords.length > 0 ? [keywords[0]] : []
        }));
        addLog(`✅ Fallback generado con ${fallbackSections.length} secciones`);
      } else {
        // Garantizar que introduction siempre tiene valor
        if (!outline.introduction || outline.introduction.trim().length === 0) {
          const h1 = outline.title || keywords[0];
          const cleanH1 = h1.replace(/\?$/, '').trim();
          const _fl2 = communicationLanguageRef.current || communicationLanguage;
          outline.introduction = ensureWordCountExact(
            _fl2 === 'english'
              ? `${cleanH1}. This article covers key information on this topic. Each aspect is analyzed to help you make the best decision.`
              : `${cleanH1}. En este artículo encontrarás información clave sobre este tema. Analizamos cada aspecto para que puedas tomar la mejor decisión.`,
            40
          );
          addLog(`⚠️ Introducción vacía — generando fallback`);
        }

        // ── Validar y corregir metaTitle ──────────────────────────────────────
        const conjEnd = /[\s,;:](y|e|o|u|ni|pero|que|de|del|con|en|a|al|por|para|sin|sobre|como|si|su|sus|un|una|las|los|la|lo)\.?$/i;
        if (outline.metaTitle) {
          if (outline.metaTitle.length > 65) {
            outline.metaTitle = smartTruncate(outline.metaTitle, 65);
            addLog(`⚠️ metaTitle recortado a: "${outline.metaTitle}"`);
          }
          outline.metaTitle = toSentenceCase(outline.metaTitle);
          if (conjEnd.test(outline.metaTitle)) {
            outline.metaTitle = outline.metaTitle.replace(conjEnd, '').trimEnd();
            addLog(`⚠️ metaTitle limpiado: "${outline.metaTitle}"`);
          }
        }
        if (outline.metaDescription) {
          if (outline.metaDescription.length > 160) {
            outline.metaDescription = smartTruncate(outline.metaDescription, 160);
            addLog(`⚠️ metaDescription recortada a: "${outline.metaDescription}"`);
          }
          if (conjEnd.test(outline.metaDescription)) {
            outline.metaDescription = outline.metaDescription.replace(conjEnd, '').trimEnd();
            if (!/[.!?]$/.test(outline.metaDescription)) outline.metaDescription += '.';
            addLog(`⚠️ metaDescription limpiada: "${outline.metaDescription}"`);
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        setArticle(prev => ({
          ...prev,
          ...outline,
          introduction: outline.introduction,
          primaryKeywords: keywords.length > 0 ? [keywords[0]] : []
        }));
        
        addLog(`✅ Outline de Gemini: ${outline.sections?.length} secciones | Intro: "${outline.introduction?.slice(0,60)}..."`);
      }

      setStep(AppStep.OUTLINE);

    } catch (e: any) {
      addLog(`Error Estructura: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const proceedToWebsiteAnalysis = async (type: ContentType) => {
    setContentType(type);
    contentTypeRef.current = type;
    setContentContext(null);
    contentContextRef.current = null;
    setWebsiteAnalysisError(null);
    setStep(AppStep.WEBSITE_ANALYSIS);

    const websiteUrl = clientWebsiteRef.current ?? clientWebsite;
    const keyword = keywords[0] || '';
    const businessName = clientBusinessNameRef.current || clientBusinessName || undefined;
    const contentLanguage = communicationLanguageRef.current || communicationLanguage;

    if (!websiteUrl) {
      setWebsiteAnalysisError('No hay URL de sitio web disponible. Puedes saltar este paso.');
      return;
    }

    setIsLoading(true);
    setLoadingStatus('Analizando sitio web del cliente...');
    try {
      addLog(`🔍 Analizando web: ${websiteUrl}`);
      const ctx = await analyzeWebsite(websiteUrl, keyword, businessName, contentLanguage);
      setContentContext(ctx);
      contentContextRef.current = ctx;
      addLog('✅ Análisis web completado');
    } catch (e: any) {
      setWebsiteAnalysisError(`Error en análisis: ${e.message}`);
      addLog(`⚠️ Análisis web falló: ${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const startWriting = async (articleToUse?: Partial<Article>, websiteUrl?: string | null): Promise<Partial<Article>> => {
    setIsLoading(true);

    try {
      // Usar el artículo pasado como parámetro o el del estado
      let currentArticle = articleToUse || article;
      // Usar el website pasado como parámetro, o el ref (síncrono), o el estado React
      const currentWebsite = websiteUrl !== undefined ? websiteUrl : (clientWebsiteRef.current ?? clientWebsite);
      addLog(`🌐 currentWebsite en startWriting: ${currentWebsite || '(sin web)'}`);
      
      // 🚨 LOGEAR el estado que se usará en este paso (para diagnóstico de discrepancias)
      console.log('[startWriting] article state at entry:', currentArticle);
      addLog('[startWriting] Ver consola para estado del artículo');

      // 🚨 ASEGURAR que currentArticle siempre tiene primaryKeywords
      if (!currentArticle.primaryKeywords || currentArticle.primaryKeywords.length === 0) {
        addLog("🚨 primaryKeywords vacíos. Usando keywords del estado global...");
        currentArticle = {
          ...currentArticle,
          primaryKeywords: keywords && keywords.length > 0 ? keywords : ['artículo']
        };
      }
      
      let sections = [...(currentArticle.sections || [])];

      // Validación: cada sección debe tener título
      if (sections.some(s => !s.title || s.title.trim().length === 0)) {
        console.error('[startWriting] sección con título vacío detectada', sections);
        addLog('⚠️ Hay una o más secciones sin título. Revisa la Arquitectura de Contenidos.');
        throw new Error('Error: una sección del artículo no tiene título. Corrige la estructura antes de redactar.');
      }

      // 🛑 NOVA: no generar fallback dinámico silencioso; si no hay secciones, abortar y avisar
      if (sections.length === 0) {
        console.error('[startWriting] sección VACÍA: no se generarán contenidos de fallback');
        addLog('⚠️ No hay secciones en el artículo. Por favor genera la estructura antes de redactar.');
        throw new Error('No hay secciones para redactar. El artículo está vacío o perdió sus H2. Regenera la estructura.');
      }

      // Mantener el antiguo comportamiento solo para desarrollo interno (no usado en producción)
      /*
      if (sections.length === 0) {
        // intentar generar un fallback si tenemos keywords
        const kws = currentArticle.primaryKeywords || keywords;
        if (kws && kws.length > 0) {
          addLog("⚠️ No se encontraron secciones, generando fallback dinámico...");
          sections = generateFallbackSections(kws);
          // evitar preguntas consecutivas con el título del artículo
          {
            const baseTitle = currentArticle.title || "";
            let last = baseTitle;
            sections = sections.map(s => {
              const clean = sanitizeTitle(s.title, last);
              last = clean;
              return { ...s, title: clean };
            });
          }
          setArticle(prev => ({ ...prev, sections }));
        }
      }

      if (sections.length === 0) {
        alert("No hay secciones para redactar. Primero genera la estructura del artículo (outline).\nRevisa tus keywords o el brief.");
        throw new Error("No hay secciones para redactar. El artículo está vacío.");
      }
      */
      
      addLog(`📝 Redactando ${sections.length} secciones del artículo...`);
      
      if (currentWebsite) {
        addLog(`🌐 Website del cliente: ${currentWebsite}`);
      }

      // 1️⃣ Generar contenido de cada sección
      for (let i = 0; i < sections.length; i++) {
        setLoadingStatus(`Redactando sección ${i + 1}/${sections.length}...`);
        const contentLanguage = communicationLanguageRef.current || communicationLanguage;

        const rawContent = await generateSectionContent(
          sections[i],
          currentArticle.title || "",
          undefined,
          contentLanguage,
          contentTypeRef.current || 'on_blog',
          undefined,
          undefined,
          undefined,
          undefined,
          contentContextRef.current || contentContext || undefined
        );

        // ✅ APLICAR MEJORA DE LEGIBILIDAD (Flesch-Kincaid > 60)
        let readableContent = improveReadability(rawContent, contentLanguage);
        // ✅ Corrección lingüística según idioma detectado
        try {
          readableContent = await polishText(readableContent, contentLanguage);
          addLog(`✍️ Corrección ortográfica/gramatical aplicada (${formatLanguageLabel(contentLanguage)}).`);
        } catch (langEx) {
          addLog(`⚠️ No se pudo aplicar corrección lingüística: ${(langEx as Error).message}`);
        }
        // ✅ No se aplica polishText — generateSectionContent ya devuelve HTML estructurado
        // limpio desde JSON. polishText destruye las listas <ul><li> convirtiéndolas a prosa.
        readableContent = stripBusinessNameMentions(readableContent, clientBusinessNameRef.current || clientBusinessName || undefined);
        sections[i].content = readableContent;

        if (!sections[i].id) {
          sections[i].id = `section-${i + 1}`;
        }

        addLog(`H2 "${sections[i].title}" finalizado (legibilidad optimizada).`);
        await wait(200);
      }

      // 🔗 2️⃣ INSERCIÓN DE ENLACES INTERNOS (SOLO SI EL CLIENTE TIENE WEB)
      let finalSections = sections;
      
      if (currentWebsite) {
        // ✅ CLIENTE TIENE WEB: intentar insertar hasta 3 enlaces
        setLoadingStatus("Generando enlaces internos...");
        addLog("🔗 Generando enlaces internos estándar del cliente...");

        const internalLinks = generateClientInternalLinks(currentWebsite);

        if (internalLinks.length === 0) {
          addLog(`⚠️ No se pudieron generar enlaces: dominio inválido "${currentWebsite}". Publicando sin enlaces.`);
        } else {
        
        addLog(`✅ Enlaces generados:`);
        internalLinks.forEach((link, i) => {
          addLog(`  ${i + 1}. ${link}`);
        });

        setLoadingStatus("Insertando enlaces en el contenido...");
        addLog("🔗 Insertando 3 enlaces obligatorios en el artículo...");

        finalSections = insertInternalLinksIntoSections(
          sections.map(s => ({ ...s, content: s.content })),
          internalLinks
        );

        // 🔍 VERIFICACIÓN ESTRICTA
        let totalLinksInserted = 0;
        finalSections.forEach((section, idx) => {
          const linkMatches = section.content?.match(/<a\s+href=/g);
          const linksInSection = linkMatches ? linkMatches.length : 0;
          totalLinksInserted += linksInSection;
          
          if (linksInSection > 0) {
            console.log(`[Verificación] Sección ${idx}: ${linksInSection} enlaces`);
          }
        });

        addLog(`✅ Total: ${totalLinksInserted} enlaces insertados.`);
        
        // mostrar advertencia si no se lograron 3 enlaces
        if (totalLinksInserted < 3) {
          addLog(`⚠️ Solo se insertaron ${totalLinksInserted} enlaces internos. ` +
                 `No es obligatorio publicar, pero conviene revisar la estructura del contenido.`);
        }
        } // end internalLinks.length > 0
      } else {
        // ℹ️ CLIENTE SIN WEB: Continuar sin enlaces
        addLog("ℹ️ El cliente no tiene sitio web registrado.");
        addLog("✓ El artículo se publicará sin enlaces internos.");
      }

      // 4️⃣ GENERACIÓN DE IMAGEN (OBLIGATORIA)
      setLoadingStatus("Generando imagen editorial con IA...");
      addLog("Generando imagen editorial (obligatoria)...");

      // ── Construir contexto rico del artículo para el prompt de imagen ──
      const imageArticleTitle = (currentArticle.title || '').replace(/[¿?¡!]/g, '').trim();

      // Texto limpio de TODAS las secciones (sin HTML), hasta 800 chars de contexto real
      const allSectionsText = (finalSections || currentArticle.sections || [])
        .map(s => (s.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 800);

      // Títulos H2 del artículo como pistas visuales adicionales
      const sectionTitles = (finalSections || currentArticle.sections || [])
        .map(s => (s.title || '').replace(/[¿?¡!]/g, '').trim())
        .filter(Boolean)
        .join(', ');

      // Keyword principal limpia (sin palabras interrogativas ni ubicaciones)
      const activeKeyword = (keywords && keywords.length > 0 ? keywords[0] : '') ||
                            (currentArticle.primaryKeywords?.[0] || '');
      const visualSubject = activeKeyword
        .replace(/^(cómo|qué|cuál|cuándo|dónde|por qué|para qué|cuánto)\s+/i, '')
        .replace(/\s+(en\s+\w+)/gi, '')
        .trim() || activeKeyword;

      addLog(`🖼️ Keyword activa para imagen: "${activeKeyword}" → sujeto visual: "${visualSubject}"`);
      addLog(`🖼️ Título del artículo: "${imageArticleTitle}"`);

      const imagePromptParams = { articleTitle: imageArticleTitle, visualSubject, sectionTitles, allSectionsText };
      const imagePrompt = contentTypeRef.current === 'off_page'
        ? buildOffPageImagePrompt(imagePromptParams)
        : buildOnBlogImagePrompt(imagePromptParams);

      const MAX_IMAGE_ATTEMPTS = 3;
      let imageBase64: string | null = null;
      let lastImageError: any = null;

      for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
        try {
          addLog(`Intento ${attempt}/${MAX_IMAGE_ATTEMPTS} de generación de imagen`);

          const rawImage = await generateImage(imagePrompt);

          if (!rawImage) {
            throw new Error("La imagen no fue generada.");
          }

          setLoadingStatus("Normalizando imagen editorial...");
          const normalizedImage = await resizeImageTo1536x864(rawImage);

          imageBase64 = normalizedImage;
          addLog("✓ Imagen válida generada (1536x864)");
          break;

        } catch (err: any) {
          lastImageError = err;
          console.warn("⚠ Error generando imagen:", err);
          addLog(`⚠ Error imagen: ${err.message}`);
          await wait(800 * attempt);
        }
      }

      if (!imageBase64) {
        throw new Error(
          `No se pudo generar una imagen válida tras ${MAX_IMAGE_ATTEMPTS} intentos. Último error: ${lastImageError?.message}`
        );
      }

      // 5️⃣ CONSTRUIR ARTÍCULO COMPLETO
      // 🚨 ASEGURAR que siempre hay un título válido
      let articleTitle = (currentArticle.title || '').trim();
      
      if (!articleTitle && currentArticle.primaryKeywords && currentArticle.primaryKeywords.length > 0) {
        // Generar título fallback si falta
        articleTitle = `Guía completa sobre ${currentArticle.primaryKeywords[0]}`;
        addLog(`⚠️ Título vacío detectado. Generando fallback: "${articleTitle}"`);
      }
      
      if (!articleTitle) {
        articleTitle = `Artículo SEO - ${new Date().toLocaleDateString()}`;
        addLog(`⚠️ Sin keywords disponibles. Usando título por defecto: "${articleTitle}"`);
      }
      
      // Generar metaTitle y metaDescription si faltan
      let metaTitleFinal = (currentArticle.metaTitle || '').trim();
      if (!metaTitleFinal) {
        metaTitleFinal = smartTruncate(articleTitle, 65);
        addLog(`⚠️ MetaTitle vacío. Usando: "${metaTitleFinal}"`);
      }
      // si no incluye la keyword, añádela al final dentro del límite
      const primaryKw = currentArticle.primaryKeywords?.[0] || '';
      if (primaryKw && !metaTitleFinal.toLowerCase().includes(primaryKw.toLowerCase())) {
        const candidate = `${metaTitleFinal} - ${primaryKw}`;
        metaTitleFinal = candidate.length <= 60 ? candidate : metaTitleFinal;
      }
      
      let metaDescriptionFinal = (currentArticle.metaDescription || '').trim();
      if (!metaDescriptionFinal) {
        // Generar meta description desde la primera sección
        if (finalSections && finalSections.length > 0) {
          const firstContent = finalSections[0].content?.replace(/<[^>]+>/g, '') || '';
          metaDescriptionFinal = smartTruncate(firstContent, 160);
        } else {
          metaDescriptionFinal = `${articleTitle}. Artículo SEO de calidad`;
        }
        addLog(`⚠️ MetaDesc vacío. Generando: "${metaDescriptionFinal.substring(0, 80)}..."`);
      }

      // Garantizar que la introducción nunca llega vacía al artículo final
      const _introLang = communicationLanguageRef.current || communicationLanguage;
      let finalIntroduction = (currentArticle.introduction && currentArticle.introduction.trim().length > 0)
        ? currentArticle.introduction.trim()
        : _introLang === 'english'
          ? `${articleTitle} provides clear solutions about ${keywords[0]}. Here you will find useful and practical information to make the best decision with confidence.`
          : `${clientBusinessNameRef.current || articleTitle} ofrece soluciones claras sobre ${keywords[0]}. Aquí encontrarás información útil y práctica para tomar la mejor decisión con confianza.`;
      // aplicar limpieza y mejora de legibilidad a la intro también
      finalIntroduction = cleanIntroductionText(finalIntroduction);
      finalIntroduction = improveReadability(finalIntroduction, communicationLanguageRef.current || communicationLanguage);
      
      addLog(`📝 Introducción final: "${finalIntroduction.slice(0, 80)}..."`);

      const completeArticle: Partial<Article> = {
        title: articleTitle,
        introduction: finalIntroduction,
        sections: finalSections,
        primaryKeywords: currentArticle.primaryKeywords,
        metaTitle: smartTruncate(metaTitleFinal, 65),
        metaDescription: smartTruncate(metaDescriptionFinal, 160),
        featuredImage: {
          prompt: imagePrompt,
          size: "1536x864",
          altText: `${articleTitle} - ${keywords[0]}`,
          base64: imageBase64,
        },
      };

      addLog("✓ Imagen editorial final aceptada.");
      
      if (currentWebsite) {
        addLog(`✅ Artículo completo: 3 enlaces internos + imagen 1536×864 + legibilidad optimizada`);
      } else {
        addLog(`✅ Artículo completo: imagen 1536×864 + legibilidad optimizada (sin enlaces internos)`);
      }

      // 6️⃣ ACTUALIZAR STATE (para UI)
      setArticle(completeArticle);
      setStep(AppStep.WRITING);

      // 7️⃣ RETORNAR EL ARTÍCULO COMPLETO
      return completeArticle;

    } catch (e: any) {
      console.error("❌ Error crítico en startWriting:", e);
      addLog(`❌ Error crítico: ${e.message}`);
      alert(`Proceso detenido:\n\n${e.message}`);
      throw e;
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // 🗺️ GENERACIÓN GMB — flujo específico para Google My Business
  const startWritingGmb = async (kwsToUse?: string[]): Promise<Partial<Article>> => {
    setIsLoading(true);
    setLoadingStatus("Generando publicación GMB...");

    try {
      const activeKeywords = kwsToUse || keywords;
      const mainKeyword = activeKeywords[0] || '';
      const contentLanguage = communicationLanguageRef.current || communicationLanguage;
      const lang = resolveLanguageProfile(contentLanguage);

      addLog(`🗺️ Iniciando generación GMB para: "${mainKeyword}" (${lang.nameEn})`);

      // 1️⃣ Generar texto GMB
      setLoadingStatus("IA redactando publicación GMB...");
      const gmbCtx = contentContextRef.current;
      const gmbPost: GmbPost = await generateGmbPost({
        language: lang.nameEn,
        mainKeyword,
        secondaryKeywords: activeKeywords.slice(1),
        businessCategory: clientCompanyCategoryRef.current,
        location: clientWebsiteRef.current ? undefined : undefined,
        tone: gmbCtx?.writing_tone || 'cercano',
        grammaticalSubject: gmbCtx?.grammatical_subject || 'yo a tú / nosotros a tú',
      });

      addLog(`✅ Texto GMB generado: "${gmbPost.title}"`);

      // 2️⃣ Generar imagen GMB (4:3, sin validación 16:9)
      setLoadingStatus("Generando imagen GMB...");
      const gmbImagePrompt = buildGmbImagePromptFn({
        mainKeyword,
        postType: 'update',
        postIntent: 'inform / attract visits',
      });

      let imageBase64: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          addLog(`🖼️ Intento ${attempt}/3 de imagen GMB...`);
          const raw = await generateImageRaw(gmbImagePrompt);
          if (!raw) throw new Error("Imagen vacía");
          setLoadingStatus("Normalizando imagen GMB (4:3)...");
          imageBase64 = await resizeImageTo1200x900(raw);
          addLog("✅ Imagen GMB generada (1200×900)");
          break;
        } catch (err: any) {
          addLog(`⚠️ Error imagen GMB intento ${attempt}: ${err.message}`);
          await wait(800 * attempt);
        }
      }
      if (!imageBase64) {
        throw new Error("No se pudo generar la imagen GMB tras 3 intentos");
      }

      // 3️⃣ Guardar GmbPost (con imagen) en ref + state para UI y publish
      const gmbPostWithImage: GmbPost = { ...gmbPost, image: imageBase64 };
      gmbPostDataRef.current = gmbPostWithImage;
      setGmbPostData(gmbPostWithImage);

      // Article mínimo: solo para metadatos y featuredImage (publish lo usa)
      const completeArticle: Partial<Article> = {
        title: gmbPost.title,
        metaTitle: smartTruncate(gmbPost.title, 65),
        metaDescription: smartTruncate(gmbPost.description.replace(/<[^>]+>/g, ''), 160),
        primaryKeywords: activeKeywords,
        secondaryKeywords: activeKeywords.slice(1),
        sections: [],
        contentType: 'gmb',
        featuredImage: {
          prompt: gmbImagePrompt,
          size: '1200x900',
          altText: `${gmbPost.title} - ${mainKeyword}`,
          base64: imageBase64,
        },
      };

      setArticle(completeArticle);
      setStep(AppStep.WRITING);
      addLog("✅ Publicación GMB lista para revisar y publicar");
      return completeArticle;

    } catch (e: any) {
      addLog(`❌ Error GMB: ${e.message}`);
      alert(`Error generando publicación GMB:\n\n${e.message}`);
      throw e;
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // 🎯 Determina el destino de publicación según el tipo de contenido
  const resolvePublishingTarget = (ct: ContentType | null, language: CommunicationLanguage) => {
    const type = ct || 'on_blog';
    // off_page: inglés → wall-trends, español → aleatorio entre los 3 portales externos
    if (type === 'off_page') {
      if (isEnglishLanguage(language)) {
        return [{ domain: wpDomainEnglish, token: wpJwtTokenEnglish, label: 'wall-trends.com' }];
      }
      return [
        { domain: wpDomain, token: wpJwtToken, label: 'cienciacronica.com' },
        { domain: wpDomainSite3, token: wpJwtTokenSite3, label: 'laprensa360.com' },
        { domain: wpDomainSite2, token: wpJwtTokenSite2, label: 'elinformedigital.com' },
      ];
    }
    // on_blog y gmb (cualquier idioma) → masproposals.com
    return [{ domain: wpDomainSite5, token: wpJwtTokenSite5, label: 'masproposals.com' }];
  };

  const publish = async (
    articleToPublish?: Partial<Article>,
    forcedTarget?: { domain: string; token: string; label: string },
    wpPostId?: number   // si se pasa, actualiza el post existente (PUT) en lugar de crear uno nuevo
  ): Promise<{ success: boolean; msg: string; url?: string }> => {
    setIsPublishing(true);
    setPublishResult(null);
    setProdlineUuidInput('');
    setProdlineSubmitStatus('idle');
    setProdlineSubmitMsg('');
    const currentLanguage = communicationLanguageRef.current || communicationLanguage;
    const wpTargets = resolvePublishingTarget(contentTypeRef.current, currentLanguage);
    const validWpTargets = wpTargets.filter(target => Boolean(target.domain && target.token));

    if (validWpTargets.length === 0) {
      setIsPublishing(false);
      throw new Error('No hay configuracion valida de WordPress. Revisa dominios y tokens en .env');
    }

    // Para off_page con múltiples portales: rotar en orden en vez de aleatorio
    // (garantiza distribución equitativa entre cienciacronica, laprensa360, elinformedigital)
    let selectedTarget: typeof validWpTargets[0];
    if (forcedTarget) {
      selectedTarget = forcedTarget;
    } else if (validWpTargets.length > 1 && contentTypeRef.current === 'off_page') {
      selectedTarget = validWpTargets[offPagePortalIndexRef.current % validWpTargets.length];
      offPagePortalIndexRef.current += 1;
    } else {
      selectedTarget = validWpTargets[Math.floor(Math.random() * validWpTargets.length)];
    }
    const WP_DOMAIN = selectedTarget.domain;
    const rawToken = selectedTarget.token.trim();
    const WP_TOKEN = /^Bearer\s+/i.test(rawToken) ? rawToken : `Bearer ${rawToken}`;
    addLog(`🎯 Destino ${forcedTarget ? 'forzado (fallback)' : 'aleatorio'} seleccionado: ${selectedTarget.label}`);
    addLog(`🗣️ Idioma detectado para publicación: ${formatLanguageLabel(currentLanguage)}`);
    
    // Usar el artículo pasado como parámetro o el del estado
    const currentArticle = articleToPublish || article;
    // sitio web del cliente (se usa para condicionar H1 y enlaces internos)
    const currentWebsite = clientWebsite;
    
    try {
      const isGmb = contentTypeRef.current === 'gmb';
      // verificar que hay secciones listas (evita posts vacíos) — GMB no usa secciones
      if (!isGmb && (!currentArticle.sections || currentArticle.sections.length === 0)) {
        throw new Error("No hay secciones en el artículo. Genera el contenido antes de publicar.");
      }
      let featuredMediaId: number | null = null;

      // 1. Si hay imagen generada, subirla primero
      if (currentArticle.featuredImage && typeof currentArticle.featuredImage === 'object' && currentArticle.featuredImage.base64) {
        setLoadingStatus("Subiendo imagen a la web...");
        featuredMediaId = await uploadImageToWP(
          currentArticle.featuredImage.base64, 
          (articleToPublish?.title || article.title || "SEO Article Image").trim(), 
          WP_TOKEN,
          WP_DOMAIN
        );
      }

      // 2. Obtener el ID de la categoría WordPress
      setLoadingStatus("Obteniendo categorías de WordPress...");
      addLog("Buscando categoría según brief y catálogo del repositorio...");

      const catalogKey = selectedTarget.label;
      const allowedCategories = WP_CATEGORY_CATALOG[catalogKey] || [];
      let aiSelectedCategory: string | null = null;
      if (allowedCategories.length > 0) {
        try {
          aiSelectedCategory = await pickBestWordPressCategory({
            repository: catalogKey,
            companyCategory: clientCompanyCategoryRef.current,
            companySubcategory: clientCompanySubcategoryRef.current,
            articleTitle: currentArticle.title || '',
            primaryKeyword: currentArticle.primaryKeywords?.[0] || keywords[0] || '',
            allowedCategories,
          });
          if (aiSelectedCategory) {
            addLog(`🤖 IA seleccionó categoría objetivo: ${aiSelectedCategory}`);
          }
        } catch (catEx) {
          addLog(`⚠️ IA categoría falló: ${(catEx as Error).message}`);
        }
      }
      
      const categoriesResponse = await fetch(
        `${WP_DOMAIN}/wp-json/wp/v2/categories?per_page=100`,
        {
          headers: { 'Authorization': WP_TOKEN }
        }
      );

      let categoryId: number | undefined;

      if (categoriesResponse.ok) {
        const categories = await categoriesResponse.json();
        addLog(`📋 WP devolvió ${categories.length} categorías: ${categories.map((c: any) => c.name).join(', ')}`);

        const normalize = (s: string) =>
          (s || '')
            .replace(/&amp;/g, '&')
            .replace(/&#038;/g, '&')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        const siteDefaultCategory = catalogKey === 'wall-trends.com' ? 'Sin categoría' : 'SEO On page - Blog';

        // Mapa de traducción español → inglés para wall-trends
        const wallTrendsCategoryMap: Record<string, string> = {
          // Arquitectura
          'arquitectura': 'Architecture',
          // Arte
          'arte': 'Art, Design & Photography',
          'arte, diseño y fotografía': 'Art, Design & Photography',
          'arte y diseño': 'Art, Design & Photography',
          'diseño': 'Art, Design & Photography',
          'fotografía': 'Art, Design & Photography',
          // Negocios
          'negocios y emprendimiento': 'Business & Entrepreneurship',
          'negocios': 'Business & Entrepreneurship',
          'emprendimiento': 'Business & Entrepreneurship',
          // Ropa
          'ropa': 'Clothing',
          'clother': 'Clothing',
          // Cosmética
          'cosmética y belleza': 'Cosmetics & Beauty',
          'cosmética': 'Cosmetics & Beauty',
          'belleza': 'Cosmetics & Beauty',
          // Cocina
          'cocina, gastronomía y restauración': 'Cuisine, Gastronomy & Restaurants',
          'cocina': 'Cuisine, Gastronomy & Restaurants',
          'gastronomía': 'Cuisine, Gastronomy & Restaurants',
          'restauración': 'Cuisine, Gastronomy & Restaurants',
          // Dating
          'dating y amor': 'Dating & Love',
          'dating': 'Dating & Love',
          'amor': 'Dating & Love',
          // Decoración
          'decoración e interiorismo': 'Decoration & Interior Design',
          'decoración': 'Decoration & Interior Design',
          'interiorismo': 'Decoration & Interior Design',
          // Economía
          'economía': 'Economy',
          // Educación
          'educación': 'Education',
          // Ingeniería
          'ingeniería y tecnología': 'Engineering & Technology',
          'ingeniería': 'Engineering & Technology',
          'tecnología': 'Engineering & Technology',
          // Entretenimiento
          'entretenimiento': 'Entertainment',
          // Erotismo
          'erotismo y sexualidad': 'Eroticism & Sexuality',
          'erotismo': 'Eroticism & Sexuality',
          // Moda
          'moda e imagen': 'Fashion & Image',
          'moda': 'Fashion & Image',
          'imagen': 'Fashion & Image',
          // Salud
          'salud': 'Health',
          // Hogar
          'hogar': 'Home & Living',
          // Innovación
          'innovación y sostenibilidad': 'Innovation & Sustainability',
          'innovación': 'Innovation & Sustainability',
          'sostenibilidad': 'Innovation & Sustainability',
          // Legal
          'legal, asesorías y abogados': 'Legal, Consulting & Law Firms',
          'legal': 'Legal, Consulting & Law Firms',
          'asesorías': 'Legal, Consulting & Law Firms',
          'abogados': 'Legal, Consulting & Law Firms',
          // Marketing
          'marketing y publicidad': 'Marketing & Advertising',
          'marketing': 'Marketing & Advertising',
          'publicidad': 'Marketing & Advertising',
          // Maternidad
          'maternidad y bebés': 'Motherhood & Babies',
          'maternidad': 'Motherhood & Babies',
          'bebés': 'Motherhood & Babies',
          // Motores
          'motores': 'Motors',
          // Mascotas
          'mascotas': 'Pets',
          // Inmobiliaria
          'inmobiliaria': 'Real Estate',
          // Deportes
          'deportes y recreación': 'Sports & Recreation',
          'deportes': 'Sports & Recreation',
          // Turismo
          'turismo': 'Tourism',
          'turismo y viajes': 'Tourism',
          // TV
          'tv, cine y música': 'TV, Cinema & Music',
          'tv': 'TV, Cinema & Music',
          'cine': 'TV, Cinema & Music',
          'música': 'TV, Cinema & Music',
          // Bodas
          'bodas y relaciones de pareja': 'Weddings & Relationships',
          'bodas': 'Weddings & Relationships',
          'relaciones de pareja': 'Weddings & Relationships',
          // Bienestar
          'bienestar y relajación': 'Wellness & Relaxation',
          'bienestar': 'Wellness & Relaxation',
          'relajación': 'Wellness & Relaxation',
          // Organización de eventos
          'organización de eventos': 'Art, Design & Photography',
          'eventos': 'Entertainment',
          // GrowShop
          'cannabis y growshop': 'GrowShop',
          'growshop': 'GrowShop',
        };

        // Traduce una categoría del brief al inglés si estamos en wall-trends
        const translateForWallTrends = (val: string | null): string | null => {
          if (!val || catalogKey !== 'wall-trends.com') return val;
          const norm = (val || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          return wallTrendsCategoryMap[norm] || val;
        };

        // GMB posts always go to the dedicated GMB category, bypassing AI selection
        if (isGmb) {
          aiSelectedCategory = 'GMB - Artículos';
        }

        const desiredNames = isGmb
          ? ['GMB - Artículos']
          : [
              aiSelectedCategory,
              translateForWallTrends(clientCompanySubcategoryRef.current),
              translateForWallTrends(clientCompanyCategoryRef.current),
              siteDefaultCategory,
            ].filter((v): v is string => Boolean(v && v.trim().length > 0));

        addLog(`🔍 Buscando en orden: ${desiredNames.join(' → ')}`);

        let targetCategory: any | undefined;
        for (const wanted of desiredNames) {
          const wantedNorm = normalize(wanted);
          targetCategory = categories.find((cat: any) => normalize(cat.name) === wantedNorm)
            || categories.find((cat: any) => normalize(cat.name).includes(wantedNorm))
            || categories.find((cat: any) => wantedNorm.includes(normalize(cat.name)) && normalize(cat.name).length > 4);
          if (targetCategory) {
            addLog(`✓ Categoría elegida: "${targetCategory.name}" (ID ${targetCategory.id})`);
            break;
          }
        }

        if (targetCategory) {
          categoryId = targetCategory.id;
        } else {
          // Fallback explícito: buscar "Sin categoría" o "Uncategorized" directamente en WP
          const fallback = categories.find((cat: any) => normalize(cat.name) === 'sin categoria')
            || categories.find((cat: any) => cat.slug === 'uncategorized')
            || categories.find((cat: any) => cat.id === 1);
          if (fallback) {
            categoryId = fallback.id;
            addLog(`⚠️ Sin match por brief. Fallback a: "${fallback.name}" (ID ${categoryId})`);
          } else {
            addLog("⚠️ No se encontró ninguna categoría válida.");
          }
        }
      } else {
        addLog(`❌ Error obteniendo categorías WP: ${categoriesResponse.status} ${categoriesResponse.statusText}`);
      }

      setLoadingStatus("Publicando artículo en WordPress...");

      // 3. Construir título y meta con defensas ante undefined
      // currentArticle = articleToPublish ?? article (ya resuelto arriba)
      let safeTitle = (currentArticle.title || '').trim();
      
      // 🚨 FALLBACK ADICIONAL: Si el título sigue vacío, generar uno
      if (!safeTitle) {
        if (currentArticle.primaryKeywords && currentArticle.primaryKeywords.length > 0) {
          safeTitle = `Guía sobre ${currentArticle.primaryKeywords[0]}`;
        } else if (currentArticle.sections && currentArticle.sections.length > 0) {
          safeTitle = currentArticle.sections[0].title || `Artículo SEO - ${new Date().toLocaleDateString()}`;
        } else {
          safeTitle = `Artículo - ${new Date().toLocaleDateString()}`;
        }
        addLog(`🚨 Título vacío en publish. Generando: "${safeTitle}"`);
      }
      safeTitle = toSentenceCase(safeTitle);
      const isLaPrensa = selectedTarget.label === 'laprensa360.com';
      
      let metaTitle = (currentArticle.metaTitle || safeTitle).trim();
      if (!metaTitle) metaTitle = safeTitle;
      if (isLaPrensa) {
        // Evita duplicar sufijos del sitio que SmartCrawl agrega por plantilla.
        metaTitle = metaTitle
          .replace(/\s*[\-|–—]\s*la\s*prensa\s*360\s*$/i, '')
          .trim();
      }
      metaTitle = toSentenceCase(metaTitle);
      // La Prensa suele añadir " - La Prensa 360" en el snippet final.
      // Reservamos espacio para mantener la recomendación 50-65 chars en SERP.
      const maxMetaTitleLength = isLaPrensa ? 50 : 65;
      metaTitle = smartTruncate(metaTitle, maxMetaTitleLength);
      if (isLaPrensa) {
        addLog(`📰 Regla La Prensa aplicada: metaTitle ajustado a ${maxMetaTitleLength} caracteres max.`);
      }
      
      let metaDescription = (currentArticle.metaDescription || '').trim();
      if (!metaDescription) {
        // Generar desde primera sección
        if (currentArticle.sections && currentArticle.sections.length > 0) {
          const firstContent = currentArticle.sections[0].content?.replace(/<[^>]+>/g, '') || '';
          metaDescription = smartTruncate(firstContent, 160) || 'Artículo SEO de alta calidad';
        } else {
          metaDescription = `${safeTitle}. Contenido SEO optimizado`;
        }
      }
      metaDescription = smartTruncate(metaDescription, 160);

      addLog(`📋 Título a publicar: "${safeTitle}"`);
      addLog(`📋 MetaTitle SEO: "${metaTitle}"`);
      addLog(`📋 MetaDesc SEO: "${metaDescription.slice(0, 80)}..."`);

      const smartCrawlMetaPayloads: Array<{ label: string; meta: Record<string, string> }> = [
        {
          label: 'SmartCrawl (public)',
          meta: {
            wds_title: metaTitle,
            wds_metadesc: metaDescription,
          },
        },
        {
          label: 'SmartCrawl (private)',
          meta: {
            _wds_title: metaTitle,
            _wds_metadesc: metaDescription,
          },
        },
        {
          label: 'SmartCrawl (combined)',
          meta: {
            wds_title: metaTitle,
            wds_metadesc: metaDescription,
            _wds_title: metaTitle,
            _wds_metadesc: metaDescription,
          },
        },
      ];

      const buildSmartCrawlBody = (metaPayload: Record<string, string>) => {
        const titleValue = metaPayload._wds_title || metaPayload.wds_title || metaTitle;
        const descValue = metaPayload._wds_metadesc || metaPayload.wds_metadesc || metaDescription;
        return {
          // REST meta path (si está registrado con show_in_rest)
          meta: metaPayload,
          // SmartCrawl usa estas llaves en flujos internos de admin
          wds_title: titleValue,
          wds_description: descValue,
          wds_metadesc: descValue,
        };
      };

      if (!safeTitle) {
        throw new Error("El artículo no tiene título. Regenera el outline antes de publicar.");
      }


      // build body — GMB y artículos SEO tienen rutas distintas
      let articleContent = "";
      const clientName = clientBusinessNameRef.current || '';

      if (isGmb) {
        // 🗺️ Ruta GMB: montar HTML desde gmbPostDataRef (sin H2, sin validación estructural)
        const gmb = gmbPostDataRef.current;
        if (!gmb) {
          throw new Error("No hay datos de publicación GMB. Genera el post antes de publicar.");
        }
        const desc = stripBusinessNameMentions(gmb.description, clientName);
        articleContent += `<p>${desc}</p>`;
        if (gmb.information) {
          const info = stripBusinessNameMentions(gmb.information, clientName);
          articleContent += `<p>${info}</p>`;
        }
        const cta = stripBusinessNameMentions(gmb.cta, clientName);
        articleContent += `<p class="gmb-cta">${cta}</p>`;
        const buttonUrl = currentWebsite || clientWebsiteRef.current || '';
        if (!buttonUrl) addLog('⚠️ GMB: URL del cliente no disponible — botón publicado sin enlace');
        else addLog(`🔗 GMB: botón CTA enlazará a ${buttonUrl}`);
        articleContent += `<p><a href="${buttonUrl}" class="gmb-button">${gmb.button}</a></p>`;
        addLog(`📝 Contenido GMB listo para enviar (${articleContent.length} chars)`);
      } else {
        // 📰 Ruta artículo SEO: intro + secciones + numeración H2 + validación
        addLog(`📝 Introducción (preview): "${(currentArticle.introduction || '').slice(0, 80)}..."`);
        try {
          console.log('[Publish] article object before build:', JSON.stringify(currentArticle, null, 2));
          addLog('[Publish] article object (ver consola para detalle)');
        } catch (err) {
          console.log('[Publish] Could not stringify article object');
        }

        // 1) El tema de WP ya mostrará <h1> a partir de post.title.
        // No agregamos un <h1> manualmente para evitar duplicados en el frontend.
        // (antes se forzaba, pero causaba repetición en masproposals.com)

        // 2) Insertar la introducción EXACTA que está en el preview (sin alterarla)
        let introRaw = (currentArticle.introduction || '').trim();
        if (clientName) {
          introRaw = stripBusinessNameMentions(introRaw, clientName);
        }
        if (introRaw) {
          introRaw = introRaw.replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, '').trim();
          articleContent += `<p>${introRaw}</p>`;
          if (clientName) {
            articleContent = stripBusinessNameMentions(articleContent, clientName);
          }
        } else {
          addLog(`⚠️ Introducción vacía en preview — usando fallback`);
          const fallbackIntro = currentArticle.title
            ? `Este artículo explica ${currentArticle.title.replace(/<[^>]+>/g, '')}.`
            : "";
          if (fallbackIntro) articleContent += `<p>${fallbackIntro}</p>`;
        }

        // 3) Añadir secciones: mantener los H2 tal como en el preview
        const seen = new Set<string>();
        const uniqueSections = (currentArticle.sections || []).filter(s => {
          if (seen.has(s.title)) return false;
          seen.add(s.title);
          return true;
        });

        const stripToParagraphs = (html: string) => {
          if (!html) return "";
          const blocks = html.match(/<p>[\s\S]*?<\/p>|<ul>[\s\S]*?<\/ul>/gi);
          if (blocks && blocks.length > 0) {
            return blocks.join('');
          }
          const text = html.replace(/<[^>]+>/g, '').trim();
          return text ? `<p>${text}</p>` : '';
        };

        articleContent += uniqueSections
          .map(s => {
            const titleClean = (s.title || '').replace(/<[^>]+>/g, '').trim();
            const contentOnlyParas = stripBusinessNameMentions(stripToParagraphs(s.content || ''), clientName);
            return `<h2>${titleClean}</h2>${contentOnlyParas}`;
          })
          .join('');

        console.log("[Publish] final articleContent:", articleContent);
        addLog(`📝 Contenido listo para enviar (longitud ${articleContent.length} chars)`);

        // 🔢 NUMERACIÓN JERÁRQUICA
        {
          let h2Idx = 0;
          articleContent = articleContent.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
            (_m: string, attrs: string, title: string) => {
              h2Idx++;
              const clean = title.replace(/<[^>]+>/g, '').trim();
              return `<h2${attrs}>${h2Idx}. ${clean}</h2>`;
            }
          );
          let curH2 = 0;
          let curH3 = 0;
          articleContent = articleContent.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>|<h3([^>]*)>([\s\S]*?)<\/h3>/gi,
            (_m: string, h2a: string, h2t: string, h3a: string, h3t: string) => {
              if (h2t !== undefined) {
                const n = h2t.match(/^(\d+)\./);
                curH2 = n ? parseInt(n[1]) : curH2 + 1;
                curH3 = 0;
                return `<h2${h2a || ''}>${h2t}</h2>`;
              }
              curH3++;
              const clean = h3t.replace(/<[^>]+>/g, '').trim();
              return `<h3${h3a || ''}>${curH2}.${curH3}. ${clean}</h3>`;
            }
          );
          addLog('🔢 Numeración aplicada');
        }

        // 🔒 VALIDACIÓN ESTRUCTURAL (solo artículos SEO)
        const h1count = (articleContent.match(/<h1>/g) || []).length;
        const h2count = (articleContent.match(/<h2>/g) || []).length;
        if (h1count > 1) {
          console.error('[Publish] Validación fallida: H1 count =', h1count);
          throw new Error(`Validación interna: se esperaba como máximo 1 H1 en el contenido, pero se encontraron ${h1count}`);
        }
        if (h2count !== 4) {
          console.error('[Publish] Validación fallida: H2 count =', h2count);
          throw new Error(`Validación interna: se esperaban 4 H2s en el contenido, pero se encontraron ${h2count}`);
        }
      }

      const wpPostEndpointUrl = wpPostId
        ? `${WP_DOMAIN}/wp-json/wp/v2/posts/${wpPostId}`
        : `${WP_DOMAIN}/wp-json/wp/v2/posts`;
      const response = await fetch(wpPostEndpointUrl, {
        method: wpPostId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': WP_TOKEN },
        body: JSON.stringify({
          title: safeTitle,           // Usar el título visible en la UI como H1 publicado
          content: articleContent,    // No incluir <h1>; WP usará el título como encabezado
          excerpt: metaDescription,
          status: 'publish',
          featured_media: featuredMediaId || undefined,
          categories: categoryId ? [categoryId] : [],
          // Intento inicial: algunos sitios SmartCrawl aceptan meta en el POST original.
          ...buildSmartCrawlBody(smartCrawlMetaPayloads[2].meta),
        })
      });
      if (wpPostId) addLog(`🔄 Modo actualización: PUT sobre post ID ${wpPostId}`);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Error publicando en WordPress");
      }

      const post = await response.json();

      // ── Inyectar meta SEO en SmartCrawl ──────────────────────────────────────
      // Priorizamos claves públicas y dejamos fallback a claves privadas.
      if (post.id) {
        const postEndpoint = `${WP_DOMAIN.replace(/\/+$/, '')}/wp-json/wp/v2/posts/${post.id}`;

        const verifySmartCrawlMeta = async () => {
          try {
            const verifyResponse = await fetch(
              `${postEndpoint}?context=edit&_fields=meta`,
              { headers: { 'Authorization': WP_TOKEN } }
            );

            if (!verifyResponse.ok) {
              addLog(`⚠️ No se pudo verificar meta SEO (HTTP ${verifyResponse.status}).`);
              return false;
            }

            const verifyData = await verifyResponse.json();
            const meta = verifyData?.meta || {};
            const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
            const titleOk = [meta.wds_title, meta._wds_title].some((v: unknown) => norm(v) === norm(metaTitle));
            const descOk = [meta.wds_metadesc, meta._wds_metadesc].some((v: unknown) => norm(v) === norm(metaDescription));
            return titleOk && descOk;
          } catch (verifyError: any) {
            addLog(`⚠️ Error verificando meta SEO: ${verifyError.message}`);
            return false;
          }
        };

        const injectMeta = async (attempt: number, pluginLabel: string, metaPayload: Record<string, string>) => {
          const putBody: any = buildSmartCrawlBody(metaPayload);
          // Forzar categoría en el mismo PUT para evitar que SmartCrawl la resetee
          if (categoryId) putBody.categories = [categoryId];

          const tryUpdate = async (method: 'PUT' | 'POST') => {
            const metaResponse = await fetch(postEndpoint, {
              method,
              headers: { 'Content-Type': 'application/json', 'Authorization': WP_TOKEN },
              body: JSON.stringify(putBody)
            });

            if (metaResponse.ok) {
              addLog(`✓ Meta SEO (${pluginLabel}) + categoría inyectados con ${method} (intento ${attempt}).`);
              return true;
            }

            let errMsg = `${metaResponse.status}`;
            try {
              const metaErr = await metaResponse.json();
              errMsg = metaErr?.message || errMsg;
            } catch {
              // no-op: keep status as message
            }
            addLog(`⚠️ Meta SEO ${pluginLabel} con ${method} falló (intento ${attempt}): ${errMsg}`);
            return false;
          };

          // En algunos hosts (como ciertos setups de La Prensa), PUT devuelve 200
          // pero no persiste meta. Si no persiste, reintentamos por POST.
          const putOk = await tryUpdate('PUT');
          if (putOk) return true;
          return await tryUpdate('POST');
        };

        try {
          addLog(`⏳ Esperando 3s antes de inyectar meta SEO...`);
          await new Promise(r => setTimeout(r, 3000));

          if (await verifySmartCrawlMeta()) {
            addLog('✅ Meta SEO SmartCrawl ya estaba persistida tras el POST inicial.');
          } else {
            let persisted = false;
            for (let i = 0; i < smartCrawlMetaPayloads.length; i++) {
              const payload = smartCrawlMetaPayloads[i];
              const ok = await injectMeta(i + 1, payload.label, payload.meta);
              if (!ok) {
                await new Promise(r => setTimeout(r, 600));
                continue;
              }

              await new Promise(r => setTimeout(r, 900));
              const verified = await verifySmartCrawlMeta();
              if (verified) {
                addLog(`✅ Meta SEO SmartCrawl verificada tras ${payload.label}.`);
                persisted = true;
                break;
              }
              addLog(`⚠️ ${payload.label} respondió OK, pero el valor no quedó guardado.`);
              await new Promise(r => setTimeout(r, 600));
            }

            if (!persisted) {
              if (selectedTarget.label === 'laprensa360.com') {
                addLog('⚠️ La Prensa: SmartCrawl no pudo persistir por REST/JWT. El artículo se publicó correctamente, pero los metadatos SEO (_wds_title/_wds_metadesc) requieren registro server-side con show_in_rest=true. Continúa el flujo.');
              } else {
                addLog('⚠️ SmartCrawl no persistió metadatos por REST API. Revisa register_post_meta(show_in_rest=true) para wds_title, wds_metadesc, _wds_title y _wds_metadesc.');
              }
            }
          }
        } catch (metaError: any) {
          addLog(`⚠️ No se pudo inyectar meta SEO al post: ${metaError.message}`);
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      const result = { 
        success: true, 
        msg: "¡Artículo publicado con imagen y categoría SEO!", 
        url: post.link 
      };
      
      setPublishResult(result);
      addLog(`✓ Publicación exitosa en ${WP_DOMAIN}`);
      
      if (currentArticle.sections?.some(s => s.content?.includes('<a href='))) {
        addLog(`✓ Enlaces internos: 3 incluidos`);
      } else {
        addLog(`ℹ️ Enlaces internos: 0 (cliente sin web)`);
      }
      
      return result; // Retornar el resultado
    } catch (e: any) {
      // Si falla por red/CORS en destino aleatorio, intentar automáticamente el otro sitio.
      if (!forcedTarget && validWpTargets.length > 1 && /Failed to fetch/i.test(String(e?.message || ''))) {
        const fallbackTarget = validWpTargets.find(t => t.domain !== WP_DOMAIN);
        if (fallbackTarget) {
          addLog(`⚠️ Fallo de red en ${selectedTarget.label}. Reintentando en ${fallbackTarget.label}...`);
          return await publish(articleToPublish, fallbackTarget);
        }
      }
      const errorResult = { success: false, msg: e.message };
      setPublishResult(errorResult);
      addLog(`❌ Fallo en publicación: ${e.message}`);
      return errorResult; // Retornar error
    } finally {
      setIsPublishing(false);
      setLoadingStatus("");
    }
  };

  // 🔄 Versión de proceedToOutline SIN cambio de step (para CSV)
  const proceedToOutlineCSV = async (kws: string[]): Promise<any> => {
    if (kws.length === 0) throw new Error("No hay keywords");
    
    const articleNumber = batchProgress.currentArticle || 1;
    const currentAccountUuid = batchProgress.currentAccountUuid;  // renombrado para evitar colisión con el estado global
    
    // 🧠 Obtener títulos previos de esta cuenta
    const previousTitles = currentAccountUuid ? (accountMemory[currentAccountUuid] || []) : [];
    
    addLog(`🧠 Verificando memoria: ${previousTitles.length} títulos previos en esta cuenta`);
    
    // 🎲 Agregar variación al prompt según el artículo actual
    const variationPrompts = [
      "on-page", // Artículo 1: enfoque estándar
      "comprehensive-guide", // Artículo 2: guía completa
      "quick-tips", // Artículo 3: tips rápidos
      "deep-dive", // Artículo 4+: análisis profundo
    ];
    
    const variationLabel = variationPrompts[Math.min(articleNumber - 1, variationPrompts.length - 1)];
    const outlineContentType = contentTypeRef.current || 'on_blog';

    addLog(`🎨 Generando artículo tipo: ${outlineContentType} (variación ${variationLabel} #${articleNumber})`);

    let topicForOutline = kws[0]; // El tema es siempre la keyword principal, nunca el nombre del negocio
    const contentLanguage = communicationLanguageRef.current || communicationLanguage;
    addLog(`🗣️ Idioma de redacción (CSV): ${formatLanguageLabel(contentLanguage)}`);
    const resolvedBusinessNameCSV = clientBusinessNameRef.current || clientBusinessName || undefined;
    addLog(`🏷️ Nombre de negocio detectado (CSV): ${resolvedBusinessNameCSV ?? '(no detectado)'} (bloqueado para redaccion)`);
    const csvContentContext = contentContextRef.current || undefined;
    if (csvContentContext) addLog('🧠 Inyectando CONTENT CONTEXT en outline (batch)...');
    const outline = await generateArticleOutline(topicForOutline, kws, outlineContentType, undefined, contentLanguage, undefined, undefined, csvContentContext, previousTitles.length > 0 ? previousTitles : undefined);

    // sanitize titles and intro
    if (outline.title) outline.title = sanitizeTitle(outline.title);
    if (outline.title) outline.title = toSentenceCase(outline.title);
    if (outline.title) outline.title = stripBusinessNameMentions(outline.title, resolvedBusinessNameCSV);
    if (outline.introduction) {
      outline.introduction = outline.introduction.trim().replace(/\n+/g, " ");
      outline.introduction = stripBusinessNameMentions(outline.introduction, resolvedBusinessNameCSV);
    } else {
      // generar introducción fallback si Gemini no la devolvió
      const h1 = outline.title || kws[0];
      const cleanH1 = h1.replace(/\?$/, '').trim();
      outline.introduction = `${cleanH1} ofrece claves y consejos directos para resolver esa duda, con ideas prácticas y orientadas a la acción.`;
      // intro: no forzar 40 palabras, Gemini la genera completa
    }
    if (outline.sections) {
      let lastTitle = outline.title || "";
      outline.sections = outline.sections.map(s => {
        const clean = toSentenceCase(sanitizeTitle(s.title || "", lastTitle));
        lastTitle = clean;
        return { ...s, title: clean };
      });
    }

    let articleData;
    
    // 🔍 VERIFICAR si Gemini devolvió secciones con títulos válidos
    const hasValidSections = outline && 
                            Array.isArray(outline.sections) &&
                            outline.sections.length > 0 &&
                            outline.sections.every(s => s.title && s.title.trim().length > 0);

    if (!hasValidSections) {
      addLog("⚠️ Gemini no devolvió secciones válidas. Generando fallback inteligente...");

      const _csvLang = communicationLanguageRef.current || communicationLanguage;
      let fallbackSections = generateFallbackSections(kws, _csvLang);

      // Generar título variado según el número de artículo y asegurarse de que sea diferente
      const topicForFallback = kws[0];
      const titleVariations = _csvLang === 'english'
        ? [
            `Complete guide to ${topicForFallback}`,
            `${topicForFallback}: Everything you need to know`,
            `Discover ${topicForFallback}: Practical guide`,
            `${topicForFallback} explained: Essential information`,
            `All about ${topicForFallback}`,
            `${topicForFallback}: Definitive guide`,
          ]
        : [
            `Guía completa sobre ${topicForFallback}`,
            `${topicForFallback}: Todo lo que necesitas saber`,
            `Descubre ${topicForFallback}: Guía práctica`,
            `${topicForFallback} explicado: Información esencial`,
            `Conoce todo sobre ${topicForFallback}`,
            `${topicForFallback}: Guía definitiva`,
          ];
      
      // 🧠 Buscar un título que no esté en la memoria
      let selectedTitle = outline?.title;

      // limpiar posibles preguntas consecutivas con el título que seleccionemos más adelante
      const cleanFallback = () => {
        let lastTitle = selectedTitle || outline?.title || "";
        fallbackSections = fallbackSections.map(s => {
          const clean = toSentenceCase(sanitizeTitle(s.title, lastTitle));
          lastTitle = clean;
          return { ...s, title: clean };
        });
      };
      
      if (!selectedTitle || previousTitles.includes(selectedTitle)) {
        for (const variation of titleVariations) {
          if (!previousTitles.includes(variation)) {
            selectedTitle = variation;
            break;
          }
        }
        
        // Si todos los títulos ya existen, agregar número
        if (previousTitles.includes(selectedTitle || '')) {
          selectedTitle = `${titleVariations[articleNumber - 1]} (${articleNumber})`;
        }
      }

      // si generamos secciones de fallback, limpiamos preguntas consecutivas
      if (fallbackSections) {
        cleanFallback();
      }

      articleData = {
        title: selectedTitle,
        introduction: _csvLang === 'english'
          ? `This article covers ${topicForFallback} step by step, answering the main question with practical information.`
          : `En este artículo vamos a hablar sobre ${topicForFallback} y responder a la pregunta principal paso a paso.`,
        sections: fallbackSections,
        primaryKeywords: kws
      };
      
      addLog(`✅ Fallback generado: ${articleData.title}`);
      addLog(`✅ Secciones: ${fallbackSections.map(s => s.title).join(', ')}`);
    } else {
      // ✅ Gemini devolvió estructura válida
      let finalTitle = outline.title || kws[0] || '';
      
      // 🧠 Verificar si el título ya existe en la memoria
      if (previousTitles.includes(finalTitle)) {
        addLog(`⚠️ Título duplicado detectado: "${finalTitle}"`);
        
        const _csvLang2 = communicationLanguageRef.current || communicationLanguage;
        // Agregar variación al título
        const titleSuffixes = _csvLang2 === 'english'
          ? [": Complete guide", ": Everything you need to know", ": Essential information", ": Key aspects", " in detail"]
          : [
          ": Guía completa",
          ": Todo lo que debes saber",
          ": Información esencial",
          ": Aspectos clave",
          " en detalle",
        ];
        
        for (const suffix of titleSuffixes) {
          const newTitle = `${finalTitle}${suffix}`;
          if (!previousTitles.includes(newTitle)) {
            finalTitle = newTitle;
            addLog(`✅ Título modificado para evitar duplicado: "${finalTitle}"`);
            break;
          }
        }
        
        // Si aún así existe, agregar número
        if (previousTitles.includes(finalTitle)) {
          finalTitle = `${outline.title} (${articleNumber})`;
          addLog(`✅ Título con número: "${finalTitle}"`);
        }
      }
      
      articleData = {
        ...outline,
        title: toSentenceCase(finalTitle),
        primaryKeywords: kws
      };
      
      addLog(`✅ Outline de Gemini: ${articleData.sections?.length} secciones`);
    }
    
    // 🧠 GUARDAR el título en la memoria
    if (currentAccountUuid && articleData.title) {
      setAccountMemory(prev => ({
        ...prev,
        [currentAccountUuid]: [...(prev[currentAccountUuid] || []), articleData.title!]
      }));
      addLog(`🧠 Título guardado en memoria: "${articleData.title}"`);
    }
    
    setArticle(articleData);
    await wait(500);
    
    return articleData;
  };

  // 🧠 Procesa una fila del CSV (1 cuenta = N artículos)
  const processCsvRow = async (row: CsvRow, accountIndex: number, totalAccounts: number): Promise<string[]> => {
    const publishedUrls: string[] = [];

    try {
      // Actualizar progreso: iniciando cuenta
      setBatchProgress(prev => ({
        ...prev,
        currentAccount: accountIndex + 1,
        totalAccounts: totalAccounts,
        currentArticle: 0,
        totalArticles: row.task_count
      }));

      // 1️⃣ Obtener brief UNA SOLA VEZ por cuenta
      addLog(`📥 Obteniendo brief para cuenta ${accountIndex + 1}...`);
      const rawText = await fetchBriefByUuid(row.account_uuid);
      
      let detectedWebsite: string | null = null;
      
      if (rawText.toLowerCase().includes("<!doctype html") || rawText.includes("<html")) {
        detectedWebsite = await handleDataAcquisition(rawText, true);
      } else {
        const data = JSON.parse(rawText);
        detectedWebsite = await handleDataAcquisition(data, true);
      }
      
      // Guardar el website detectado para esta cuenta
      if (detectedWebsite) {
        setClientWebsite(detectedWebsite);
        addLog(`✅ Website para esta cuenta: ${detectedWebsite}`);
      } else {
        setClientWebsite(null);
        addLog(`ℹ️ Esta cuenta no tiene website`);
      }

      // 2️⃣ Preparar keywords (máximo 5) UNA SOLA VEZ
      let keywordsText = row.kw.trim();
      if (keywordsText.startsWith('[') && keywordsText.endsWith(']')) {
        keywordsText = keywordsText.slice(1, -1);
      }
      
      const allKeywords = keywordsText.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (allKeywords.length === 0) throw new Error("No hay keywords válidas");
      
      const keywordsToUse = allKeywords.slice(0, 5);
      setKeywords(keywordsToUse);
      addLog(`🔑 Keywords configuradas: ${keywordsToUse.join(", ")}`);
      await wait(500);

      // 3️⃣ Generar N artículos para esta cuenta
      addLog(`📊 Generando ${row.task_count} artículos para esta cuenta...`);
      
      for (let i = 0; i < row.task_count; i++) {
        addLog(`\n========================================`);
        addLog(`📝 ARTÍCULO ${i + 1}/${row.task_count}`);
        addLog(`========================================`);
        
        // Actualizar progreso
        setBatchProgress(prev => ({
          ...prev,
          currentArticle: i + 1
        }));

        // Rotar keyword según el índice del artículo dentro de esta cuenta
        const kwIdx = Math.min(i, allKeywords.length - 1);
        const activeKeyword = allKeywords[kwIdx];
        const keywordsForThisArticle = [activeKeyword];
        setKeywords(keywordsForThisArticle);
        addLog(`🎯 Artículo ${i + 1} usará keyword [${kwIdx}]: "${activeKeyword}" (${kwIdx + 1}/${allKeywords.length})`);

        // PASO 1: Generar estructura (outline)
        addLog(`🏗️ Paso 1/3: Generando estructura...`);
        const outlineData = await proceedToOutlineCSV(keywordsForThisArticle);
        await wait(1000);
        
        // PASO 2: Escribir contenido completo — pasar outline DIRECTAMENTE para evitar race condition de React state
        addLog(`✍️ Paso 2/3: Redactando contenido completo...`);
        addLog(`📋 Título del outline: "${outlineData?.title || '(vacío)'}"`);
        const completeArticle = await startWriting(outlineData || undefined, detectedWebsite);
        
        // 🔍 VERIFICAR que el artículo tiene contenido
        if (!completeArticle.sections || completeArticle.sections.length === 0) {
          throw new Error("El artículo no tiene secciones después de startWriting");
        }
        
        addLog(`✅ Artículo con ${completeArticle.sections.length} secciones listo para publicar`);
        
        // PASO 3: Publicar en WordPress
        addLog(`📤 Paso 3/3: Publicando en WordPress...`);
        
        // ✅ Pasar el artículo directamente - NO depender del estado React (asíncrono)
        const publishResultDirect = await publish(completeArticle);
        
        // Capturar URL desde el retorno directo de publish() — evitar race condition con estado React
        await wait(1000);
        if (publishResultDirect?.success && publishResultDirect.url) {
          publishedUrls.push(publishResultDirect.url);
          addLog(`✅ Artículo ${i + 1} publicado: ${publishResultDirect.url}`);

          setBatchProgress(prev => ({
            ...prev,
            publishedUrls: [...prev.publishedUrls, publishResultDirect.url!]
          }));

          // ── Prodline: propuesta + assigned_team ──────────────────────────
          const ORBIDI_API_KEY = import.meta.env.VITE_ORBIDI_API_KEY;
          const prodlineIds = row.task_prodline_ids
            ? row.task_prodline_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
            : [];
          const prodlineTaskId = prodlineIds[i];

          if (prodlineTaskId) {
            addLog(`\n📎 Prodline task [${i + 1}]: ${prodlineTaskId.slice(0, 8)}...`);

            // 1. Crear propuesta con URL del artículo + imagen por defecto
            const proposalResult = await createProdlineProposal(
              prodlineTaskId,
              publishResultDirect.url,
              row.content_type ?? 'on_blog',
              ORBIDI_API_KEY,
              (row as any).deliverable_type,  // columna opcional del CSV
            );

            if (proposalResult.success) {
              addLog(`   ✅ Propuesta creada (imagen ${proposalResult.imageUploaded ? 'subida' : 'como link Drive'})`);
            } else {
              addLog(`   ⚠️ Error creando propuesta: ${proposalResult.error}`);
            }

            // 2. Asignar al equipo de content factory
            const assigned = await assignProdlineTask(prodlineTaskId, ORBIDI_API_KEY);
            addLog(assigned
              ? `   ✅ assigned_team: content_factory`
              : `   ⚠️ No se pudo asignar el equipo`
            );
          } else {
            addLog(`   ℹ️ Sin task_prodline_id para artículo ${i + 1} — omitiendo Prodline`);
          }
          // ────────────────────────────────────────────────────────────────
        } else {
          addLog(`⚠️ Artículo ${i + 1} no se pudo publicar`);
        }
        
        // Esperar entre artículos (excepto el último)
        if (i < row.task_count - 1) {
          addLog(`⏳ Esperando 3s antes del siguiente artículo...`);
          await wait(3000);
        }
      }

      addLog(`\n✅ Cuenta ${accountIndex + 1} completada: ${publishedUrls.length}/${row.task_count} artículos publicados`);
      return publishedUrls;

    } catch (e: any) {
      addLog(`❌ Error en cuenta ${accountIndex + 1}: ${e.message}`);
      throw e;
    }
  };

  // ─── Helper: genera outline + escribe contenido + publica para un artículo ───
  const generateAndPublishArticle = async (
    kws: string[],
    ct: ContentType,
    websiteUrl: string | null,
    articleIdx: number,   // 0-based dentro de su grupo de tipo
  ): Promise<{ success: boolean; url?: string }> => {
    contentTypeRef.current = ct;
    gmbPostDataRef.current = null;
    setGmbPostData(null);

    if (ct === 'gmb') {
      // GMB: generación directa sin outline
      const completedGmb = await startWritingGmb(kws);
      if (!completedGmb?.title) throw new Error('GMB vacío');
      setArticle(completedGmb);
      await wait(1000);
      const result = await publish(completedGmb);
      return result?.success ? { success: true, url: result.url } : { success: false };
    }

    // SEO on_blog / off_page
    const outline = await proceedToOutlineCSV(kws);
    await wait(500);
    const completedArticle = await startWriting(outline || undefined, websiteUrl);
    if (!completedArticle?.sections?.length) throw new Error('Artículo sin secciones');
    setArticle(completedArticle);
    await wait(1000);
    const result = await publish(completedArticle);
    return result?.success ? { success: true, url: result.url } : { success: false };
  };

  // 📝 Flujo de Feedback: regenera artículo con cambios del cliente y actualiza el post de WP existente
  const handleFeedbackFlow = async () => {
    if (!feedbackAccountUuid.trim()) { alert('Ingresa el Account UUID del cliente'); return; }
    if (!feedbackWpUrl.trim()) { alert('Ingresa la URL del artículo en WordPress'); return; }
    if (!feedbackText.trim()) { alert('Ingresa el feedback del cliente'); return; }
    if (!feedbackTaskUuid.trim()) { alert('Ingresa el Task UUID'); return; }

    setFeedbackStatus('loading');
    setFeedbackStatusMsg('Obteniendo brief del cliente...');
    addLog('\n========================================');
    addLog('📝 MODO FEEDBACK — Inicio');
    addLog('========================================');

    try {
      // 1. Fetch brief
      const rawText = await fetchBriefByUuid(feedbackAccountUuid.trim());
      const briefData = rawText.toLowerCase().includes('<!doctype html') || rawText.includes('<html')
        ? rawText
        : JSON.parse(rawText);

      setFeedbackStatusMsg('Procesando brief...');
      const detectedWebsite = await handleDataAcquisition(briefData, true);
      if (detectedWebsite) clientWebsiteRef.current = detectedWebsite;

      // 2. Set content type
      contentTypeRef.current = feedbackContentType;
      setContentType(feedbackContentType);
      gmbPostDataRef.current = null;
      setGmbPostData(null);

      // 3. Generar keywords priorizando el feedback del cliente
      // El feedback describe exactamente el tema que quiere el cliente → debe dominar las keywords
      setFeedbackStatusMsg('Generando keywords a partir del feedback...');
      const briefContext = extractContextFromData(briefData);
      const lang = communicationLanguageRef.current || communicationLanguage;
      // Combinamos: feedback primero (mayor peso) + brief como contexto de negocio
      const feedbackPlusContext = `El cliente solicita específicamente: ${feedbackText.trim()}\n\nContexto del negocio: ${briefContext}`;
      const genKws = await generateKeywords(feedbackPlusContext, lang);
      const kws = genKws.length > 0 ? [genKws[0]] : [feedbackText.trim().split(' ').slice(0, 3).join(' ')];
      setKeywords(kws);
      originalKeywordsRef.current = kws;
      addLog(`🔑 Keywords (desde feedback): ${kws.join(', ')}`);

      // 4. Inyectar feedback como instrucción central en el ContentContext
      // Se pone en proposed_title, main_user_question Y additional_notes para máxima prioridad
      const feedbackInstruction = `FEEDBACK DEL CLIENTE (aplicar obligatoriamente): ${feedbackText.trim()}`;
      feedbackInstructionsRef.current = feedbackInstruction;
      if (contentContextRef.current) {
        contentContextRef.current = {
          ...contentContextRef.current,
          proposed_title: kws[0],
          primary_keywords: kws,
          main_user_question: feedbackText.trim(),
          additional_notes: [feedbackInstruction, contentContextRef.current.additional_notes]
            .filter(Boolean).join('\n\n'),
        };
      } else {
        contentContextRef.current = {
          proposed_title: kws[0],
          primary_keywords: kws,
          secondary_keywords: [],
          tags: [],
          search_intent: 'informational',
          brand_context_summary: briefContext.slice(0, 300),
          main_user_question: feedbackText.trim(),
          suggested_structure: [],
          additional_notes: feedbackInstruction,
        };
      }
      addLog('🧠 Feedback inyectado como tema principal del artículo');

      // 5. Generar contenido según el tipo (GMB tiene flujo diferente a on_blog/off_page)
      setBatchProgress(prev => ({ ...prev, currentArticle: 1, totalArticles: 1, currentAccountUuid: feedbackAccountUuid.trim() }));
      let completedArticle: Partial<Article>;

      if (feedbackContentType === 'gmb') {
        setFeedbackStatusMsg('Generando post GMB con feedback aplicado...');
        const completedGmb = await startWritingGmb(kws);
        if (!completedGmb?.title) throw new Error('El post GMB no se generó correctamente');
        completedArticle = completedGmb;
      } else {
        setFeedbackStatusMsg('Generando estructura del artículo con feedback aplicado...');
        const outline = await proceedToOutlineCSV(kws);
        setFeedbackStatusMsg('Redactando contenido...');
        completedArticle = await startWriting(outline || undefined, detectedWebsite);
        if (!completedArticle?.sections?.length) throw new Error('El artículo generado no tiene secciones');
      }

      // 6. Determinar credenciales WP a partir de la URL del post existente
      const parsedUrl = new URL(feedbackWpUrl.trim());
      const urlOrigin = parsedUrl.origin.replace(/\/$/, '');
      const domainMap = [
        { domain: wpDomainSite5.replace(/\/$/, ''), token: wpJwtTokenSite5, label: 'masproposals.com' },
        { domain: wpDomain.replace(/\/$/, ''), token: wpJwtToken, label: 'cienciacronica.com' },
        { domain: wpDomainSite2.replace(/\/$/, ''), token: wpJwtTokenSite2, label: 'elinformedigital.com' },
        { domain: wpDomainSite3.replace(/\/$/, ''), token: wpJwtTokenSite3, label: 'laprensa360.com' },
        { domain: wpDomainEnglish.replace(/\/$/, ''), token: wpJwtTokenEnglish, label: 'wall-trends.com' },
      ];
      const creds = domainMap.find(d => urlOrigin === d.domain || urlOrigin.includes(d.domain.replace('https://', '').replace('http://', '')));
      if (!creds) throw new Error(`No se encontraron credenciales para: ${urlOrigin}`);
      addLog(`🎯 Dominio WP detectado: ${creds.label}`);

      // 7. Obtener ID del post por slug
      setFeedbackStatusMsg('Localizando post en WordPress...');
      const pathParts = parsedUrl.pathname.replace(/\/$/, '').split('/').filter(Boolean);
      const slug = pathParts[pathParts.length - 1];
      const rawToken = creds.token.trim();
      const WP_TOKEN_HDR = /^Bearer\s+/i.test(rawToken) ? rawToken : `Bearer ${rawToken}`;

      const slugRes = await fetch(
        `${creds.domain}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,link`,
        { headers: { 'Authorization': WP_TOKEN_HDR } }
      );
      if (!slugRes.ok) throw new Error(`Error buscando post por slug (HTTP ${slugRes.status})`);
      const slugData = await slugRes.json();
      if (!slugData[0]?.id) throw new Error(`No se encontró post con slug "${slug}" en ${creds.domain}`);
      const postId = slugData[0].id as number;
      addLog(`🔍 Post encontrado: ID ${postId}`);

      // 8. Actualizar el post existente (PUT) usando la función publish con wpPostId
      setFeedbackStatusMsg('Actualizando artículo en WordPress...');
      const updateResult = await publish(completedArticle, { domain: creds.domain, token: creds.token, label: creds.label }, postId);
      if (!updateResult?.success || !updateResult.url) throw new Error('Error actualizando el post en WordPress');
      addLog(`✅ Artículo actualizado: ${updateResult.url}`);

      // 9. Prodline sync (flujo normal)
      setFeedbackStatusMsg('Sincronizando con Prodline...');
      const ORBIDI_API_KEY = import.meta.env.VITE_ORBIDI_API_KEY;
      const syncResult = await syncMarketingActionDirect(feedbackTaskUuid.trim(), updateResult.url, feedbackContentType, ORBIDI_API_KEY);
      addLog(syncResult.success ? '✅ Prodline sincronizado correctamente' : `⚠️ Prodline: ${syncResult.error}`);

      setFeedbackStatus('success');
      setFeedbackStatusMsg(updateResult.url);
      addLog('\n✅ FEEDBACK COMPLETADO');

    } catch (e: any) {
      addLog(`❌ Error en feedback: ${e.message}`);
      setFeedbackStatus('error');
      setFeedbackStatusMsg(e.message);
    } finally {
      feedbackInstructionsRef.current = '';
    }
  };

  // 🏭 Producción masiva v2 (formato multi-tipo: on_blog + off_page + gmb por cuenta)
  const startBatchProductionV2 = async () => {
    if (csvRowsV2.length === 0) {
      alert('No hay filas CSV v2 cargadas');
      return;
    }

    // Evitar ejecuciones concurrentes
    if (isProcessingRef.current) {
      addLog('⚠️ Ya hay una producción en curso — ignorando click duplicado');
      return;
    }
    isProcessingRef.current = true;

    const ORBIDI_API_KEY = import.meta.env.VITE_ORBIDI_API_KEY;
    publishedUrlsRef.current = [];
    urlMapRef.current = {};
    totalArticlesRef.current = 0;
    currentAccountRef.current = 0;
    offPagePortalIndexRef.current = 0; // reiniciar rotación de portales off_page

    const totalAccounts = csvRowsV2.length;
    const grandTotal = csvRowsV2.reduce((s, r) => s + r.count_onblog + r.count_offpa + r.count_postnoticias, 0);

    setBatchProgress({ currentAccount: 0, totalAccounts, currentArticle: 0, totalArticles: grandTotal, publishedUrls: [], isComplete: false });

    addLog(`\n🏭 PRODUCCIÓN MASIVA V2 — ${totalAccounts} cuentas | ${grandTotal} piezas totales`);

    let globalArticleIdx = 0;

    for (let rowIdx = 0; rowIdx < csvRowsV2.length; rowIdx++) {
      const row = csvRowsV2[rowIdx];

      addLog(`\n========================================`);
      addLog(`📂 CUENTA ${rowIdx + 1}/${totalAccounts} — ${row.account_uuid.slice(0, 20)}...`);
      addLog(`   on_blog:${row.count_onblog}  off_page:${row.count_offpa}  gmb:${row.count_postnoticias}`);
      addLog(`========================================`);

      setBatchProgress(prev => ({ ...prev, currentAccount: rowIdx + 1, currentAccountUuid: row.account_uuid }));
      setIsLoading(true);

      // 1️⃣ Obtener brief y detectar website/idioma/negocio
      let detectedWebsite: string | null = null;
      let briefKeywords: string[] = [];

      try {
        addLog(`📥 Obteniendo brief...`);
        const rawText = await fetchBriefByUuid(row.account_uuid);
        const briefData = rawText.toLowerCase().includes('<!doctype html') || rawText.includes('<html')
          ? rawText
          : JSON.parse(rawText);

        detectedWebsite = await handleDataAcquisition(briefData, true);
        if (detectedWebsite) {
          clientWebsiteRef.current = detectedWebsite;
          addLog(`✅ Website: ${detectedWebsite}`);
        } else {
          clientWebsiteRef.current = null;
          addLog(`ℹ️ Sin website`);
        }

        // Usar keywords del CSV (columna kw)
        // Detecta si la columna contiene keywords (cortas, separadas por coma)
        // o un contexto descriptivo (frases largas) para usarlo como guía temática
        let kwText = (row.kw || '').trim();
        if (kwText.startsWith('[') && kwText.endsWith(']')) kwText = kwText.slice(1, -1);
        const kwRaw = kwText.split(',').map(k => k.trim()).filter(k => k.length > 0);
        const isContextMode = kwRaw.length > 0 && kwRaw.every(k => k.split(' ').length > 4);
        let briefContext: string | undefined;

        if (isContextMode) {
          // kw contiene frases descriptivas — úsalas como contexto adicional
          briefContext = kwRaw.join('. ');
          briefKeywords = []; // se llenarán desde analyzeWebsite
          addLog(`📝 Columna kw interpretada como CONTEXTO: "${briefContext.slice(0, 80)}..."`);
        } else {
          briefKeywords = kwRaw;
        }

        if (briefKeywords.length === 0 && !isContextMode) {
          // Fallback: generar keywords desde el brief si la columna kw está vacía
          addLog(`⚠️ Columna kw vacía — generando keywords desde brief...`);
          const context = extractContextFromData(briefData);
          const lang = communicationLanguageRef.current || communicationLanguage;
          const generatedKws = await generateKeywords(context, lang);
          briefKeywords = generatedKws.map(k => k.trim()).filter(k => k.length > 0);
          if (briefKeywords.length === 0) briefKeywords = ['servicio'];
        }
        if (briefKeywords.length > 0) addLog(`🔑 Keywords (${briefKeywords.length}): ${briefKeywords.join(', ')}`);
        originalKeywordsRef.current = briefKeywords;

        // 1b️⃣ Análisis web del cliente (Web Analyst Agent)
        contentContextRef.current = null;
        setContentContext(null);
        if (detectedWebsite) {
          addLog(`🔍 Analizando web del cliente: ${detectedWebsite}`);
          try {
            const lang = communicationLanguageRef.current || communicationLanguage;
            const seedKw = briefKeywords[0] || 'servicios';
            const ctx = await analyzeWebsite(detectedWebsite, seedKw, clientBusinessNameRef.current || undefined, lang, briefContext);
            contentContextRef.current = ctx;
            setContentContext(ctx);
            addLog(`✅ CONTENT CONTEXT generado (${ctx.proposed_title.slice(0, 50)}...)`);
            if (ctx.related_questions?.length) {
              addLog(`❓ Preguntas PAA (${ctx.related_questions.length}): ${ctx.related_questions.slice(0, 2).join(' | ')}...`);
            }

            // Si kw era contexto o estaba vacío, usar keywords del análisis web
            const isGenericFallback = briefKeywords.length === 0 || (briefKeywords.length === 1 && briefKeywords[0] === 'servicio');
            if ((isContextMode || isGenericFallback) && ctx.primary_keywords?.length) {
              briefKeywords = [
                ...ctx.primary_keywords,
                ...(ctx.secondary_keywords || []),
              ].filter(k => k.trim().length > 0);
              originalKeywordsRef.current = briefKeywords;
              addLog(`🔑 Keywords extraídas del contexto web (${briefKeywords.length}): ${briefKeywords.join(', ')}`);
            }
          } catch (we: any) {
            addLog(`⚠️ Análisis web falló: ${we.message} — continuando sin contexto`);
          }
        } else {
          addLog(`ℹ️ Sin website — omitiendo análisis web`);
        }

        // Inicializar memoria para la cuenta — cargar títulos previos si existen
        const prevTitles = accountMemory[row.account_uuid] || [];
        if (prevTitles.length > 0) {
          addLog(`🧠 Memoria: ${prevTitles.length} artículo(s) previo(s) para esta cuenta — no se repetirán`);
        } else {
          setAccountMemory(prev => ({ ...prev, [row.account_uuid]: [] }));
        }
      } catch (e: any) {
        addLog(`❌ Error obteniendo brief: ${e.message} — saltando cuenta`);
        setIsLoading(false);
        continue;
      }

      setIsLoading(false);

      // 2️⃣ Procesar cada tipo de contenido en orden: on_blog → off_page → gmb
      const jobs: Array<{ ct: ContentType; count: number; uuids: string[] }> = [
        { ct: 'on_blog',  count: row.count_onblog,      uuids: row.task_uuid_onblog.split(',').map(s => s.trim()).filter(Boolean) },
        { ct: 'off_page', count: row.count_offpa,       uuids: row.task_uuid_offpage.split(',').map(s => s.trim()).filter(Boolean) },
        { ct: 'gmb',      count: row.count_postnoticias, uuids: row.task_uuid_postnoticias.split(',').map(s => s.trim()).filter(Boolean) },
      ];

      for (const job of jobs) {
        if (job.count <= 0) continue;

        addLog(`\n▶ Tipo: ${job.ct.toUpperCase()} — ${job.count} pieza(s)`);
        contentTypeRef.current = job.ct;
        setContentType(job.ct);

        for (let i = 0; i < job.count; i++) {
          globalArticleIdx++;
          currentArticleRef.current = globalArticleIdx;

          addLog(`\n--- ${job.ct} ${i + 1}/${job.count} (global ${globalArticleIdx}/${grandTotal}) ---`);

          setBatchProgress(prev => ({
            ...prev,
            currentArticle: globalArticleIdx,
            totalArticles: grandTotal,
          }));

          // Rotar keywords en ciclo — cada artículo usa una keyword distinta, vuelve a empezar si se agotan
          const kwIdx = briefKeywords.length > 0 ? (globalArticleIdx - 1) % briefKeywords.length : 0;
          const kw = briefKeywords[kwIdx] || briefKeywords[0] || 'servicio';
          const kws = [kw];
          setKeywords(kws);
          addLog(`🎯 Keyword: "${kw}"`);

          // Rotar related_questions como ángulo del artículo (People Also Ask)
          // Cada artículo responde a una pregunta diferente → mayor diversidad y relevancia
          const rqs = contentContextRef.current?.related_questions;
          if (rqs?.length && contentContextRef.current) {
            // globalArticleIdx garantiza rotación global entre tipos de contenido
            const rq = rqs[globalArticleIdx % rqs.length];
            contentContextRef.current = { ...contentContextRef.current, main_user_question: rq };
            addLog(`❓ Ángulo del artículo: "${rq}"`);
          }

          // Actualizar contador para proceedToOutlineCSV (title uniqueness)
          setBatchProgress(prev => ({ ...prev, currentArticle: globalArticleIdx, currentAccountUuid: row.account_uuid }));
          await wait(200);

          try {
            setIsLoading(true);
            const { success, url } = await generateAndPublishArticle(kws, job.ct, clientWebsiteRef.current, i);
            setIsLoading(false);

            if (success && url) {
              publishedUrlsRef.current.push(url);
              addLog(`✅ Publicado: ${url}`);

              setBatchProgress(prev => ({
                ...prev,
                publishedUrls: [...prev.publishedUrls, url],
              }));

              // Sync Prodline — usar el UUID correspondiente a este artículo;
              // si hay menos UUIDs que artículos, usar el último disponible (no saltar)
              const taskUuid = job.uuids.length > 0
                ? job.uuids[Math.min(i, job.uuids.length - 1)]
                : undefined;
              const uuidLooksValid = taskUuid && /^[0-9a-f-]{30,}/i.test(taskUuid);
              if (uuidLooksValid) {
                addLog(`📎 Prodline sync → cuenta ${row.account_uuid.slice(0, 8)}... | task ${taskUuid!.slice(0, 8)}... | tipo ${job.ct}`);
                try {
                  const syncResult = await syncMarketingActionDirect(taskUuid!, url, job.ct, ORBIDI_API_KEY);
                  addLog(syncResult.success ? `   ✅ Prodline OK` : `   ⚠️ ${syncResult.error}`);
                } catch (pe: any) {
                  addLog(`   ⚠️ Prodline error: ${pe.message}`);
                }
              } else {
                addLog(`   ℹ️ Sin task_uuid válido para cuenta ${row.account_uuid.slice(0, 8)}... tipo ${job.ct} — omitiendo Prodline`);
              }
            } else {
              addLog(`⚠️ No se pudo publicar`);
            }
          } catch (e: any) {
            setIsLoading(false);
            addLog(`❌ Error generando artículo: ${e.message}`);
          }

          if (i < job.count - 1) {
            addLog(`⏳ Esperando 3s...`);
            await wait(3000);
          }
        }
      }

      addLog(`\n✅ Cuenta ${rowIdx + 1} completada`);
      if (rowIdx < csvRowsV2.length - 1) {
        addLog(`⏳ Esperando 5s antes de siguiente cuenta...`);
        await wait(5000);
      }
    }

    addLog(`\n🎉 PRODUCCIÓN V2 COMPLETADA — ${publishedUrlsRef.current.length}/${grandTotal} piezas publicadas`);
    setBatchProgress(prev => ({ ...prev, isComplete: true }));
    setIsLoading(false);
    setStep(AppStep.ACCOUNT);
    isProcessingRef.current = false; // liberar lock
  };

  // 🏭 Inicia la producción masiva desde CSV (semi-automático con auto-clicks)
  const startBatchProduction = async () => {
    if (csvRows.length === 0) {
      alert("No hay filas CSV cargadas");
      return;
    }

    // Resetear progreso
    publishedUrlsRef.current = []; // Limpiar URLs del ref
    urlMapRef.current = {}; // Limpiar mapa de URLs
    setClickupDone(false);
    setProdlineDone(false);
    setShowClickUpConfirm(false);
    totalArticlesRef.current = 0; // Resetear total de artículos
    originalKeywordsRef.current = []; // Limpiar keywords originales
    clientWebsiteRef.current = null; // Limpiar website
    currentAccountRef.current = 0;
    totalAccountsRef.current = csvRows.length;
    currentArticleRef.current = 0; // Resetear contador de artículos
    isProcessingRef.current = false; // Resetear flag
    
    setBatchProgress({
      currentAccount: 0,
      totalAccounts: csvRows.length,
      currentArticle: 0,
      totalArticles: 0,
      publishedUrls: [],
      isComplete: false
    });

    // Cargar primera cuenta
    await loadNextCsvAccount();
  };

  // 📥 Cargar la siguiente cuenta del CSV
  const loadNextCsvAccount = async () => {
    const currentIndex = currentAccountRef.current; // Usar ref en lugar de estado
    
    addLog(`🔍 loadNextCsvAccount llamado con index: ${currentIndex}`);
    
    if (currentIndex >= csvRows.length) {
      // Todas las cuentas procesadas
      addLog(`✅ Todas las ${csvRows.length} cuentas procesadas`);
      addLog(`✅ Usa los botones de la pantalla final para actualizar ClickUp y Prodline`);
      setBatchProgress(prev => ({
        ...prev,
        isComplete: true
      }));
      setStep(AppStep.ACCOUNT);
      return;
    }

    const row = csvRows[currentIndex];
    
    setIsLoading(true);
    addLog(`\n========================================`);
    addLog(`📂 CUENTA ${currentIndex + 1}/${csvRows.length}`);
    addLog(`========================================`);

    let keywordsToUse: string[] = [];
    let detectedWebsite: string | null = null;

    try {
      // 1️⃣ Obtener brief
      addLog(`📥 Obteniendo brief...`);
      const rawText = await fetchBriefByUuid(row.account_uuid);
      
      if (rawText.toLowerCase().includes("<!doctype html") || rawText.includes("<html")) {
        detectedWebsite = await handleDataAcquisition(rawText, true);
      } else {
        const data = JSON.parse(rawText);
        detectedWebsite = await handleDataAcquisition(data, true);
      }
      
      if (detectedWebsite) {
        clientWebsiteRef.current = detectedWebsite; // Guardar en ref
        setClientWebsite(detectedWebsite);
        addLog(`✅ Website detectado: ${detectedWebsite}`);
      } else {
        clientWebsiteRef.current = null; // Limpiar ref
        setClientWebsite(null);
        addLog(`ℹ️ Sin website`);
      }

      // 1b️⃣ Establecer tipo de contenido desde el CSV (default on_blog)
      const rowContentType: ContentType = row.content_type || 'on_blog';
      setContentType(rowContentType);
      contentTypeRef.current = rowContentType;
      // Limpiar datos GMB de la fila anterior
      gmbPostDataRef.current = null;
      setGmbPostData(null);
      addLog(`🎯 Tipo de contenido: ${rowContentType}`);

      // 2️⃣ Preparar keywords
      let keywordsText = row.kw.trim();
      if (keywordsText.startsWith('[') && keywordsText.endsWith(']')) {
        keywordsText = keywordsText.slice(1, -1);
      }
      
      const allKeywords = keywordsText.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (allKeywords.length === 0) throw new Error("No hay keywords válidas");
      
      // Guardar TODAS las keywords — cada artículo usará una diferente por índice
      // Artículo 1 siempre usa keyword[0]; los siguientes se rotan en autoContinue
      originalKeywordsRef.current = allKeywords;
      keywordsToUse = [allKeywords[0]];
      setKeywords(keywordsToUse);
      addLog(`🔑 Keywords disponibles (${allKeywords.length}): ${allKeywords.join(", ")}`);
      addLog(`🎯 Artículo 1 usará keyword [0]: "${allKeywords[0]}" de ${allKeywords.length} disponibles`);

      // 3️⃣ Actualizar progreso
      totalArticlesRef.current = row.task_count; // Actualizar ref
      currentAccountRef.current = currentIndex + 1; // Actualizar ref
      currentArticleRef.current = 0; // ← RESETEAR contador de artículos para nueva cuenta
      
      addLog(`🔄 RESETEANDO CONTADOR DE ARTÍCULOS para nueva cuenta`);
      addLog(`  - task_count de esta cuenta: ${row.task_count}`);
      addLog(`  - currentArticleRef reseteado a: 0`);
      
      setBatchProgress(prev => ({
        ...prev,
        currentAccount: currentIndex + 1,
        currentArticle: 0, // ← RESETEA A 0 para nueva cuenta
        totalArticles: row.task_count,
        currentAccountUuid: row.account_uuid
      }));

      // 🧠 Inicializar memoria para esta cuenta
      if (!accountMemory[row.account_uuid]) {
        setAccountMemory(prev => ({
          ...prev,
          [row.account_uuid]: []
        }));
        addLog(`🧠 Memoria inicializada`);
      }

      // 4️⃣ Cambiar a vista de KEYWORDS
      setStep(AppStep.KEYWORDS);

    } catch (e: any) {
      addLog(`❌ Error: ${e.message}`);
      alert(`Error cargando cuenta ${currentIndex + 1}:\n\n${e.message}`);
      return; // No continuar si hay error
    } finally {
      setIsLoading(false);
    }
    
    // ⏰ AUTO-CLICK: Esperar 2 segundos y generar estructura automáticamente
    await wait(2000);
    
    // Usar el ref que siempre tiene el valor actualizado
    const websiteToUse = clientWebsiteRef.current;
    addLog(`🔍 Pasando website a autoGenerateOutline: ${websiteToUse || 'null'}`);
    
    await autoGenerateOutline(keywordsToUse, websiteToUse);
  };

  // 🤖 AUTO-CLICK: Generar estructura automáticamente
  const autoGenerateOutline = async (keywordsToUse: string[], websiteUrl: string | null) => {
    const ct = contentTypeRef.current;

    // ── Rama GMB: omitir outline, generar post GMB directo ──
    if (ct === 'gmb') {
      addLog("🗺️ Tipo GMB detectado — omitiendo outline y generando post GMB directo");
      try {
        const completedArticle = await startWritingGmb(keywordsToUse);
        if (!completedArticle?.sections?.length) {
          addLog("❌ Error: publicación GMB vacía");
          return;
        }
        setArticle(completedArticle);
        await wait(3000);
        await autoPublish(completedArticle);
      } catch (e: any) {
        addLog(`❌ Error GMB en batch: ${e.message}`);
      }
      return;
    }

    // ── Rama SEO normal: on_blog / off_page ──
    setIsLoading(true);
    let generatedArticle: any = null;

    try {
      generatedArticle = await proceedToOutlineCSV(keywordsToUse);
      setStep(AppStep.OUTLINE);
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
      return;
    } finally {
      setIsLoading(false);
    }

    // ⏰ AUTO-CLICK: Esperar 2 segundos y redactar automáticamente
    await wait(2000);
    await autoStartWriting(generatedArticle, websiteUrl);
  };

  // 🤖 AUTO-CLICK: Redactar artículo automáticamente
  const autoStartWriting = async (generatedArticle: any, websiteUrl: string | null) => {
    addLog("🤖 Iniciando auto-redacción...");
    addLog(`🔍 Artículo recibido con ${generatedArticle?.sections?.length || 0} secciones`);
    if (websiteUrl) {
      addLog(`🌐 Website del cliente disponible: ${websiteUrl}`);
    }
    
    try {
      // Pasar el artículo generado Y el website DIRECTAMENTE a startWriting
      const completedArticle = await startWriting(generatedArticle, websiteUrl);
      
      addLog(`🔍 Artículo completado: ${completedArticle ? 'SÍ' : 'NO'}`);
      addLog(`🔍 Secciones finales: ${completedArticle?.sections?.length || 0}`);
      
      if (!completedArticle || !completedArticle.sections || completedArticle.sections.length === 0) {
        addLog("❌ Error: artículo vacío o sin secciones");
        return;
      }
      
      addLog("✅ Artículo validado correctamente");
      
      // ⚠️ IMPORTANTE: Actualizar el estado con el artículo completado para que publish() lo vea
      setArticle(completedArticle);
      
      // ⏰ AUTO-CLICK: Esperar 3 segundos y publicar automáticamente
      await wait(3000);
      await autoPublish(completedArticle);
    } catch (error: any) {
      addLog(`❌ Error en autoStartWriting: ${error.message}`);
      throw error;
    }
  };

  // 🤖 AUTO-CLICK: Publicar automáticamente
  const autoPublish = async (completedArticle: Partial<Article>) => {
    addLog(`\n📤 === PUBLICANDO ARTÍCULO ===`);
    addLog(`🔍 Estado ANTES de publicar:`);
    addLog(`  - currentArticleRef.current: ${currentArticleRef.current}`);
    addLog(`  - totalArticlesRef.current: ${totalArticlesRef.current}`);
    
    const result = await publish(completedArticle);
    
    // Incrementar el contador de artículos usando el REF
    currentArticleRef.current = currentArticleRef.current + 1;
    const newCurrentArticle = currentArticleRef.current;
    
    addLog(`🔍 Estado DESPUÉS de publicar:`);
    addLog(`  - newCurrentArticle (ref): ${newCurrentArticle}`);
    addLog(`  - totalArticlesRef.current: ${totalArticlesRef.current}`);
    addLog(`  - ¿Debería terminar? ${newCurrentArticle >= totalArticlesRef.current}`);
    
    // 📋 Capturar URL directamente del resultado retornado
    if (result?.success && result.url) {
      addLog(`📋 Capturando URL para ClickUp: ${result.url}`);
      
      // Agregar al ref plano (para UI)
      publishedUrlsRef.current.push(result.url);
      addLog(`📊 URLs acumuladas: ${publishedUrlsRef.current.length}`);
      
      // 🗺️ Guardar en mapa exacto: cuenta[rowIdx] artículo[artIdx]
      const rowIdx = currentAccountRef.current - 1;
      const artIdx = currentArticleRef.current - 1;
      if (!urlMapRef.current[rowIdx]) urlMapRef.current[rowIdx] = {};
      urlMapRef.current[rowIdx][artIdx] = result.url;
      addLog(`🗺️ URL mapeada: cuenta[${rowIdx}] artículo[${artIdx}]`);
      addLog(`📊 URLs acumuladas: ${publishedUrlsRef.current.length}`);
      
      // Agregar al estado (para UI)
      setBatchProgress(prev => ({
        ...prev,
        currentArticle: newCurrentArticle,
        publishedUrls: [...prev.publishedUrls, result.url!]
      }));
    } else {
      addLog(`⚠️ No se capturó URL de publicación`);
      // Solo actualizar el contador si no hay URL
      setBatchProgress(prev => ({
        ...prev,
        currentArticle: newCurrentArticle
      }));
    }
    
    // ⏰ AUTO-CLICK: Pasar valores actualizados a autoContinue
    await wait(1000);
    await autoContinue(newCurrentArticle, totalArticlesRef.current);
  };

  // 🤖 AUTO-CLICK: Continuar automáticamente
  const autoContinue = async (updatedCurrentArticle?: number, updatedTotalArticles?: number) => {
    // Usar valores pasados como parámetro o leer del estado
    const currentArticle = updatedCurrentArticle !== undefined ? updatedCurrentArticle : batchProgress.currentArticle;
    const totalArticles = updatedTotalArticles !== undefined ? updatedTotalArticles : batchProgress.totalArticles;
    
    addLog(`\n🔍 === DECISIÓN DE CONTINUACIÓN ===`);
    addLog(`🔍 currentArticle: ${currentArticle}`);
    addLog(`🔍 totalArticles: ${totalArticles}`);
    addLog(`🔍 ¿Terminó cuenta? ${currentArticle >= totalArticles}`);

    if (currentArticle >= totalArticles) {
      // Terminaron los artículos de esta cuenta
      addLog(`✅ Cuenta completada: ${currentArticle}/${totalArticles} artículos generados`);
      
      const currentAccountNumber = currentAccountRef.current;
      const totalAccountsNumber = totalAccountsRef.current;
      
      addLog(`🔍 Verificando cuentas: ${currentAccountNumber}/${totalAccountsNumber}`);
      
      if (currentAccountNumber >= totalAccountsNumber) {
        // ✅ TODAS LAS CUENTAS COMPLETADAS
        addLog(`\n🎉 ¡PRODUCCIÓN COMPLETADA!`);
        addLog(`📊 Total de URLs capturadas: ${publishedUrlsRef.current.length}`);
        addLog(`✅ Usa los botones de la pantalla final para actualizar ClickUp y Prodline`);
        
        setBatchProgress(prev => ({
          ...prev,
          isComplete: true
        }));
        
        setStep(AppStep.ACCOUNT);
        return; // ← RETURN EXPLÍCITO - NO CONTINUAR
      } else {
        // Ir a siguiente cuenta
        addLog(`➡️ Pasando a siguiente cuenta...`);
        addLog(`✅ Cuenta ${currentAccountNumber} de ${totalAccountsNumber} completada`);
        await wait(2000);
        await loadNextCsvAccount();
        return; // ← RETURN EXPLÍCITO - NO CONTINUAR
      }
    } else {
      // Generar siguiente artículo de esta cuenta
      addLog(`\n✅ === GENERANDO SIGUIENTE ARTÍCULO ===`);
      addLog(`📝 Artículo ${currentArticle + 1} de ${totalArticles}`);
      
      // Rotar keywords desde las ORIGINALES (no del estado)
      const originalKeywords = originalKeywordsRef.current;
      
      if (originalKeywords.length === 0) {
        addLog(`❌ Error: No hay keywords originales guardadas`);
        throw new Error("No hay keywords originales para el siguiente artículo");
      }
      
      addLog(`🔑 Keywords disponibles (${originalKeywords.length}): ${originalKeywords.join(", ")}`);
      
      // Seleccionar keyword por índice del artículo actual — si se agotaron, reusar la última
      // currentArticle = número de artículos ya completados → índice del siguiente artículo
      const kwIndex = Math.min(currentArticle, originalKeywords.length - 1);
      const selectedKeyword = originalKeywords[kwIndex];
      const rotatedKeywords = [selectedKeyword];
      
      setKeywords(rotatedKeywords);
      addLog(`🎯 Artículo ${currentArticle + 1} usará keyword [${kwIndex}]: "${selectedKeyword}" (${kwIndex + 1} de ${originalKeywords.length})`);
      
      // Resetear publishResult
      setPublishResult(null);
      
      // Ir a keywords
      setStep(AppStep.KEYWORDS);
      
      // Auto-generar outline para el siguiente artículo
      addLog(`🚀 Iniciando generación del artículo ${currentArticle + 1}...`);
      
      const websiteToUse = clientWebsiteRef.current;
      if (websiteToUse) {
        addLog(`🌐 Usando website de la cuenta: ${websiteToUse}`);
      } else {
        addLog(`ℹ️ Cuenta sin website - no se generarán enlaces internos`);
      }
      
      await wait(2000);
      await autoGenerateOutline(rotatedKeywords, websiteToUse);
    }
  };

  // 📋 Versión automática de actualización de ClickUp
  const updateClickUpTasksAutomatic = async (urls: string[]) => {
    if (csvRows.length === 0) {
      addLog("❌ No hay filas CSV para actualizar");
      return;
    }

    addLog(`\n========================================`);
    addLog(`📋 ACTUALIZANDO CLICKUP`);
    addLog(`========================================`);

    setIsLoading(true);
    setLoadingStatus("Actualizando tareas en ClickUp...");

    let successCount = 0;

    try {
      for (let rowIdx = 0; rowIdx < csvRows.length; rowIdx++) {
        const row = csvRows[rowIdx];
        const taskIds = row.task_clickup_ids
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0);

        if (taskIds.length === 0) {
          addLog(`⚠️ Sin task IDs para cuenta ${rowIdx + 1}`);
          continue;
        }

        addLog(`\n📦 Cuenta ${rowIdx + 1}: ${taskIds.length} tareas`);

        for (let artIdx = 0; artIdx < taskIds.length; artIdx++) {
          // 🗺️ Usar mapa exacto — si no hay URL para esta posición, saltarla
          const url = urlMapRef.current[rowIdx]?.[artIdx];
          if (!url) {
            addLog(`⚠️ Sin URL para cuenta[${rowIdx}] artículo[${artIdx}] — saltando task ${taskIds[artIdx]}`);
            continue;
          }

          const taskId = taskIds[artIdx];
          addLog(`🎯 Task ${artIdx + 1}/${taskIds.length}: ${taskId} → ${url.slice(0, 50)}...`);

          const urlSuccess = await updateClickUpTaskUrl(taskId, url);
          await wait(500);

          if (urlSuccess) {
            const completeSuccess = await markClickUpTaskComplete(taskId);
            await wait(500);
            if (completeSuccess) successCount++;
          }
        }
      }

      addLog(`\n========================================`);
      addLog(`✅ CLICKUP ACTUALIZADO`);
      addLog(`========================================`);
      addLog(`📊 ${successCount} tareas actualizadas exitosamente`);
      setClickupDone(true); // ← desbloquea botón Prodline

    } catch (e: any) {
      addLog(`❌ Error actualizando ClickUp: ${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // 🏭 Actualizar tareas de Prodline
  const updateProdlineTasks = async (): Promise<void> => {
    if (csvRows.length === 0) {
      addLog("❌ No hay filas CSV para actualizar Prodline");
      return;
    }

    addLog(`\n========================================`);
    addLog(`🏭 ACTUALIZANDO PRODLINE`);
    addLog(`========================================`);

    setIsLoading(true);
    setLoadingStatus("Actualizando tareas en Prodline...");

    let successCount = 0;
    let hasAnyProdlineIds = false;

    try {
      for (const row of csvRows) {
        // Verificar si existe la columna task_prodline_ids
        if (!row.task_prodline_ids || typeof row.task_prodline_ids !== 'string' || row.task_prodline_ids.trim().length === 0) {
          // No mostrar log por cada fila si no existe la columna
          continue;
        }

        hasAnyProdlineIds = true;

        // Parsear los IDs de Prodline
        const prodlineIds = row.task_prodline_ids
          .split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0);

        if (prodlineIds.length === 0) {
          addLog(`⚠️ Prodline IDs vacíos para cuenta ${row.account_uuid.slice(0, 12)}...`);
          continue;
        }

        addLog(`\n📦 Procesando ${prodlineIds.length} tareas de Prodline...`);

        for (const taskId of prodlineIds) {
          addLog(`🎯 Prodline Task: ${taskId.slice(0, 8)}...`);

          try {
            const ORBIDI_API_KEY = import.meta.env.VITE_ORBIDI_API_KEY;
            
            const response = await fetch(
              `https://eu.api.orbidi.com/prod-line/task/task-management/tasks/${taskId}/properties`,
              {
                method: 'POST',
                headers: {
                  'X-Api-Key': ORBIDI_API_KEY,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({
                  assigned_team: 'content_factory'
                })
              }
            );

            if (response.ok) {
              addLog(`✅ Prodline task ${taskId.slice(0, 8)}... actualizada`);
              successCount++;
            } else {
              const errorText = await response.text();
              addLog(`❌ Error ${response.status} en Prodline task ${taskId.slice(0, 8)}...`);
              addLog(`   Respuesta: ${errorText}`);
              addLog(`   URL: ${response.url}`);
              
              // Debug: mostrar los headers enviados
              console.error('Prodline Error Details:', {
                status: response.status,
                statusText: response.statusText,
                taskId: taskId,
                url: response.url,
                errorBody: errorText
              });
            }

            await wait(500); // Esperar entre llamadas
          } catch (error: any) {
            addLog(`❌ Error llamando API Prodline para ${taskId.slice(0, 8)}...: ${error.message}`);
          }
        }
      }

      addLog(`\n========================================`);
      addLog(`✅ PRODLINE ACTUALIZADO`);
      addLog(`========================================`);
      
      if (!hasAnyProdlineIds) {
        addLog(`ℹ️ No se encontraron IDs de Prodline en el CSV`);
        addLog(`💡 Tip: Agrega la columna 'task_prodline_ids' al CSV para habilitar esta función`);
      } else {
        addLog(`📊 ${successCount} tareas actualizadas exitosamente`);
      }
      setProdlineDone(true);

    } catch (e: any) {
      addLog(`❌ Error actualizando Prodline: ${e.message}`);
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  // 📥 Cargar la siguiente cuenta del CSV
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-inter text-slate-900 overflow-hidden">
      {/* Consola Lateral */}
      <aside className="hidden lg:flex w-80 bg-slate-950 flex-col border-r border-slate-800 p-8 shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <h1 className="text-white font-black text-2xl tracking-tight">
            PLINNG GEO<span className="text-[#A4D62C] text-4xl leading-none">.</span>
          </h1>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <span className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-4 block">Monitor de Red</span>
          <div className="bg-black/50 rounded-2xl border border-slate-800 p-5 font-mono text-[9px] leading-relaxed flex-1 overflow-y-auto custom-scrollbar text-slate-400">
            {logs.map((log, i) => (
              <div key={i} className="mb-2 border-l-2 border-[#A4D62C]/20 pl-3">
                {log}
              </div>
            ))}
            {logs.length === 0 && <div className="italic opacity-20">Inactivo...</div>}
          </div>
        </div>
      </aside>

      {/* Panel Principal */}
      <main className="flex-1 overflow-y-auto h-screen relative bg-white">
        <div className="max-w-4xl mx-auto p-12 lg:p-24">
          
          {step === AppStep.ACCOUNT && (
            <div className="animate-slideUp max-w-2xl mx-auto">
              {/* Vista de resumen final cuando se completa todo */}
              {batchProgress.isComplete ? (
                <div className="space-y-8">
                  <div className="text-center">
                    <div className="inline-block p-8 bg-green-100 rounded-full mb-6">
                      <i className="fas fa-trophy text-6xl text-green-600"></i>
                    </div>
                    <h2 className="text-5xl font-black text-green-900 mb-4">
                      ¡Producción Masiva Completada!
                    </h2>
                    <p className="text-green-600 text-xl">
                      {batchProgress.publishedUrls.length} artículos publicados exitosamente
                    </p>
                  </div>

                  <div className="bg-white p-10 rounded-[4rem] shadow-2xl border border-slate-100">
                    <h3 className="font-black text-slate-900 text-2xl mb-6 flex items-center gap-3">
                      <i className="fas fa-link text-[#A4D62C]"></i>
                      Enlaces Publicados
                    </h3>
                    
                    <div className="space-y-4">
                      {batchProgress.publishedUrls.map((url, idx) => (
                        <div key={idx} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-[#A4D62C]/50 transition-all group">
                          <div className="flex-shrink-0 w-10 h-10 bg-[#A4D62C]/20 rounded-xl flex items-center justify-center">
                            <span className="text-[#A4D62C] font-black text-lg">{idx + 1}</span>
                          </div>
                          <a 
                            href={url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex-1 text-[#A4D62C] hover:text-[#7A9E1F] text-base font-semibold truncate group-hover:underline"
                          >
                            {url}
                          </a>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(url);
                              addLog(`📋 URL copiada: ${url.slice(0, 50)}...`);
                            }}
                            className="flex-shrink-0 text-slate-400 hover:text-[#A4D62C] transition-colors"
                            title="Copiar URL"
                          >
                            <i className="fas fa-copy text-xl"></i>
                          </button>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 text-slate-400 hover:text-green-600 transition-colors"
                            title="Abrir en nueva pestaña"
                          >
                            <i className="fas fa-external-link-alt text-xl"></i>
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Formato v2: Prodline ya sincronizado inline — solo mostrar resumen */}
                  {isCsvV2Format ? (
                    <div className="flex items-center gap-4 p-5 bg-green-50 border-2 border-green-200 rounded-3xl">
                      <i className="fas fa-check-circle text-green-500 text-2xl"></i>
                      <span className="font-black text-green-700 text-lg">Prodline sincronizado automáticamente ✓</span>
                    </div>
                  ) : (
                    <>
                      {/* PASO 1: Botón para abrir confirmación ClickUp */}
                      {!showClickUpConfirm && !clickupDone && (
                        <button
                          onClick={() => setShowClickUpConfirm(true)}
                          disabled={isLoading}
                          className="w-full bg-gradient-to-r from-[#7A9E1F] to-[#A4D62C] text-white font-black py-6 rounded-3xl hover:from-[#6A8E15] hover:to-[#8DB525] transition-all text-xl flex items-center justify-center gap-4 shadow-2xl"
                        >
                          <i className="fas fa-check-double"></i>
                          1. Revisar y Actualizar ClickUp
                        </button>
                      )}

                      {/* Pantalla de confirmación ClickUp */}
                      {showClickUpConfirm && !clickupDone && (
                        <div className="bg-amber-50 border-2 border-amber-200 rounded-[3rem] p-8 space-y-6">
                          <div className="flex items-center gap-3">
                            <i className="fas fa-exclamation-triangle text-amber-500 text-2xl"></i>
                            <h3 className="font-black text-amber-900 text-xl">Confirmar actualización en ClickUp</h3>
                          </div>
                          <p className="text-amber-700 text-sm font-medium">
                            Verifica que cada Task ID reciba la URL correcta antes de continuar.
                          </p>
                          <div className="space-y-3 max-h-64 overflow-y-auto">
                            {csvRows.map((row, rowIdx) => {
                              const taskIds = row.task_clickup_ids.split(',').map(id => id.trim()).filter(Boolean);
                              return taskIds.map((taskId, artIdx) => {
                                const url = urlMapRef.current[rowIdx]?.[artIdx];
                                return (
                                  <div key={`${rowIdx}-${artIdx}`} className={`flex items-center gap-3 p-3 rounded-2xl text-sm ${url ? 'bg-white border border-slate-200' : 'bg-red-50 border border-red-200'}`}>
                                    <span className="flex-shrink-0 w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 font-black text-xs">{rowIdx+1}.{artIdx+1}</span>
                                    <span className="font-mono text-slate-400 text-xs flex-shrink-0">{taskId.slice(0, 14)}...</span>
                                    <i className="fas fa-arrow-right text-slate-300 flex-shrink-0"></i>
                                    {url
                                      ? <span className="text-[#7A9E1F] font-semibold truncate">{url}</span>
                                      : <span className="text-red-400 font-semibold italic">Sin URL (artículo falló)</span>
                                    }
                                  </div>
                                );
                              });
                            })}
                          </div>
                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => setShowClickUpConfirm(false)}
                              className="flex-1 py-4 rounded-2xl border-2 border-slate-200 font-black text-slate-500 hover:bg-slate-50 transition-all"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={async () => {
                                setShowClickUpConfirm(false);
                                await updateClickUpTasksAutomatic(publishedUrlsRef.current);
                              }}
                              disabled={isLoading}
                              className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-[#7A9E1F] to-[#A4D62C] text-white font-black hover:from-[#6A8E15] hover:to-[#8DB525] transition-all flex items-center justify-center gap-2"
                            >
                              {isLoading ? <><i className="fas fa-spinner fa-spin"></i> Actualizando...</> : <><i className="fas fa-check-double"></i> Confirmar y Actualizar</>}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ClickUp completado */}
                      {clickupDone && (
                        <div className="flex items-center gap-4 p-5 bg-green-50 border-2 border-green-200 rounded-3xl">
                          <i className="fas fa-check-circle text-green-500 text-2xl"></i>
                          <span className="font-black text-green-700 text-lg">ClickUp actualizado correctamente ✓</span>
                        </div>
                      )}

                      {/* PASO 2: Prodline — bloqueado hasta que ClickUp termine */}
                      <button
                        onClick={async () => {
                          if (!clickupDone || prodlineDone || isLoading) return;
                          await updateProdlineTasks();
                        }}
                        disabled={isLoading || !clickupDone || prodlineDone}
                        className={`w-full font-black py-6 rounded-3xl transition-all text-xl flex items-center justify-center gap-4 shadow-xl ${
                          prodlineDone
                            ? 'bg-green-100 text-green-600 cursor-not-allowed border-2 border-green-200'
                            : !clickupDone
                            ? 'bg-slate-100 text-slate-300 cursor-not-allowed border-2 border-slate-200'
                            : isLoading
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : 'bg-slate-900 text-white hover:bg-black'
                        }`}
                      >
                        {prodlineDone
                          ? <><i className="fas fa-check-circle"></i> Prodline Actualizado ✓</>
                          : isLoading && clickupDone
                          ? <><i className="fas fa-spinner fa-spin"></i> Actualizando Prodline...</>
                          : !clickupDone
                          ? <><i className="fas fa-lock text-slate-300"></i> 2. Actualizar Prodline (primero ClickUp)</>
                          : <><i className="fas fa-industry"></i> 2. Actualizar Prodline</>
                        }
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => {
                      setBatchProgress({
                        currentAccount: 0,
                        totalAccounts: 0,
                        currentArticle: 0,
                        totalArticles: 0,
                        publishedUrls: [],
                        isComplete: false
                      });
                      setCsvRows([]);
                      setCsvRowsV2([]);
                      setIsCsvV2Format(false);
                      setIsManualMode(false);
                      setClickupDone(false);
                      setProdlineDone(false);
                      setShowClickUpConfirm(false);
                    }}
                    className="w-full bg-slate-900 text-white font-black py-6 rounded-3xl hover:bg-black transition-all text-xl flex items-center justify-center gap-4"
                  >
                    <i className="fas fa-plus-circle"></i>
                    Nueva Producción
                  </button>
                </div>
              ) : (
                /* Vista normal de selección de modo */
                <>
              <div className="text-center mb-10">
                <h2 className="text-4xl font-black tracking-tighter mb-2">PLINNG GEO<span className="text-[#A4D62C] text-5xl leading-none">.</span></h2>
                <p className="text-slate-400 text-sm font-medium">Where SEO meets Generative Engines</p>
              </div>

              <div className="bg-white p-10 rounded-[4rem] shadow-2xl border border-slate-100 mb-8">
                {/* Tabs: Generar 1 Articulo / Carga Masiva / Feedback */}
                <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-10">
                  <button
                    onClick={() => { setIsManualMode(false); setIsFeedbackMode(false); }}
                    className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${!isManualMode && !isFeedbackMode ? 'bg-white shadow-sm text-[#A4D62C]' : 'text-slate-500'}`}
                  >
                    GENERAR 1 ARTICULO
                  </button>
                  <button
                    onClick={() => { setIsManualMode(true); setIsFeedbackMode(false); }}
                    className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${isManualMode && !isFeedbackMode ? 'bg-white shadow-sm text-[#A4D62C]' : 'text-slate-500'}`}
                  >
                    CARGA MASIVA
                  </button>
                  <button
                    onClick={() => { setIsFeedbackMode(true); setIsManualMode(false); setFeedbackStatus('idle'); setFeedbackStatusMsg(''); }}
                    className={`flex-1 py-3 rounded-xl font-black text-[10px] transition-all ${isFeedbackMode ? 'bg-white shadow-sm text-[#A4D62C]' : 'text-slate-500'}`}
                  >
                    FEEDBACK
                  </button>
                </div>

                {/* MODO 3: FEEDBACK */}
                {isFeedbackMode ? (
                  <div className="space-y-6">
                    {feedbackStatus === 'success' ? (
                      <div className="text-center space-y-6">
                        <div className="inline-block p-6 bg-green-100 rounded-full">
                          <i className="fas fa-check-circle text-5xl text-green-600"></i>
                        </div>
                        <h3 className="text-2xl font-black text-green-900">¡Artículo actualizado!</h3>
                        <a
                          href={feedbackStatusMsg}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[#A4D62C] hover:underline font-semibold break-all text-sm"
                        >
                          {feedbackStatusMsg}
                        </a>
                        <button
                          onClick={() => { setFeedbackStatus('idle'); setFeedbackStatusMsg(''); setFeedbackAccountUuid(''); setFeedbackWpUrl(''); setFeedbackText(''); setFeedbackTaskUuid(''); setFeedbackContentType('on_blog'); }}
                          className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl hover:bg-black transition-all"
                        >
                          Nuevo Feedback
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Account UUID */}
                        <div>
                          <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-3 block tracking-widest">
                            Account UUID del Cliente
                          </label>
                          <input
                            type="text"
                            className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-[#A4D62C] outline-none font-mono text-sm"
                            placeholder="34ad9915-6fdc-4aed-81a9..."
                            value={feedbackAccountUuid}
                            onChange={e => setFeedbackAccountUuid(e.target.value)}
                          />
                        </div>

                        {/* Tipo de artículo */}
                        <div>
                          <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-3 block tracking-widest">
                            Tipo de Artículo
                          </label>
                          <div className="flex gap-3">
                            {(['on_blog', 'off_page', 'gmb'] as ContentType[]).map(ct => (
                              <button
                                key={ct}
                                onClick={() => setFeedbackContentType(ct)}
                                className={`flex-1 py-3 rounded-xl font-black text-[11px] transition-all border-2 ${feedbackContentType === ct ? 'border-[#A4D62C] bg-[#A4D62C]/10 text-[#7A9E1F]' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
                              >
                                {ct === 'on_blog' ? 'ON BLOG' : ct === 'off_page' ? 'OFF PAGE' : 'GMB'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* URL del artículo en WP */}
                        <div>
                          <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-3 block tracking-widest">
                            URL del Artículo en WordPress
                          </label>
                          <input
                            type="url"
                            className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-[#A4D62C] outline-none font-mono text-sm"
                            placeholder="https://masproposals.com/mi-articulo-seo/"
                            value={feedbackWpUrl}
                            onChange={e => setFeedbackWpUrl(e.target.value)}
                          />
                        </div>

                        {/* Feedback del cliente */}
                        <div>
                          <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-3 block tracking-widest">
                            Feedback del Cliente
                          </label>
                          <textarea
                            rows={5}
                            className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-[#A4D62C] outline-none text-sm resize-none"
                            placeholder="Describe los cambios que solicita el cliente. Ej: Cambiar el tono a más formal, agregar información sobre precios, enfocar más en el barrio X..."
                            value={feedbackText}
                            onChange={e => setFeedbackText(e.target.value)}
                          />
                        </div>

                        {/* Task UUID para Prodline */}
                        <div>
                          <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-3 block tracking-widest">
                            Task UUID (Prodline)
                          </label>
                          <input
                            type="text"
                            className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-[#A4D62C] outline-none font-mono text-sm"
                            placeholder="uuid de la tarea en Prodline..."
                            value={feedbackTaskUuid}
                            onChange={e => setFeedbackTaskUuid(e.target.value)}
                          />
                        </div>

                        {/* Error */}
                        {feedbackStatus === 'error' && (
                          <div className="flex items-start gap-3 p-4 bg-red-50 border-2 border-red-200 rounded-2xl text-red-700 text-sm">
                            <i className="fas fa-exclamation-circle mt-0.5 flex-shrink-0"></i>
                            <span>{feedbackStatusMsg}</span>
                          </div>
                        )}

                        {/* Loading status */}
                        {feedbackStatus === 'loading' && (
                          <div className="flex items-center gap-3 p-4 bg-[#A4D62C]/10 border-2 border-[#A4D62C]/30 rounded-2xl text-[#7A9E1F] text-sm font-semibold">
                            <i className="fas fa-spinner fa-spin flex-shrink-0"></i>
                            <span>{feedbackStatusMsg}</span>
                          </div>
                        )}

                        {/* Submit */}
                        <button
                          onClick={handleFeedbackFlow}
                          disabled={feedbackStatus === 'loading'}
                          className={`w-full font-black py-6 rounded-3xl shadow-xl transition-all text-lg flex items-center justify-center gap-4 ${
                            feedbackStatus === 'loading'
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              : 'bg-[#A4D62C] text-white hover:bg-[#8DB525]'
                          }`}
                        >
                          {feedbackStatus === 'loading'
                            ? <><i className="fas fa-spinner fa-spin"></i> Procesando...</>
                            : <><i className="fas fa-sync-alt"></i> Aplicar Feedback y Actualizar</>
                          }
                        </button>
                      </>
                    )}
                  </div>
                ) : !isManualMode ? (
                  <div className="space-y-8">
                    <div>
                      <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-4 block tracking-widest">
                        UUID del Cliente (Account UUID)
                      </label>
                      <input 
                        type="text" 
                        className="w-full px-8 py-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-[#A4D62C] outline-none font-black text-2xl text-center"
                        placeholder="34ad9915-6fdc-4aed-81a9..."
                        value={accountUuid}
                        onChange={e => setAccountUuid(e.target.value)}
                      />
                    </div>
                    <button 
                      onClick={fetchBrief}
                      disabled={isLoading}
                      className="w-full bg-[#A4D62C] text-white font-black py-6 rounded-3xl shadow-xl hover:bg-[#8DB525] transition-all flex items-center justify-center gap-4 text-lg"
                    >
                      {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic"></i>}
                      {isLoading ? 'Procesando...' : 'Generar 1 Artículo'}
                    </button>
                    <div className="text-[10px] text-slate-400 text-center font-medium leading-relaxed bg-slate-50 p-4 rounded-xl">
                      <i className="fas fa-info-circle mr-1"></i> 
                      Genera un artículo SEO completo con imagen, 3 enlaces internos y categorización automática.
                    </div>
                  </div>
                ) : (
                  /* MODO 2: CARGA MASIVA CSV (Producción en lote) */
                  <div className="space-y-8">
                    {/* Vista de carga del CSV */}
                    {!isLoading && !batchProgress.isComplete && (
                      <>
                        <div>
                          <label className="text-[10px] font-black uppercase text-[#A4D62C] mb-4 block tracking-widest">
                            Archivo CSV de Producción
                          </label>
                          <div className="border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center hover:border-[#A4D62C]/70 transition-all bg-slate-50">
                            <i className="fas fa-file-csv text-5xl text-slate-300 mb-4"></i>
                            <input
                              type="file"
                              accept=".csv"
                              onChange={handleCsvUpload}
                              className="hidden"
                              id="csv-upload"
                            />
                            <label
                              htmlFor="csv-upload"
                              className="cursor-pointer block"
                            >
                              <span className="text-[#A4D62C] font-black text-lg block mb-2">
                                {isCsvV2Format && csvRowsV2.length > 0
                                  ? `✓ ${csvRowsV2.length} cuentas (formato v2)`
                                  : csvRows.length > 0
                                    ? `✓ ${csvRows.length} filas cargadas`
                                    : 'Haz clic para cargar CSV'}
                              </span>
                              <span className="text-slate-400 text-[11px] block">
                                Formato v2: account_uuid, count_onblog, count_offpa, count_postnoticias, task_uuid_*
                              </span>
                            </label>
                          </div>
                        </div>

                        {(isCsvV2Format ? csvRowsV2.length > 0 : csvRows.length > 0) && (
                          <div className="bg-[#A4D62C]/10 border-2 border-[#A4D62C]/20 rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-4">
                              <div>
                                <p className="font-black text-indigo-900 text-lg">
                                  📊 {isCsvV2Format ? csvRowsV2.length : csvRows.length} cuentas detectadas
                                  {isCsvV2Format && <span className="ml-2 text-xs bg-[#A4D62C] text-white px-2 py-0.5 rounded-full">v2</span>}
                                </p>
                                <p className="text-[#A4D62C] text-sm">
                                  {isCsvV2Format
                                    ? `Total piezas: ${csvRowsV2.reduce((s, r) => s + r.count_onblog + r.count_offpa + r.count_postnoticias, 0)}`
                                    : `Total artículos: ${csvRows.reduce((sum, row) => sum + row.task_count, 0)}`}
                                </p>
                              </div>
                              <button
                                onClick={() => { setCsvRows([]); setCsvRowsV2([]); setIsCsvV2Format(false); setCurrentRowIndex(0); }}
                                className="text-[#A4D62C]/80 hover:text-[#A4D62C]"
                              >
                                <i className="fas fa-times-circle text-2xl"></i>
                              </button>
                            </div>
                            <div className="text-[10px] text-[#7A9E1F] bg-white rounded-xl p-4 max-h-32 overflow-y-auto">
                              {isCsvV2Format
                                ? csvRowsV2.slice(0, 5).map((row, i) => (
                                    <div key={i} className="mb-2 border-b border-[#A4D62C]/20 pb-2 last:border-0">
                                      <span className="font-black">Cuenta {i + 1}:</span> {row.account_uuid.slice(0, 20)}...
                                      <span className="ml-2 text-[#A4D62C]">blog:{row.count_onblog} · off:{row.count_offpa} · gmb:{row.count_postnoticias}</span>
                                    </div>
                                  ))
                                : csvRows.slice(0, 5).map((row, i) => (
                                    <div key={i} className="mb-2 border-b border-[#A4D62C]/20 pb-2 last:border-0">
                                      <span className="font-black">Cuenta {i + 1}:</span> {row.account_uuid.slice(0, 20)}...
                                      <span className="ml-2 text-[#A4D62C]">→ {row.task_count} artículos</span>
                                    </div>
                                  ))
                              }
                              {(isCsvV2Format ? csvRowsV2.length : csvRows.length) > 5 && (
                                <div className="text-[#A4D62C]/80 italic mt-2">
                                  + {(isCsvV2Format ? csvRowsV2.length : csvRows.length) - 5} cuentas más...
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={isCsvV2Format ? startBatchProductionV2 : startBatchProduction}
                          disabled={isLoading || (isCsvV2Format ? csvRowsV2.length === 0 : csvRows.length === 0)}
                          className={`w-full font-black py-6 rounded-3xl shadow-xl transition-all text-lg flex items-center justify-center gap-4 ${
                            (isCsvV2Format ? csvRowsV2.length > 0 : csvRows.length > 0)
                              ? 'bg-[#A4D62C] text-white hover:bg-[#8DB525]'
                              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <i className="fas fa-industry"></i>
                          Iniciar Producción Masiva
                        </button>
                      </>
                    )}

                    {!isLoading && !batchProgress.isComplete && csvRows.length === 0 && (
                      <div className="text-[10px] text-slate-400 text-center font-medium leading-relaxed bg-slate-50 p-4 rounded-xl">
                        <i className="fas fa-lightbulb mr-1"></i> 
                        Cada fila del CSV genera automáticamente el número de artículos especificado en task_count.
                      </div>
                    )}
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          )}

          {step === AppStep.KEYWORDS && (
            <div className="animate-slideUp">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">Palabras Clave SEO</h2>
                <p className="text-slate-500">Define los términos que posicionarán este artículo</p>
              </div>

              <div className="bg-white p-12 rounded-[4rem] shadow-2xl border border-slate-100 mb-10">
                <div className="flex flex-wrap gap-4 mb-12 min-h-[100px] content-start">
                  {keywords.map((kw, i) => (
                    <div key={i} className="bg-[#A4D62C]/10 px-6 py-4 rounded-2xl flex items-center gap-4 border border-[#A4D62C]/20 hover:border-[#A4D62C] transition-all group">
                      <span className="font-black text-[#7A9E1F] text-lg">#{kw}</span>
                      <button onClick={() => setKeywords([])} className="text-indigo-300 group-hover:text-rose-500 transition-colors">
                        <i className="fas fa-times-circle text-xl"></i>
                      </button>
                    </div>
                  ))}
                  {keywords.length === 0 && <p className="text-slate-300 italic py-4">No hay palabras clave definidas...</p>}
                </div>
                
                <div className="flex gap-4">
                  <div className="relative flex-1">
                    <i className="fas fa-search absolute left-6 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input 
                      type="text" 
                      className="w-full px-14 py-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-[#A4D62C] outline-none font-bold text-lg"
                      placeholder="Añadir keyword personalizada..."
                      value={newKeyword}
                      onChange={e => setNewKeyword(e.target.value)}
                      onKeyPress={e => {
                        if (e.key === 'Enter' && newKeyword.trim()) {
                          // solo se permite una keyword; reemplazamos la existente
                          setKeywords([newKeyword.trim()]);
                          setNewKeyword('');
                        }
                      }}
                    />
                  </div>
                  <button 
                    onClick={() => { if(newKeyword.trim()) { setKeywords([newKeyword.trim()]); setNewKeyword(''); } }} 
                    className="bg-slate-900 text-white px-10 py-5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#A4D62C] transition-all shadow-lg"
                  >
                    Añadir
                  </button>
                </div>
              </div>
              
              <button
                onClick={() => {
                  if (keywords.length === 0) return;
                  if (batchProgress.totalAccounts > 0) {
                    // Modo CSV: saltar selección de tipo y usar el tipo del CSV
                    setIsLoading(true);
                    proceedToOutlineCSV(keywords)
                      .then(() => setStep(AppStep.OUTLINE))
                      .catch((e: any) => addLog(`Error: ${e.message}`))
                      .finally(() => setIsLoading(false));
                  } else {
                    // Modo manual: mostrar selector de tipo de contenido
                    setStep(AppStep.CONTENT_TYPE);
                  }
                }}
                disabled={keywords.length === 0}
                className={`w-full font-black py-8 rounded-[3rem] shadow-2xl transition-all text-2xl tracking-tight flex items-center justify-center gap-4 ${keywords.length > 0 ? 'bg-[#A4D62C] text-white hover:bg-[#8DB525]' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              >
                <i className="fas fa-layer-group"></i>
                Continuar
              </button>
            </div>
          )}

          {step === AppStep.CONTENT_TYPE && (
            <div className="animate-slideUp">
              <div className="text-center mb-12">
                <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">Tipo de Contenido</h2>
                <p className="text-slate-500">Elige el formato que quieres generar para esta keyword</p>
              </div>

              <div className="grid gap-6">
                {/* SEO Blog Article */}
                <button
                  onClick={() => proceedToWebsiteAnalysis('on_blog')}
                  disabled={isLoading}
                  className="w-full text-left bg-white p-10 rounded-[3rem] shadow-xl border-2 border-transparent hover:border-[#A4D62C] hover:shadow-2xl transition-all group"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-[#A4D62C]/10 rounded-2xl flex items-center justify-center group-hover:bg-[#A4D62C] transition-all">
                      <i className="fas fa-newspaper text-2xl text-[#A4D62C] group-hover:text-white transition-all"></i>
                    </div>
                    <div>
                      <p className="font-black text-2xl text-slate-900">Artículo SEO Blog</p>
                      <p className="text-slate-500 mt-1">Artículo on-page de formato largo con H2, imagen y enlaces internos</p>
                    </div>
                    <i className="fas fa-chevron-right ml-auto text-slate-300 group-hover:text-[#A4D62C] transition-all text-xl"></i>
                  </div>
                </button>

                {/* SEO Off-Page Article */}
                <button
                  onClick={() => proceedToWebsiteAnalysis('off_page')}
                  disabled={isLoading}
                  className="w-full text-left bg-white p-10 rounded-[3rem] shadow-xl border-2 border-transparent hover:border-[#A4D62C] hover:shadow-2xl transition-all group"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center group-hover:bg-blue-500 transition-all">
                      <i className="fas fa-link text-2xl text-blue-400 group-hover:text-white transition-all"></i>
                    </div>
                    <div>
                      <p className="font-black text-2xl text-slate-900">Artículo SEO Off-Page</p>
                      <p className="text-slate-500 mt-1">Publicado en sitio externo (cienciacronica, elinformedigital o laprensa360)</p>
                    </div>
                    <i className="fas fa-chevron-right ml-auto text-slate-300 group-hover:text-[#A4D62C] transition-all text-xl"></i>
                  </div>
                </button>

                {/* Google My Business */}
                <button
                  onClick={() => {
                    setContentType('gmb');
                    contentTypeRef.current = 'gmb';
                    startWritingGmb();
                  }}
                  disabled={isLoading}
                  className="w-full text-left bg-white p-10 rounded-[3rem] shadow-xl border-2 border-transparent hover:border-[#A4D62C] hover:shadow-2xl transition-all group"
                >
                  <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center group-hover:bg-red-500 transition-all">
                      <i className="fab fa-google text-2xl text-red-400 group-hover:text-white transition-all"></i>
                    </div>
                    <div>
                      <p className="font-black text-2xl text-slate-900">Post Google My Business</p>
                      <p className="text-slate-500 mt-1">Publicación corta optimizada para GMB, SEO local y búsqueda por proximidad</p>
                    </div>
                    <i className="fas fa-chevron-right ml-auto text-slate-300 group-hover:text-[#A4D62C] transition-all text-xl"></i>
                  </div>
                </button>
              </div>

              <button
                onClick={() => setStep(AppStep.KEYWORDS)}
                className="mt-8 text-slate-400 hover:text-slate-700 text-sm font-semibold flex items-center gap-2 transition-colors"
              >
                <i className="fas fa-arrow-left"></i> Volver a keywords
              </button>
            </div>
          )}

          {step === AppStep.WEBSITE_ANALYSIS && (
            <div className="animate-slideUp">
              <div className="text-center mb-10">
                <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">Análisis Web</h2>
                <p className="text-slate-500">El agente analiza el sitio del cliente para personalizar el artículo</p>
              </div>

              {isLoading && !contentContext && !websiteAnalysisError && (
                <div className="bg-white p-14 rounded-[4rem] shadow-2xl border border-slate-100 text-center">
                  <div className="w-16 h-16 border-4 border-[#A4D62C] border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                  <p className="text-slate-600 font-semibold text-lg">{loadingStatus || 'Analizando sitio web...'}</p>
                </div>
              )}

              {websiteAnalysisError && (
                <div className="bg-white p-10 rounded-[3rem] shadow-xl border-2 border-orange-200 mb-6">
                  <div className="flex items-center gap-4 mb-4">
                    <i className="fas fa-exclamation-triangle text-orange-400 text-2xl"></i>
                    <p className="font-bold text-slate-800">Análisis no disponible</p>
                  </div>
                  <p className="text-slate-500 text-sm mb-6">{websiteAnalysisError}</p>
                  <div className="flex gap-4">
                    <button
                      onClick={() => { setContentContext(null); proceedToOutline(); }}
                      className="flex-1 bg-[#A4D62C] text-slate-900 font-black py-4 px-8 rounded-2xl hover:bg-[#93c228] transition-all"
                    >
                      Continuar sin contexto
                    </button>
                    <button
                      onClick={() => setStep(AppStep.CONTENT_TYPE)}
                      className="text-slate-400 hover:text-slate-700 text-sm font-semibold px-4 transition-colors"
                    >
                      <i className="fas fa-arrow-left mr-2"></i>Volver
                    </button>
                  </div>
                </div>
              )}

              {contentContext && !isLoading && (
                <div className="space-y-6">
                  <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100">
                    <div className="mb-6">
                      <label className="text-[10px] font-black text-[#A4D62C] uppercase tracking-widest block mb-2">Título propuesto</label>
                      <p className="text-2xl font-black text-slate-900">{contentContext.proposed_title}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-6 mb-6">
                      <div>
                        <label className="text-[10px] font-black text-[#A4D62C] uppercase tracking-widest block mb-2">Keywords primarias</label>
                        <div className="flex flex-wrap gap-2">
                          {contentContext.primary_keywords.map((kw, i) => (
                            <span key={i} className="bg-[#A4D62C]/10 text-[#5a7a10] text-xs font-bold px-3 py-1 rounded-full">{kw}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Keywords secundarias</label>
                        <div className="flex flex-wrap gap-2">
                          {contentContext.secondary_keywords.map((kw, i) => (
                            <span key={i} className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">{kw}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Intención de búsqueda</label>
                      <p className="text-slate-700 text-sm">{contentContext.search_intent}</p>
                    </div>

                    <div className="mb-6">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Contexto de marca</label>
                      <p className="text-slate-700 text-sm">{contentContext.brand_context_summary}</p>
                    </div>

                    <div className="mb-6">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Pregunta principal del usuario</label>
                      <p className="text-slate-700 text-sm font-semibold">{contentContext.main_user_question}</p>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Estructura sugerida</label>
                      <ol className="space-y-1">
                        {contentContext.suggested_structure.map((s, i) => (
                          <li key={i} className="text-slate-700 text-sm flex items-start gap-2">
                            <span className="text-[#A4D62C] font-black text-xs mt-0.5">H2</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={proceedToOutline}
                      className="flex-1 bg-[#A4D62C] text-slate-900 font-black py-5 px-10 rounded-2xl hover:bg-[#93c228] transition-all text-lg shadow-lg"
                    >
                      Generar outline con este contexto
                    </button>
                    <button
                      onClick={() => { setContentContext(null); proceedToOutline(); }}
                      className="text-slate-400 hover:text-slate-700 text-sm font-semibold px-4 transition-colors"
                    >
                      Saltar
                    </button>
                  </div>

                  <button
                    onClick={() => setStep(AppStep.CONTENT_TYPE)}
                    className="text-slate-400 hover:text-slate-700 text-sm font-semibold flex items-center gap-2 transition-colors"
                  >
                    <i className="fas fa-arrow-left"></i> Volver al tipo de contenido
                  </button>
                </div>
              )}
            </div>
          )}

          {step === AppStep.OUTLINE && (
            <div className="animate-slideUp">
              <h2 className="text-3xl font-black text-slate-900 mb-10">Arquitectura de Contenidos</h2>
              <div className="bg-white p-14 rounded-[4.5rem] shadow-2xl border border-slate-100 mb-10 space-y-12">
                <div>
                  <label className="text-[10px] font-black text-[#A4D62C] uppercase tracking-widest block mb-4">H1 - Título Maestro</label>
                  <input 
                    className="w-full text-4xl font-black text-slate-900 outline-none border-b-2 border-slate-50 focus:border-[#A4D62C]/30 py-4 transition-all" 
                    value={article.title || ''} 
                    onChange={e => setArticle({...article, title: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-[#A4D62C] uppercase tracking-widest block mb-4">Introducción (40 palabras)</label>
                  <textarea
                    className="w-full text-lg text-slate-700 outline-none border border-slate-200 rounded-lg p-4 resize-none h-32"
                    value={article.introduction || ''}
                    onChange={e => setArticle({...article, introduction: e.target.value})}
                  />
                </div>
                <div className="space-y-6">
                  <label className="text-[10px] font-black text-[#A4D62C] uppercase tracking-widest block mb-4">H2 - Estructura de Secciones</label>
                  {(article.sections || []).map((s, i) => (
                    <div key={i} className="flex items-center gap-8 p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 group hover:bg-white hover:shadow-xl transition-all">
                      <div className="w-14 h-14 bg-[#A4D62C] text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-xl">{i+1}</div>
                      <input 
                        className="flex-1 bg-transparent font-black text-2xl text-slate-700 outline-none" 
                        value={s.title || ''} 
                        onChange={e => { 
                          const newSec = [...article.sections!]; 
                          newSec[i].title = e.target.value; 
                          setArticle({...article, sections: newSec}); 
                        }} 
                      />
                    </div>
                  ))}
                </div>
              </div>
              <button 
                    onClick={() => startWriting(article, clientWebsite)}
                    disabled={!(article.sections && article.sections.length > 0)}
                    title={!(article.sections && article.sections.length > 0) ? 'Genera primero la estructura H2' : undefined}
                    className={`w-full font-black py-8 rounded-[3rem] shadow-2xl transition-all text-2xl tracking-widest flex items-center justify-center gap-4 ${
                      article.sections && article.sections.length > 0
                        ? 'bg-[#A4D62C] text-white hover:bg-[#8DB525]' 
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    Redactar Post Completo
                  </button>
            </div>
          )}

          {step === AppStep.WRITING && (
            <div className="animate-fadeIn pb-40">
              <div className="flex flex-col md:flex-row items-center justify-between mb-16 gap-8">
                <div>
                  <h1 className="text-5xl font-black tracking-tighter text-slate-900">Resultado Final</h1>
                  <p className="text-slate-400 font-bold uppercase text-[11px] tracking-widest mt-2">
                    {batchProgress.totalAccounts > 0 
                      ? `Artículo ${batchProgress.currentArticle}/${batchProgress.totalArticles} • Cuenta ${batchProgress.currentAccount}/${batchProgress.totalAccounts}`
                      : 'Borrador optimizado y listo para WordPress'
                    }
                  </p>
                </div>
                <div className="flex gap-4 w-full md:w-auto flex-wrap">
                  {batchProgress.totalAccounts === 0 && (
                    <button onClick={() => setStep(AppStep.ACCOUNT)} className="flex-1 md:flex-none px-10 py-5 rounded-[2rem] border-2 border-slate-200 font-black text-[11px] hover:bg-slate-50 transition-all uppercase">NUEVO</button>
                  )}
                  <button 
                    onClick={async () => {
                      const result = await publish(article);
                      
                      // En modo batch: capturar URL y continuar el flujo automáticamente
                      if (batchProgress.totalAccounts > 0 && result) {
                        await wait(500);

                        // Incrementar contador via ref para que autoContinue lo vea
                        currentArticleRef.current = currentArticleRef.current + 1;
                        const newCount = currentArticleRef.current;

                        // Guardar URL en mapa si hubo éxito
                        if (result.success && result.url) {
                          const rowIdx = currentAccountRef.current - 1;
                          const artIdx = newCount - 1;
                          if (!urlMapRef.current[rowIdx]) urlMapRef.current[rowIdx] = {};
                          urlMapRef.current[rowIdx][artIdx] = result.url;
                          publishedUrlsRef.current.push(result.url);
                          addLog(`📋 URL guardada manualmente: ${result.url}`);
                          setBatchProgress(prev => ({
                            ...prev,
                            currentArticle: newCount,
                            publishedUrls: [...prev.publishedUrls, result.url!]
                          }));
                        } else {
                          setBatchProgress(prev => ({ ...prev, currentArticle: newCount }));
                        }

                        // Retomar flujo automático
                        addLog(`🔄 Retomando flujo batch desde artículo ${newCount}...`);
                        await wait(1500);
                        await autoContinue(newCount, totalArticlesRef.current);
                      }
                    }}
                    disabled={isPublishing} 
                    className="flex-1 md:flex-none bg-[#A4D62C] text-white px-10 py-5 rounded-[2rem] font-black text-[11px] shadow-2xl hover:bg-[#8DB525] transition-all flex items-center justify-center gap-3 uppercase"
                  >
                    {isPublishing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fab fa-wordpress text-lg"></i>}
                    Publicar con Imagen
                  </button>

                  {/* Botón de recuperación: solo visible cuando el proceso batch se colgó y ya hay un publishResult */}
                  {batchProgress.totalAccounts > 0 && publishResult?.success && !isLoading && !isPublishing && (
                    <button
                      onClick={async () => {
                        addLog(`🔄 Recuperación manual: continuando desde artículo ${currentArticleRef.current}/${totalArticlesRef.current}...`);
                        await autoContinue(currentArticleRef.current, totalArticlesRef.current);
                      }}
                      className="flex-1 md:flex-none bg-slate-800 text-white px-10 py-5 rounded-[2rem] font-black text-[11px] shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3 uppercase"
                    >
                      <i className="fas fa-play-circle"></i>
                      Continuar Proceso
                    </button>
                  )}
                </div>
              </div>

              {publishResult && (
                <div className={`mb-16 p-12 rounded-[4rem] border-4 flex flex-col gap-6 shadow-2xl animate-slideUp ${publishResult.success ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`}>
                  <div className="flex items-center gap-10">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center ${publishResult.success ? 'bg-emerald-500' : 'bg-rose-500'} text-white text-4xl shadow-2xl shrink-0`}>
                      <i className={`fas ${publishResult.success ? 'fa-check' : 'fa-times'}`}></i>
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-3xl text-slate-900">{publishResult.msg}</p>
                      {publishResult.url && (
                        <a href={publishResult.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-[#A4D62C] font-black underline underline-offset-8 text-lg mt-4 group">
                          Ver Artículo Publicado
                          <i className="fas fa-external-link-alt text-sm group-hover:translate-x-1 transition-transform"></i>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 🚀 PRODLINE: botón post-publicación solo en modo auto */}
              {!isManualMode && publishResult?.success && publishResult.url && (
                <div className="mb-16 p-12 rounded-[4rem] border-4 border-slate-200 bg-slate-50 shadow-xl animate-slideUp flex flex-col gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-white text-2xl shrink-0">
                      <i className="fas fa-paper-plane"></i>
                    </div>
                    <p className="font-black text-2xl text-slate-900">Enviar a Prodline</p>
                  </div>
                  <p className="text-slate-500 text-lg">Ingresa el Task UUID de Prodline para registrar el deliverable con la URL del artículo publicado.</p>
                  <div className="flex gap-4 flex-wrap">
                    <input
                      type="text"
                      placeholder="Task UUID de Prodline"
                      value={prodlineUuidInput}
                      onChange={e => { setProdlineUuidInput(e.target.value); setProdlineSubmitStatus('idle'); setProdlineSubmitMsg(''); }}
                      disabled={prodlineSubmitStatus === 'loading' || prodlineSubmitStatus === 'success'}
                      className="flex-1 min-w-[280px] border-2 border-slate-300 rounded-2xl px-6 py-4 font-mono text-lg focus:outline-none focus:border-[#A4D62C] disabled:opacity-50"
                    />
                    <button
                      disabled={!prodlineUuidInput.trim() || prodlineSubmitStatus === 'loading' || prodlineSubmitStatus === 'success'}
                      onClick={async () => {
                        const taskUuid = prodlineUuidInput.trim();
                        if (!taskUuid) return;
                        setProdlineSubmitStatus('loading');
                        setProdlineSubmitMsg('');
                        const ORBIDI_API_KEY = import.meta.env.VITE_ORBIDI_API_KEY;
                        const ct = contentTypeRef.current ?? 'on_blog';
                        const result = await syncMarketingActionDirect(taskUuid, publishResult.url!, ct, ORBIDI_API_KEY);
                        if (result.success) {
                          setProdlineSubmitStatus('success');
                          setProdlineSubmitMsg('Deliverable sincronizado correctamente en Prodline.');
                        } else {
                          setProdlineSubmitStatus('error');
                          setProdlineSubmitMsg(`Error: ${result.error}`);
                        }
                      }}
                      className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-black text-[11px] uppercase shadow-lg hover:bg-black transition-all flex items-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {prodlineSubmitStatus === 'loading' ? (
                        <><i className="fas fa-spinner fa-spin"></i> Enviando...</>
                      ) : prodlineSubmitStatus === 'success' ? (
                        <><i className="fas fa-check"></i> Enviado</>
                      ) : (
                        <><i className="fas fa-paper-plane"></i> Enviar</>
                      )}
                    </button>
                  </div>
                  {prodlineSubmitMsg && (
                    <p className={`text-lg font-bold ${prodlineSubmitStatus === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {prodlineSubmitMsg}
                    </p>
                  )}
                </div>
              )}

              {contentType === 'gmb' && gmbPostData ? (
                /* 🗺️ GMB CARD PREVIEW */
                <div className="bg-white rounded-[5rem] shadow-2xl border border-slate-100 overflow-hidden">
                  {article.featuredImage && typeof article.featuredImage === 'object' && article.featuredImage.base64 && (
                    <img
                      src={article.featuredImage.base64}
                      className="w-full object-cover"
                      style={{ aspectRatio: '4/3' }}
                      alt={article.featuredImage.altText || gmbPostData.title}
                    />
                  )}
                  <div className="p-20 lg:p-32 max-w-3xl mx-auto space-y-10">
                    <h2 className="text-5xl font-black text-slate-900 leading-tight">{gmbPostData.title}</h2>
                    <p className="text-2xl leading-[1.8] text-slate-600">{gmbPostData.description}</p>
                    {gmbPostData.information && (
                      <p className="text-xl text-slate-500 italic">{gmbPostData.information}</p>
                    )}
                    <p className="text-xl font-bold text-slate-700">{gmbPostData.cta}</p>
                    <span className="inline-block bg-slate-900 text-white text-lg font-black px-10 py-4 rounded-full">
                      {gmbPostData.button}
                    </span>
                  </div>
                </div>
              ) : (
                /* 📰 SEO ARTICLE PREVIEW */
                <article className="bg-white rounded-[5rem] shadow-2xl border border-slate-100 overflow-hidden">
                  {article.featuredImage && typeof article.featuredImage === 'object' && article.featuredImage.base64 ? (
                    <div className="h-[600px] relative">
                      <img src={article.featuredImage.base64} className="w-full h-full object-cover" alt="Hero" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent"></div>
                      <div className="absolute bottom-20 left-20 right-20 text-white">
                        <h2 className="text-6xl font-black leading-tight drop-shadow-2xl">{article.title}</h2>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-900 p-20 text-white">
                      <h2 className="text-6xl font-black leading-tight">{article.title}</h2>
                    </div>
                  )}
                  <div className="p-20 lg:p-32 max-w-4xl mx-auto space-y-24">
                    {article.introduction && (
                      <div className="text-2xl leading-[1.8] text-slate-600 whitespace-pre-wrap content-style" dangerouslySetInnerHTML={{ __html: article.introduction }} />
                    )}
                    {(article.sections || []).map((section, idx) => (
                      <section key={idx}>
                        <h2 className="text-4xl font-black text-slate-900 mb-10 tracking-tight">{`${idx + 1}. ${section.title}`}</h2>
                        <div className="text-2xl leading-[1.8] text-slate-600 whitespace-pre-wrap content-style" dangerouslySetInnerHTML={{ __html: section.content }} />
                      </section>
                    ))}
                  </div>
                </article>
              )}
            </div>
          )}

          {/* Master AI Overlay */}
          {(isLoading || isPublishing) && (
            <div className="fixed inset-0 bg-white/95 backdrop-blur-2xl z-[100] flex flex-col items-center justify-center animate-fadeIn">
              <div className="relative mb-14">
                <div className="w-32 h-32 border-[10px] border-slate-100 rounded-full"></div>
                <div className="w-32 h-32 border-[10px] border-[#A4D62C] border-t-transparent rounded-full animate-spin absolute inset-0"></div>
                <div className="absolute inset-0 flex items-center justify-center text-[#A4D62C]">
                  <i className={`fas ${isPublishing ? 'fa-cloud-upload-alt' : 'fa-brain'} text-4xl animate-pulse`}></i>
                </div>
              </div>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tight text-center">
                {isPublishing ? "Conectando con WordPress" : "IA Procesando Contenido"}
              </h2>
              <p className="text-[#A4D62C] font-black uppercase tracking-[0.4em] text-[10px] animate-pulse">{loadingStatus}</p>
            </div>
          )}

        </div>
      </main>

      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(50px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-slideUp { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .content-style strong { font-weight: 900; color: #0f172a; background: rgba(164,214,44,0.08); padding: 0 4px; border-radius: 4px; }
      `}</style>
    </div>
  );
};

export default App;