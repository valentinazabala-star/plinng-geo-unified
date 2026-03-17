// src/prompts/onBlogPrompt.ts
// Prompt builders for on_blog (SEO blog article) content type.

import type { ContentStage, LocationContext } from '../types';

export interface OnBlogImagePromptParams {
  articleTitle: string;
  visualSubject: string;
  sectionTitles: string;
  allSectionsText: string;
}

export interface OnBlogOutlinePromptParams {
  masterPrompt: string;
  langNameNative: string;
  topic: string;
  keywords: string[];
  businessName?: string;
  stage: ContentStage;
  location?: LocationContext;
}

export interface OnBlogSectionPromptParams {
  masterPrompt: string;
  langNameNative: string;
  sectionTitle: string;
  sectionKeywords: string;
  topic: string;
  businessName?: string; // already normalized
  internalLinks?: { anchor: string; url: string }[];
  websiteUrl?: string;
  location?: LocationContext;
  stage: ContentStage;
}

export function buildOnBlogOutlinePrompt(params: OnBlogOutlinePromptParams): string {
  const { masterPrompt, langNameNative, topic, keywords, businessName, stage, location } = params;

  const bizBlock = businessName
    ? `NOMBRE DEL NEGOCIO: "${businessName}"
REGLA CRÍTICA: El nombre del negocio es "${businessName}". No inventes, ni cambies ni repitas este nombre. Solo menciónalo en el texto si aporta valor real al tema; evita introducirlo sin sentido.`
    : `NOMBRE DEL NEGOCIO: no especificado
REGLA CRÍTICA: No hay nombre de negocio. Si no se te proporciona uno, NO inventes ningún nombre. No menciones empresas ficticias ni reales.`;

  return `${masterPrompt}

Eres un experto SEO de nivel senior. Genera la estructura de un artículo de blog en ${langNameNative}.

IDIOMA: Escribe TODO el contenido (title, introduction, metaTitle, metaDescription, secciones) en ${langNameNative}. Respeta la gramática y puntuación de ese idioma.
${bizBlock}

KEYWORD PRINCIPAL: ${topic}
KEYWORDS SECUNDARIAS: ${keywords.join(", ")}

INSTRUCCIONES DE ESTRUCTURA Y TONO:
- Responde ÚNICAMENTE con el JSON.
- "metaTitle": 50-60 caracteres, keyword al principio.
- "metaDescription": 120-160 caracteres, con gancho y sin frases hechas.
- "title": El H1 de la página. DEBE adaptarse a la etapa del funnel (STAGE).
- "introduction": 35-50 palabras. DEBE arrancar con un problema concreto que el lector ya está viviendo.
  - CORRECTO: describe una situación real, un síntoma, una duda frecuente o un dato del sector.
- "sections": EXACTAMENTE 4 secciones. Cada una cubre un ángulo DISTINTO e INCOMPATIBLE con los demás:
    1. QUÉ es el problema/servicio (Definición y contexto)
    2. POR QUÉ ocurre o por qué importa (Causas o beneficios profundos)
    3. CÓMO se detecta o aborda (Proceso o señales concretas)
    4. QUÉ HACER (Pasos accionables o solución)

ESTRATEGIA DE ETAPA (STAGED CONTENT):
${stage === 'tofu' ? '- TOFU (Informacional): Enfoque educativo profundo. El lector busca entender. Tono explicativo, evita vender directamente.' : ''}
${stage === 'mofu' ? '- MOFU (Comparativo): Enfoque decisional. Ayuda al lector a comparar opciones o entender criterios de elección.' : ''}
${stage === 'bofu' ? '- BOFU (Transaccional/Local): Enfoque de acción. El lector está listo para actuar. Menciona la facilidad de contacto y la ubicación.' : ''}

${location ? `CONTEXTO LOCAL: El negocio está en ${location.city}${location.neighborhood ? `, barrio ${location.neighborhood}` : ''}.
- Incluye la ciudad UNA SOLA VEZ: en el H1 o en la metadescription, donde sea más natural.
- Los H2 NO deben incluir la ciudad. Son preguntas temáticas, no keywords locales.
- La ciudad NO es un recurso de relleno. Si no encaja orgánicamente, no la incluyas.` : ''}

REGLAS ESTRICTAS DE FORMATO:
    - SÍ DEBEN empezar literalmente con el carácter ¿ y terminar con ?. Esto es un requisito absoluto del formato JSON.
    - SIN DOBLE CONCEPTO: Si un título une dos ideas distintas con "y", elige solo la más relevante para esa sección.
4. REGLAS DE PUNTUACIÓN EN TÍTULOS (H1 y H2) — SIN EXCEPCIONES:
   - NUNCA coloques punto al final de un título.
   - Esto aplica aunque el título contenga dos partes separadas por ":"
   - INCORRECTO: "Claves para elegir un especialista: criterios fundamentales."
   - CORRECTO:   "Claves para elegir un especialista: criterios fundamentales"
   - Un título no es una oración. No lleva punto final bajo ningún concepto.
5. REGLAS PARA EL H1 ("title"):
   - PROHIBIDO: Fórmulas vacías ("Guía definitiva", "Todo sobre", "El arte de", "Todo lo que necesitas saber").
   - PROHIBIDO: Títulos donde no aparezca claramente la keyword principal.
   - ADAPTACIÓN AL STAGE:
     · TOFU  → OBLIGATORIO: DEBE ser una pregunta directa (¿Qué es...? ¿Por qué...? ¿Cómo...?).
     · MOFU  → pregunta o comparativa (¿Cuál elegir? X vs Y)
     · BOFU  → afirmación descriptiva o acción directa (Ej: "Primera consulta de [servicio] en [ciudad]"). NO uses preguntas en BOFU.
5. REGLAS PARA LOS H2 (sections):
   - SÍ DEBEN empezar literalmente con el carácter ¿ y terminar con ?. Esto es un requisito absoluto del formato JSON.
   - SIN DOBLE CONCEPTO: Si un título une dos ideas distintas con "y", elige solo la más relevante para esa sección.
     - INCORRECTO: "¿Cuáles son las señales de alerta y qué preguntar antes de decidir?"
     - CORRECTO: "¿Cómo saber si necesitas ayuda profesional en tu situación?"
   - PROHIBIDA LA CIUDAD EN H2: Ningún título H2 debe incluir nombres de ciudades ni ubicaciones locales.
7. REGLAS DE FLUIDEZ GRAMATICAL (POSITIVE AFFIRMATION):
   - SUSTANTIVACIÓN OBLIGATORIA: En lugar de usar acciones en desarrollo (Ej: "Eligiendo", "Entendiendo", "Mejorando"), DEBES usar el sustantivo equivalente ("La elección de", "Cómo entender", "La mejora de"). Los H1 y H2 deben sonar como titulares de prensa profesionales, no como tutoriales activos.
   - INTEGRACIÓN ORGÁNICA DE KEYWORDS: Las keywords sin preposición (Ej: "tratamiento inflamación crónica") son solo raíces de búsqueda. DEBES inyectar conectores gramaticales (de, para, con, en, la, el) para que la lectura sea 100% nativa.
8. REGLA CRÍTICA DE ESTRUCTURA Y ORACIONES (ESPECIAL PARA LA INTRODUCCIÓN):
   - Cada oración DEBE ser completa: sujeto + verbo + punto.
   - Si pones un punto, la siguiente oración DEBE empezar obligatoriamente en mayúscula.
   - NUNCA cortes una idea en dos con un punto si la segunda parte no puede sostenerse sola.

{
  "metaTitle": "[sentence case, 50-60 chars]",
  "metaDescription": "[120-160 chars]",
  "title": "[H1 adaptado al stage en sentence case]",
  "introduction": "[35-50 palabras arrancando desde un problema real del lector]",
  "sections": [
    { "title": "¿[H2 integrando orgánicamente la keyword con preposiciones y sustantivos - Ángulo 'Qué']?", "keywords": ["${keywords[0] || topic}"] },
    { "title": "¿[H2 integrando orgánicamente la keyword con preposiciones y sustantivos - Ángulo 'Por qué']?", "keywords": ["${keywords[1] || topic}"] },
    { "title": "¿[H2 integrando orgánicamente la keyword con preposiciones y sustantivos - Ángulo 'Cómo']?", "keywords": ["${keywords[2] || topic}"] },
    { "title": "¿[H2 integrando orgánicamente la keyword con preposiciones y sustantivos - Ángulo 'Qué hacer']?", "keywords": ["${keywords[3] || topic}"] }
  ]
}`;
}

export function buildOnBlogSectionPrompt(params: OnBlogSectionPromptParams): string {
  const {
    masterPrompt,
    langNameNative,
    sectionTitle,
    sectionKeywords,
    topic,
    businessName,
    internalLinks,
    websiteUrl,
    location,
    stage,
  } = params;

  const businessLine = businessName
    ? `\nNOMBRE DEL NEGOCIO: "${businessName}"
- Escríbelo con capitalización normal (Sentence case). NUNCA en MAYÚSCULAS.
- Menciona el nombre MÁXIMO UNA VEZ en toda esta sección, solo si aporta valor informativo real.
- NUNCA lo uses como cierre de sección ni como llamada a la acción repetitiva.
- Si no suma al párrafo, no lo menciones.\n`
    : `\nNOMBRE DEL NEGOCIO: no especificado\n- Si no hay nombre, NO inventes uno ni menciones empresas ficticias. Mantén el texto libre de nombres comerciales.\n`;

  let linksBlock = '';
  if (internalLinks?.length) {
    linksBlock = `
ESTRATEGIA DE ENLACES INTERNOS (MARCADORES SEMÁNTICOS):
Tienes disponible el siguiente anchor text: "${internalLinks[0].anchor}".
REGLA: NO escribas etiquetas HTML <a> directas. En su lugar, si la narrativa de esta sección encaja con el anchor, inserta EXACTAMENTE UN marcador en la frase más natural:
[LINK_OPORTUNIDAD: ${internalLinks[0].anchor}]
- INTEGRACIÓN ORGÁNICA: El marcador debe ser parte natural de la oración. No uses frases prefabricadas como "Para más información, visita [LINK]".
- Si el contexto de esta sección no llama orgánicamente a la acción, NO insertes el marcador.
- LIMITACIÓN: Máximo un marcador por sección.`;
  } else if (websiteUrl) {
    linksBlock = `
ESTRATEGIA DE ENLACES INTERNOS (MARCADORES SEMÁNTICOS):
REGLA: NO escribas etiquetas HTML <a> directas. Si el párrafo invita de forma ultra natural a profundizar en la solución profesional, inserta EXACTAMENTE UN marcador con esta estructura:
[LINK_OPORTUNIDAD: tu_anchor_text_descriptivo_aqui]
- INTEGRACIÓN ORGÁNICA: El anchor DEBE describir el servicio o beneficio y fluir con el texto. Ej: "Una [LINK_OPORTUNIDAD: adecuada limpieza facial] previene el envejecimiento."
- PROHIBIDO usar como anchor: "servicios", "blog", "aquí", "contacto", "ver más", "clic aquí".
- LIMITACIÓN: Máximo un marcador por sección. Si el contexto de la sección es puramente educativo (TOFU) y no invita a la acción de forma genuina, NO insertes el marcador.`;
  }

  return `${masterPrompt}
${businessLine}
${linksBlock}
IDIOMA: Escribe esta sección en ${langNameNative}. Usa gramática y puntuación correctas para ese idioma.

ARTICLE CONTEXT:
${topic}

H2 SECTION TO WRITE:
${sectionTitle}

SECTION KEYWORDS:
${sectionKeywords}

REGLA CRÍTICA DE ESTRUCTURA Y ORACIONES:
- Cada oración DEBE ser completa: sujeto + verbo + punto.
- Si pones un punto, la siguiente oración DEBE empezar obligatoriamente en mayúscula.
- NUNCA cortes una idea en dos con un punto si la segunda parte no puede sostenerse sola.
  (Incorrecto: "...interconectado. cada parte influye..." -> Correcto: "...interconectado. Cada parte influye...")

GRAMMAR CHECK — VERIFY BEFORE EVERY SENTENCE:
✓ Accents: también, más, así, además, está, será, información, gestión, atención, etc.
✓ Capitalization: only first letter of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
✓ Opening punctuation: ¿ before questions, ¡ before exclamations.
✓ Every sentence ends with a period.
✓ Bullet format: <li><strong>Term:</strong> explanation.</li>

TASK:
- En cada sección incluye AL MENOS UN ejemplo concreto: una situación real, un caso típico o un escenario cotidiano relacionado con ${topic}.
  - CORRECTO: describe algo que el lector pueda reconocer en su propia experiencia con el tema.
  - INCORRECTO: explicaciones abstractas sin referencia a situaciones reales.
${location ? `- CONTEXTO LOCAL: El negocio está en ${location.city}${location.neighborhood ? `, barrio ${location.neighborhood}` : ''}.
${stage === 'bofu' ? '  - Al ser contenido BOFU, puedes mencionar la ciudad UNA VEZ de forma natural si el H2 lo permite.' : '  - NO repitas la ciudad en el cuerpo de la sección. Ya aparece en el H1 y meta. Más menciones no mejoran el SEO local y dañan la lectura.'}` : ''}
- Escribe el contenido completo de esta sección H2.

LENGTH REQUIREMENT — MANDATORY:
- Cada sección debe tener:
    1. Un párrafo de apertura (3-4 oraciones completas).
    2. Un listado de 4-5 items con explicaciones de 2 oraciones cada uno.
    3. Un párrafo de cierre (2 oraciones completas).
- Esto garantiza densidad de información real. No rellenes con palabras vacías.
- El total de la sección debe rondar las 200 palabras. Si queda corto, explica el "por qué" de cada concepto.

SECTION STRUCTURE — EXACT, NO EXCEPTIONS:

1. OPENING PARAGRAPH
   - 2-3 complete sentences that directly answer the H2
   - Complete sentence = subject + verb + period
   - NEVER cut a sentence in the middle

2. BULLET LIST (mandatory in every section)
   - Always use <ul> and <li>
   - Minimum 3 items, maximum 6
   - EXACT FORMAT FOR EACH ITEM:
     <li><strong>Key concept:</strong> Explanation in 1-2 complete sentences.</li>
   - The word or phrase before the colon ALWAYS goes inside <strong>
   - The colon goes INSIDE <strong>, right before </strong>
   - CORRECT: <li><strong>Required documents:</strong> You must provide a valid ID and passport.</li>
   - WRONG: <li>Required documents: You must provide a valid ID.</li>
   - WRONG: <li><strong>Required documents</strong>: You must provide a valid ID.</li>

3. CLOSING PARAGRAPH
   - 1-2 sentences that conclude the section
   - Complete sentence with a period

${stage === 'bofu' ? `
FEW-SHOT REFERENCE — SECCIÓN DE ALTA CALIDAD (BOFU, sección 1):
H2: Qué ocurre durante el primer proceso de [SERVICIO_CENTRAL]

<p>Iniciar un proceso de [SERVICIO_CENTRAL] no es un trámite superficial. Es una evaluación estructurada en la que el experto analiza tu situación, identifica patrones y determina las acciones necesarias. Entender este punto de partida te ayuda a tomar el control desde el primer momento.</p>

<ul>
<li><strong>Análisis detallado de la situación:</strong> El especialista preguntará sobre el origen del problema y factores que lo agravan. Cuanto más precisa sea esta radiografía inicial, más rápido se diseñará el plan de acción.</li>
<li><strong>Evaluación técnica:</strong> Se realizará una revisión de los parámetros críticos del caso para detectar anomalías o bloqueos funcionales. Esta exploración aporta información que ningún cuestionario estándar puede reemplazar.</li>
<li><strong>Plan de ruta claro:</strong> Antes de terminar, debes tener claro qué pasos seguirán y cuál es la estrategia propuesta. Puedes [LINK_OPORTUNIDAD: conocer cómo funciona nuestro método de trabajo] para llegar con las ideas claras.</li>
</ul>

<p>Un primer acercamiento profesional puede evitar meses de ensayos sin rumbo y estrategias que no resuelven el problema de base.</p>
` : stage === 'mofu' ? `
FEW-SHOT REFERENCE — SECCIÓN DE ALTA CALIDAD (MOFU, sección 1):
H2: Qué criterios usar para elegir un especialista en [TEMA_PRINCIPAL]

<p>Elegir a un experto en [TEMA_PRINCIPAL] no se reduce a buscar la opción más económica. La experiencia técnica, la forma de comunicación y la metodología de trabajo marcan diferencias reales en el resultado final. Estos son los factores que vale la pena evaluar antes de tomar la decisión.</p>

<ul>
<li><strong>Especialización verificable:</strong> El campo es amplio. Hay profesionales centrados en [Área_A] y otros que dominan [Área_B]. Revisar la orientación específica del experto antes de contratarlo ahorra tiempo y evita frustraciones.</li>
<li><strong>Experiencia con casos similares:</strong> Un especialista que ha resuelto cientos de casos complejos llega con un mapa mental que un generalista no tiene. Preguntar directamente sobre su historial de éxito con tu problema específico es completamente válido.</li>
<li><strong>Disponibilidad de seguimiento:</strong> Los problemas de fondo no se resuelven en una sola interacción. Un plan de trabajo sin fechas de revisión suele traducirse en abandono prematuro. Conocer el [LINK_OPORTUNIDAD: enfoque de soporte y seguimiento] te ayuda a saber qué esperar a largo plazo.</li>
</ul>

<p>Evaluar estos puntos antes de comprometerte no es una exigencia excesiva. Es la diferencia entre encontrar una solución estable y acumular parches temporales.</p>
` : `
FEW-SHOT REFERENCE — SECCIÓN DE ALTA CALIDAD (TOFU, sección 2):
H2: Por qué un problema con [TEMA_PRINCIPAL] afecta a todo el sistema

<p>Existe una tendencia a pensar en [TEMA_PRINCIPAL] como un elemento aislado que funciona de forma independiente. La evidencia demuestra lo contrario: este factor está intrínsecamente conectado con el rendimiento general, la estabilidad y la eficiencia del conjunto. Cuando esta pieza central falla, el impacto en cadena es inevitable.</p>

<ul>
<li><strong>Pérdida de eficiencia sistémica:</strong> Un componente que trabaja al límite no puede gestionar la demanda operativa con normalidad. Un sistema aparentemente robusto puede presentar caídas de rendimiento sin que los factores externos lo justifiquen.</li>
<li><strong>Vulnerabilidad frente a tensiones:</strong> Aproximadamente el 70% de las incidencias críticas se originan en debilidades de la estructura base. Una configuración desequilibrada puede traducirse en errores recurrentes o respuestas desproporcionadas ante imprevistos.</li>
<li><strong>Efecto en el clima y la dinámica operativa:</strong> Este subsistema procesa alrededor del 90% de las variables clave del entorno. Entornos de alta exigencia reportan con frecuencia cuellos de botella que mejoran de forma paralela cuando se estabiliza la estructura primaria.</li>
</ul>

<p>Prestar atención a los fundamentos no es solo resolver anomalías puntuales. Es mantener la base sobre la que se sostienen el crecimiento, la adaptabilidad y el éxito sostenido.</p>
`}

READABILITY — MANDATORY (Flesch-Kincaid > 60):

SENTENCE LENGTH:
- Maximum 15-20 words per sentence
- One sentence = one idea
- Use periods, NOT commas, to separate ideas

PARAGRAPH STRUCTURE:
- Maximum 3-4 sentences per paragraph
- NEVER write a <p> with more than 4 sentences
- One paragraph = one concept

VOCABULARY — USE SIMPLE WORDS:
- USE: "usar" (NOT "utilizar")
- USE: "hacer" (NOT "realizar" or "efectuar")
- USE: "mejorar" (NOT "optimizar")
- USE: "aumentar" (NOT "incrementar")
- USE: "bajar" (NOT "disminuir")
- USE: "además" (NOT "adicionalmente")
- USE: "después" (NOT "posteriormente")
- USE: "cerca de" (NOT "aproximadamente")

SENTENCE STRUCTURE:
- Use active voice: "El médico realiza el procedimiento"
- AVOID passive voice: "El procedimiento es realizado por el médico"
- Structure: Subject + Verb + Object

CONNECTORS — KEEP IT SIMPLE:
- USE: "y", "pero", "porque", "entonces", "por eso"
- AVOID: "mediante", "a través de", "con el fin de", "debido a que"
- Replace complex connectors with a period and a new sentence

HTML FORMATTING:
- Clean HTML only
- Allowed tags: <p>, <strong>, <ul>, <li>, <a>
- Use <strong> sparingly (2-3 key terms per paragraph max)
- No markdown, no emojis, no invented data

TARGET:
- Reading level: 8th grade
- Flesch-Kincaid: 60 or above (mandatory)
- Tone: Conversational but professional
`;
}

export function buildOnBlogImagePrompt(params: OnBlogImagePromptParams): string {
  const { articleTitle, visualSubject, sectionTitles, allSectionsText } = params;

  return `Generate a single high-quality photograph for a professional blog article.

ARTICLE TITLE: ${articleTitle}
MAIN TOPIC: ${visualSubject}
ARTICLE SUBTOPICS: ${sectionTitles}
ARTICLE BODY SUMMARY: ${allSectionsText}

CRITICAL INSTRUCTION:
The image MUST visually represent the article's specific topic: "${articleTitle}".
Study the article body summary above carefully and create an image that a reader would immediately associate with this exact content.
Do NOT generate a generic or unrelated scene. The topic is the absolute priority.

REQUIRED VISUAL SCENE:
- Show a realistic, in-focus, professionally lit scene that directly and literally depicts the main topic.
- The scene must be instantly recognizable as being about "${visualSubject}".
- Use real environments, real objects, real people, or real activities that match the article content.
- Nothing abstract, symbolic, or decorative.

TECHNICAL REQUIREMENTS:
- Crystal clear sharpness — no blur, no bokeh, no soft focus
- Bright, even, natural daylight or professional studio lighting
- High contrast and vivid, accurate colors
- Wide establishing shot or clean medium shot showing full context
- 16:9 horizontal format

STRICT PROHIBITIONS:
- No text, letters, numbers, watermarks, or logos
- No blurry or out-of-focus elements
- No dark or moody lighting
- No generic stock clichés: no handshakes, no pointing at screens, no generic offices
- No abstract art, no patterns, no decorative backgrounds`;
}
