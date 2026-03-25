// src/geminiService.ts
// Gemini AI Service — Unified Multilingual SEO content generation engine
// Combina: LanguageProfile system (geo2-main) + Cluster/Stage/Location logic (geoff-main)

import { GoogleGenAI } from "@google/genai";
import type { Article, Section, ContentType, ContentStage, LocationContext, ContentContext } from "./types";
import { buildGmbTextPrompt, parseGmbPost } from "./prompts/gmbTextPrompt";
import type { GmbPost, GmbTextPromptParams } from "./prompts/gmbTextPrompt";
import { buildGmbImagePrompt } from "./prompts/gmbImagePrompt";
import type { GmbImagePromptParams } from "./prompts/gmbImagePrompt";
import { buildOnBlogOutlinePrompt, buildOnBlogSectionPrompt } from "./prompts/onBlogPrompt";
import { buildOffPageOutlinePrompt, buildOffPageSectionPrompt } from "./prompts/offPagePrompt";

export type { GmbPost };

/* ======================================================
   TIPOS Y CONSTANTES
====================================================== */

interface GenerateTextParams {
  model: string;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
}

interface SEOAnalysis {
  score: number;
  suggestions: string[];
}

interface KeywordsResponse {
  keywords: string[];
}

export type { ContentStage, LocationContext };

export interface PickBestWordPressCategoryParams {
  repository: string;
  companyCategory?: string;
  companySubcategory?: string;
  articleTitle: string;
  primaryKeyword: string;
  allowedCategories: string[];
}

const MODELS = {
  PRO: "gemini-2.5-flash",
  FLASH: "gemini-2.5-flash",
  IMAGE: "gemini-3-pro-image-preview",
} as const;

const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY: 1000,
  BACKOFF_MULTIPLIER: 2,
} as const;

/* ======================================================
   SISTEMA DE PERFILES DE IDIOMA (de geo2-main)
   8 idiomas: es, en, pt, fr, it, de, nl, ca
====================================================== */

export interface LanguageProfile {
  nameEn: string;
  nameNative: string;
  outputInstruction: string;
  grammarRules: string;
  punctuationRules: string;
  capitalizationRules: string;
  vocabularyPreferences: string;
  bulletExample: string;
  toneInstruction: string;
  connectors: string;
  danglingWordsPattern: string;
  internalLinkAnchors: [string, string, string];
  anchorSearchMapServices: string[];
  anchorSearchMapBlog: string[];
  anchorSearchMapContact: string[];
  sectionFallbackPrefixes: Array<{ prefix: string; suffix: string }>;
  titleVariationTemplates: string[];
  introFallbackTemplate: string;
}

const LANGUAGE_PROFILES: Record<string, LanguageProfile> = {

  es: {
    nameEn: "Spanish",
    nameNative: "Español",
    outputInstruction: "OUTPUT LANGUAGE: Spanish. Write ALL content in Spanish only. Never mix languages.",
    grammarRules: `SPANISH GRAMMAR — MANDATORY:
1. ACCENTS: también, más, así, además, está, será, qué, cómo, cuándo, dónde, él, tú, sí, administración, gestión, información, solución, atención, situación, documentación.
2. CAPITALIZATION: Only first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
   WRONG: "Los Tratamientos Faciales son Muy Efectivos" | CORRECT: "Los tratamientos faciales son muy efectivos"
3. OPENING PUNCTUATION: Always ¿ before questions and ¡ before exclamations.
4. FULL STOP: Every declarative sentence ends with a period.
5. AGREEMENT: Gender and number must match between article, noun and adjective.
6. VERB TENSE: Choose one tense and maintain it throughout.`,
    punctuationRules: "Use ¿...? for questions. Use ¡...! for exclamations. Period ends every declarative sentence. No semicolons.",
    capitalizationRules: "Only first word of sentence and proper nouns. NEVER mid-sentence common nouns.",
    vocabularyPreferences: `SIMPLER WORDS: usar (NOT utilizar) | hacer (NOT realizar) | mejorar (NOT optimizar) | aumentar (NOT incrementar) | además (NOT adicionalmente) | después (NOT posteriormente) | por eso (NOT por lo tanto) | para (NOT con el fin de) | porque (NOT debido a que).
AVOID: "mediante", "a través de", "con el fin de", "no obstante", "en consecuencia", "cabe destacar".`,
    bulletExample: `<li><strong>Mantenimiento preventivo:</strong> Consiste en revisar el equipo cada cierto tiempo. Así se evitan fallos graves y costes altos.</li>`,
    toneInstruction: "Professional, warm, conversational. Write like a knowledgeable expert explaining to a friend, not like a corporate brochure.",
    connectors: `Use "y", "pero", "porque", "entonces", "por eso", "así", "sin embargo", "además", "también".`,
    danglingWordsPattern: "\\s+(y|e|o|u|ni|pero|sino|aunque|que|de|del|con|en|a|al|por|para|sin|sobre|ante|bajo|como|si|más|su|sus|un|una|unos|unas|las|los|la|le|lo|se|es|ha|han|era|fue|ser|está|están|muy|bien|mal|ya|no|también|cuando|donde|quien|cual|cuya|cuyo|tanto|tan|así|aun|aún|incluso|además|pues|luego|entonces)$",
    internalLinkAnchors: ["servicios", "blog", "contacto"],
    anchorSearchMapServices: ["servicios", "servicio", "soluciones", "solución", "oferta", "productos", "opciones"],
    anchorSearchMapBlog: ["información", "artículo", "guía", "recursos", "contenido", "conocer", "saber"],
    anchorSearchMapContact: ["consulta", "asesor", "asesoría", "contactar", "solicitar", "experto", "especialista", "profesional"],
    sectionFallbackPrefixes: [
      { prefix: "¿Qué es", suffix: "?" },
      { prefix: "Beneficios de", suffix: "" },
      { prefix: "Cómo funciona", suffix: "" },
      { prefix: "Tipos de", suffix: "" },
    ],
    titleVariationTemplates: [
      "Guía completa sobre {topic}",
      "{topic}: Todo lo que necesitas saber",
      "Descubre {topic}: Guía práctica",
      "{topic} explicado: Información esencial",
      "Conoce todo sobre {topic}",
    ],
    introFallbackTemplate: "{name} ofrece claves y consejos directos para resolver esa duda, con ideas prácticas y orientadas a la acción.",
  },

  en: {
    nameEn: "English",
    nameNative: "English",
    outputInstruction: "OUTPUT LANGUAGE: English. Write ALL content in English only. Never mix languages.",
    grammarRules: `ENGLISH GRAMMAR — MANDATORY:
1. CAPITALIZATION: Sentence case only — first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence in body text.
   WRONG: "The Facial Treatments Are Very Effective" | CORRECT: "The facial treatments are very effective"
2. FULL STOP: Every declarative sentence ends with a period.
3. ARTICLES: Use "a" before consonant sounds, "an" before vowel sounds.
4. SUBJECT-VERB AGREEMENT: Singular subjects take singular verbs.
5. VERB TENSE: Choose one tense and maintain it throughout.`,
    punctuationRules: "Use ? for questions. Use ! sparingly. Period ends every declarative sentence. Oxford comma for lists of 3+ items.",
    capitalizationRules: "Sentence case: only first word and proper nouns capitalized. Not title case in body text.",
    vocabularyPreferences: `SIMPLER WORDS: use (NOT utilize) | make/do (NOT perform/execute) | improve (NOT optimize) | increase (NOT increment) | also (NOT additionally) | after (NOT subsequently) | so (NOT consequently) | to (NOT in order to) | because (NOT due to the fact that).
AVOID: "leverage", "utilize", "synergize", "proactive", "seamless", "robust", "streamline", "cutting-edge".`,
    bulletExample: `<li><strong>Preventive maintenance:</strong> This involves checking the equipment regularly. It helps avoid costly breakdowns and keeps performance high.</li>`,
    toneInstruction: "Professional, clear, and direct. Write like a trusted expert speaking to a smart reader, not like a sales brochure.",
    connectors: `Use "and", "but", "because", "so", "however", "also", "therefore", "in addition", "for example".`,
    danglingWordsPattern: "\\s+(and|or|but|nor|for|yet|so|the|a|an|of|in|on|at|to|by|up|as|is|was|be|it|its|if|do|not|also|even|just|then|when|where|who|that|this|these|those|with|from|into|than|such|both|each|more|most|some|any|all|no)$",
    internalLinkAnchors: ["services", "blog", "contact"],
    anchorSearchMapServices: ["services", "service", "solutions", "solution", "offer", "products", "options"],
    anchorSearchMapBlog: ["information", "article", "guide", "resources", "content", "learn", "know"],
    anchorSearchMapContact: ["consult", "advisor", "advice", "contact", "request", "expert", "specialist", "professional"],
    sectionFallbackPrefixes: [
      { prefix: "What is", suffix: "?" },
      { prefix: "Benefits of", suffix: "" },
      { prefix: "How does", suffix: " work?" },
      { prefix: "Types of", suffix: "" },
    ],
    titleVariationTemplates: [
      "Complete guide to {topic}",
      "{topic}: Everything you need to know",
      "Discover {topic}: A practical guide",
      "{topic} explained: Essential information",
      "Everything about {topic}",
    ],
    introFallbackTemplate: "{name} provides clear answers and practical tips to help you make the right decision every step of the way.",
  },

  pt: {
    nameEn: "Portuguese",
    nameNative: "Português",
    outputInstruction: "OUTPUT LANGUAGE: Portuguese (Brazilian Portuguese by default). Write ALL content in Portuguese only. Never mix languages.",
    grammarRules: `PORTUGUESE GRAMMAR — MANDATORY:
1. ACCENTS: também, mais, assim, além, está, será, que, como, quando, onde, ele, você, sim, administração, gestão, informação, solução, atenção, situação.
2. CAPITALIZATION: Only first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
   WRONG: "Os Tratamentos Faciais São Muito Eficazes" | CORRECT: "Os tratamentos faciais são muito eficazes"
3. FULL STOP: Every declarative sentence ends with a period.
4. AGREEMENT: Gender and number must match between article, noun and adjective.
5. CRASE: Use "à" correctly before feminine nouns requiring definite article.`,
    punctuationRules: "Use ? for questions. Use ! for exclamations. Period ends every declarative sentence.",
    capitalizationRules: "Only first word of sentence and proper nouns. NEVER mid-sentence common nouns.",
    vocabularyPreferences: `SIMPLER WORDS: usar (NOT utilizar) | fazer (NOT realizar) | melhorar (NOT otimizar) | aumentar (NOT incrementar) | além disso (NOT adicionalmente) | depois (NOT posteriormente) | por isso (NOT portanto) | para (NOT com o objetivo de) | porque (NOT em virtude de).
AVOID: "mediante", "através de", "com o intuito de", "não obstante", "em consequência".`,
    bulletExample: `<li><strong>Manutenção preventiva:</strong> Consiste em verificar o equipamento regularmente. Isso evita falhas graves e custos altos.</li>`,
    toneInstruction: "Professional, warm, conversational. Write like a knowledgeable expert explaining to a friend.",
    connectors: `Use "e", "mas", "porque", "então", "por isso", "assim", "no entanto", "além disso", "também".`,
    danglingWordsPattern: "\\s+(e|ou|mas|nem|porém|que|de|do|da|com|em|a|ao|por|para|sem|sobre|como|se|mais|seu|sua|um|uma|uns|umas|as|os|o|no|na|nos|nas|se|é|foi|ser|está|estão|muito|bem|mal|já|não|também|quando|onde|quem)$",
    internalLinkAnchors: ["serviços", "blog", "contato"],
    anchorSearchMapServices: ["serviços", "serviço", "soluções", "solução", "oferta", "produtos", "opções"],
    anchorSearchMapBlog: ["informação", "artigo", "guia", "recursos", "conteúdo", "conhecer", "saber"],
    anchorSearchMapContact: ["consulta", "assessor", "assessoria", "contatar", "solicitar", "especialista", "profissional"],
    sectionFallbackPrefixes: [
      { prefix: "O que é", suffix: "?" },
      { prefix: "Benefícios de", suffix: "" },
      { prefix: "Como funciona", suffix: "" },
      { prefix: "Tipos de", suffix: "" },
    ],
    titleVariationTemplates: [
      "Guia completo sobre {topic}",
      "{topic}: Tudo o que você precisa saber",
      "Descubra {topic}: Guia prático",
      "{topic} explicado: Informação essencial",
      "Conheça tudo sobre {topic}",
    ],
    introFallbackTemplate: "{name} oferece dicas claras e práticas para resolver essa dúvida, com ideias orientadas à ação.",
  },

  fr: {
    nameEn: "French",
    nameNative: "Français",
    outputInstruction: "OUTPUT LANGUAGE: French. Write ALL content in French only. Never mix languages.",
    grammarRules: `FRENCH GRAMMAR — MANDATORY:
1. ACCENTS: é, è, ê, ë, à, â, ù, û, ô, î, ï, ç — always required.
2. CAPITALIZATION: Only first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
3. FULL STOP: Every declarative sentence ends with a period.
4. AGREEMENT: Gender and number must match between article, noun and adjective.
5. PUNCTUATION SPACING: Space before : ; ? ! in French typography.`,
    punctuationRules: "Use French guillemets for quotes (with non-breaking spaces inside). Space before colon, semicolon, question mark and exclamation mark. Period ends every declarative sentence.",
    capitalizationRules: "Only first word of sentence and proper nouns. NEVER mid-sentence common nouns.",
    vocabularyPreferences: `SIMPLER WORDS: utiliser (NOT employer) | faire (NOT effectuer) | améliorer (NOT optimiser) | augmenter (NOT incrémenter) | de plus (NOT additionnellement) | ensuite (NOT ultérieurement) | donc (NOT par conséquent) | pour (NOT afin de).
AVOID: "paradigme", "holistique", "synergie", "proactif", "robuste", "innovant".`,
    bulletExample: `<li><strong>Maintenance préventive :</strong> Elle consiste à vérifier l'équipement régulièrement. Cela évite les pannes graves et les coûts élevés.</li>`,
    toneInstruction: "Professional, clear, direct. Write like a trusted expert speaking to an informed reader.",
    connectors: `Use "et", "mais", "parce que", "donc", "cependant", "aussi", "de plus", "par exemple".`,
    danglingWordsPattern: "\\s+(et|ou|mais|ni|car|donc|or|le|la|les|un|une|des|de|du|au|aux|en|à|par|pour|sans|sur|avec|dans|ce|se|ne|pas|plus|que|qui|dont|où|si|son|sa|ses|leur|leurs|tout|très|bien|mal|aussi|même|encore|déjà|puis|alors)$",
    internalLinkAnchors: ["services", "blog", "contact"],
    anchorSearchMapServices: ["services", "service", "solutions", "solution", "offre", "produits", "options"],
    anchorSearchMapBlog: ["information", "article", "guide", "ressources", "contenu", "découvrir", "savoir"],
    anchorSearchMapContact: ["consultation", "conseiller", "conseil", "contacter", "demander", "expert", "spécialiste", "professionnel"],
    sectionFallbackPrefixes: [
      { prefix: "Qu'est-ce que", suffix: " ?" },
      { prefix: "Avantages de", suffix: "" },
      { prefix: "Comment fonctionne", suffix: "" },
      { prefix: "Types de", suffix: "" },
    ],
    titleVariationTemplates: [
      "Guide complet sur {topic}",
      "{topic} : Tout ce que vous devez savoir",
      "Découvrez {topic} : Guide pratique",
      "{topic} expliqué : Informations essentielles",
      "Tout savoir sur {topic}",
    ],
    introFallbackTemplate: "{name} vous propose des conseils clairs et pratiques pour répondre à cette question, avec des idées orientées vers l'action.",
  },

  it: {
    nameEn: "Italian",
    nameNative: "Italiano",
    outputInstruction: "OUTPUT LANGUAGE: Italian. Write ALL content in Italian only. Never mix languages.",
    grammarRules: `ITALIAN GRAMMAR — MANDATORY:
1. ACCENTS: è, é, à, ò, ù, ì — always required where appropriate.
2. CAPITALIZATION: Only first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
3. FULL STOP: Every declarative sentence ends with a period.
4. AGREEMENT: Gender and number must match between article, noun and adjective.
5. ARTICLES: Use correct definite/indefinite articles (il, lo, la, i, gli, le, un, uno, una).`,
    punctuationRules: "Use ? for questions. Use ! sparingly. Period ends every declarative sentence.",
    capitalizationRules: "Only first word of sentence and proper nouns. NEVER mid-sentence common nouns.",
    vocabularyPreferences: `SIMPLER WORDS: usare (NOT utilizzare) | fare (NOT effettuare) | migliorare (NOT ottimizzare) | aumentare (NOT incrementare) | inoltre (NOT addizionalmente) | dopo (NOT successivamente) | perciò (NOT di conseguenza) | per (NOT al fine di).
AVOID: "paradigma", "olistico", "sinergia", "proattivo", "robusto", "innovativo".`,
    bulletExample: `<li><strong>Manutenzione preventiva:</strong> Consiste nel controllare l'attrezzatura regolarmente. Questo evita guasti gravi e costi elevati.</li>`,
    toneInstruction: "Professional, warm, conversational. Write like a knowledgeable expert explaining to a friend.",
    connectors: `Use "e", "ma", "perché", "quindi", "perciò", "così", "tuttavia", "inoltre", "anche".`,
    danglingWordsPattern: "\\s+(e|o|ma|né|però|che|di|del|con|in|a|al|per|da|su|tra|fra|come|se|più|suo|sua|suoi|sue|un|una|uno|le|lo|la|gli|i|si|è|ha|sono|hanno|era|molto|bene|male|già|non|anche|quando|dove|chi|quale|questo|quello)$",
    internalLinkAnchors: ["servizi", "blog", "contatto"],
    anchorSearchMapServices: ["servizi", "servizio", "soluzioni", "soluzione", "offerta", "prodotti", "opzioni"],
    anchorSearchMapBlog: ["informazione", "articolo", "guida", "risorse", "contenuto", "scoprire", "sapere"],
    anchorSearchMapContact: ["consulenza", "consulente", "contattare", "richiedere", "esperto", "specialista", "professionista"],
    sectionFallbackPrefixes: [
      { prefix: "Cos'è", suffix: "?" },
      { prefix: "Vantaggi di", suffix: "" },
      { prefix: "Come funziona", suffix: "" },
      { prefix: "Tipi di", suffix: "" },
    ],
    titleVariationTemplates: [
      "Guida completa su {topic}",
      "{topic}: Tutto quello che devi sapere",
      "Scopri {topic}: Guida pratica",
      "{topic} spiegato: Informazioni essenziali",
      "Tutto su {topic}",
    ],
    introFallbackTemplate: "{name} offre consigli chiari e pratici per risolvere questo dubbio, con idee orientate all'azione.",
  },

  de: {
    nameEn: "German",
    nameNative: "Deutsch",
    outputInstruction: "OUTPUT LANGUAGE: German. Write ALL content in German only. Never mix languages.",
    grammarRules: `GERMAN GRAMMAR — MANDATORY:
1. UMLAUTS: ä, ö, ü, ß — always required where appropriate.
2. CAPITALIZATION: All nouns are capitalized in German. First word of sentence always capitalized.
3. FULL STOP: Every declarative sentence ends with a period.
4. VERB POSITION: In main clauses, conjugated verb in second position. In subordinate clauses, verb at the end.
5. CASES: Correct use of Nominativ, Akkusativ, Dativ, Genitiv.`,
    punctuationRules: "Use ? for questions. Use ! sparingly. Period ends every declarative sentence. Use German-style low-high quotation marks for quotes.",
    capitalizationRules: "All nouns capitalized. First word of sentence capitalized. Adjectives NOT capitalized unless at start of sentence.",
    vocabularyPreferences: `SIMPLER WORDS: benutzen/nutzen (NOT verwenden) | machen (NOT durchführen) | verbessern (NOT optimieren) | erhöhen (NOT steigern) | außerdem (NOT darüber hinaus) | danach (NOT anschließend) | deshalb (NOT infolgedessen) | für (NOT zwecks).
AVOID: "Paradigma", "ganzheitlich", "Synergie", "proaktiv", "robust", "innovativ".`,
    bulletExample: `<li><strong>Vorbeugende Wartung:</strong> Dabei wird die Ausrüstung regelmäßig überprüft. So werden schwere Ausfälle und hohe Kosten vermieden.</li>`,
    toneInstruction: "Professional, clear, direct. Write like a trusted expert speaking to an informed reader.",
    connectors: `Use "und", "aber", "weil", "also", "deshalb", "so", "jedoch", "außerdem", "auch".`,
    danglingWordsPattern: "\\s+(und|oder|aber|denn|weil|dass|der|die|das|den|dem|des|ein|eine|einen|einem|einer|zu|in|an|auf|für|mit|von|bei|nach|aus|um|über|vor|zwischen|durch|als|wie|wenn|ob|so|auch|noch|schon|nur|sehr|gut|viel|mehr|nicht|kein|keine|sich|es|er|sie|wir|ihr)$",
    internalLinkAnchors: ["Dienstleistungen", "Blog", "Kontakt"],
    anchorSearchMapServices: ["Dienstleistungen", "Dienstleistung", "Lösungen", "Lösung", "Angebot", "Produkte", "Optionen"],
    anchorSearchMapBlog: ["Information", "Artikel", "Leitfaden", "Ressourcen", "Inhalt", "erfahren", "wissen"],
    anchorSearchMapContact: ["Beratung", "Berater", "kontaktieren", "anfragen", "Experte", "Spezialist", "Fachmann"],
    sectionFallbackPrefixes: [
      { prefix: "Was ist", suffix: "?" },
      { prefix: "Vorteile von", suffix: "" },
      { prefix: "Wie funktioniert", suffix: "" },
      { prefix: "Arten von", suffix: "" },
    ],
    titleVariationTemplates: [
      "Kompletter Leitfaden zu {topic}",
      "{topic}: Alles, was Sie wissen müssen",
      "Entdecken Sie {topic}: Praktischer Leitfaden",
      "{topic} erklärt: Wichtige Informationen",
      "Alles über {topic}",
    ],
    introFallbackTemplate: "{name} bietet klare Antworten und praktische Tipps, um diese Frage zu lösen, mit handlungsorientierten Ideen.",
  },

  nl: {
    nameEn: "Dutch",
    nameNative: "Nederlands",
    outputInstruction: "OUTPUT LANGUAGE: Dutch. Write ALL content in Dutch only. Never mix languages.",
    grammarRules: `DUTCH GRAMMAR — MANDATORY:
1. SPELLING: Follow official Dutch spelling (Groene Boekje).
2. CAPITALIZATION: Only first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
3. FULL STOP: Every declarative sentence ends with a period.
4. AGREEMENT: Gender (de/het) must be correct for each noun.
5. VERB POSITION: In main clauses, conjugated verb in second position.`,
    punctuationRules: "Use ? for questions. Use ! sparingly. Period ends every declarative sentence.",
    capitalizationRules: "Only first word of sentence and proper nouns. NEVER mid-sentence common nouns (unlike German).",
    vocabularyPreferences: `SIMPLER WORDS: gebruiken (NOT benutten) | doen/maken (NOT uitvoeren) | verbeteren (NOT optimaliseren) | verhogen (NOT incrementeren) | bovendien (NOT daarenboven) | daarna (NOT vervolgens) | daarom (NOT derhalve) | voor (NOT ten behoeve van).
AVOID: "paradigma", "holistisch", "synergie", "proactief", "robuust", "innovatief".`,
    bulletExample: `<li><strong>Preventief onderhoud:</strong> Dit houdt in dat de apparatuur regelmatig wordt gecontroleerd. Zo worden ernstige storingen en hoge kosten voorkomen.</li>`,
    toneInstruction: "Professional, clear, direct. Write like a trusted expert speaking to an informed reader.",
    connectors: `Use "en", "maar", "omdat", "dus", "daarom", "zo", "echter", "bovendien", "ook".`,
    danglingWordsPattern: "\\s+(en|of|maar|want|dus|dat|de|het|een|van|in|op|aan|met|voor|door|uit|over|bij|na|tot|om|als|wie|wat|waar|hoe|dan|ook|nog|al|niet|geen|zich|er|ze|we|je|hij|zij|hun)$",
    internalLinkAnchors: ["diensten", "blog", "contact"],
    anchorSearchMapServices: ["diensten", "dienst", "oplossingen", "oplossing", "aanbod", "producten", "opties"],
    anchorSearchMapBlog: ["informatie", "artikel", "gids", "bronnen", "inhoud", "ontdekken", "weten"],
    anchorSearchMapContact: ["consultatie", "adviseur", "advies", "contact", "aanvragen", "expert", "specialist", "professional"],
    sectionFallbackPrefixes: [
      { prefix: "Wat is", suffix: "?" },
      { prefix: "Voordelen van", suffix: "" },
      { prefix: "Hoe werkt", suffix: "" },
      { prefix: "Soorten", suffix: "" },
    ],
    titleVariationTemplates: [
      "Complete gids over {topic}",
      "{topic}: Alles wat je moet weten",
      "Ontdek {topic}: Praktische gids",
      "{topic} uitgelegd: Essentiële informatie",
      "Alles over {topic}",
    ],
    introFallbackTemplate: "{name} biedt duidelijke antwoorden en praktische tips om deze vraag op te lossen, met actiegerichte ideeën.",
  },

  ca: {
    nameEn: "Catalan",
    nameNative: "Català",
    outputInstruction: "OUTPUT LANGUAGE: Catalan. Write ALL content in Catalan only. Never mix with Spanish or other languages.",
    grammarRules: `CATALAN GRAMMAR — MANDATORY:
1. ACCENTS AND DIACRITICS: à, è, é, í, ò, ó, ú, ï, ü, ç — follow IEC standards strictly.
2. CAPITALIZATION: Only first word of sentence and proper nouns. NEVER capitalize common nouns mid-sentence.
3. OPENING PUNCTUATION: Do NOT use ¿ or ¡. Use only closing ? and !.
4. FULL STOP: Every declarative sentence ends with a period.
5. AVOID SPANISH INTERFERENCES: Use Catalan forms (fer, després, etc.) not Spanish (realizar, después).`,
    punctuationRules: "Use ? for questions. Use ! for exclamations. NO opening ¿ or ¡. Period ends every declarative sentence.",
    capitalizationRules: "Only first word of sentence and proper nouns. NEVER mid-sentence common nouns.",
    vocabularyPreferences: `SIMPLER WORDS: fer servir (NOT utilitzar) | fer (NOT realitzar) | millorar (NOT optimitzar) | augmentar (NOT incrementar) | a més (NOT addicionalment) | després (NOT posteriorment) | per això (NOT per tant) | per a (NOT amb la finalitat de).
AVOID: "paradigma", "holístic", "sinergia", "proactiu", "robust", "innovador".`,
    bulletExample: `<li><strong>Manteniment preventiu:</strong> Consisteix a revisar l'equip de manera regular. Així s'eviten avaries greus i costos elevats.</li>`,
    toneInstruction: "Professional, clear, direct. Write like a trusted expert speaking to an informed Catalan reader.",
    connectors: `Use "i", "però", "perquè", "doncs", "per això", "així", "tanmateix", "a més", "també".`,
    danglingWordsPattern: "\\s+(i|o|però|ni|sinó|que|de|del|amb|en|a|al|per|per a|sense|sobre|com|si|més|seu|seva|seus|seves|un|una|uns|unes|les|els|la|el|li|es|és|ha|han|era|va|ser|està|estan|molt|bé|mal|ja|no|també|quan|on|qui|qual)$",
    internalLinkAnchors: ["serveis", "blog", "contacte"],
    anchorSearchMapServices: ["serveis", "servei", "solucions", "solució", "oferta", "productes", "opcions"],
    anchorSearchMapBlog: ["informació", "article", "guia", "recursos", "contingut", "conèixer", "saber"],
    anchorSearchMapContact: ["consulta", "assessor", "assessoria", "contactar", "sol·licitar", "expert", "especialista", "professional"],
    sectionFallbackPrefixes: [
      { prefix: "Què és", suffix: "?" },
      { prefix: "Beneficis de", suffix: "" },
      { prefix: "Com funciona", suffix: "" },
      { prefix: "Tipus de", suffix: "" },
    ],
    titleVariationTemplates: [
      "Guia completa sobre {topic}",
      "{topic}: Tot el que necessites saber",
      "Descobreix {topic}: Guia pràctica",
      "{topic} explicat: Informació essencial",
      "Coneix tot sobre {topic}",
    ],
    introFallbackTemplate: "{name} ofereix claus i consells directes per resoldre aquest dubte, amb idees pràctiques i orientades a l'acció.",
  },
};

/* ======================================================
   FUNCIONES DE IDIOMA (exportadas para App.tsx)
====================================================== */

/**
 * Resuelve un string de idioma (libre, como "Español", "english", "català", "pt-BR")
 * al LanguageProfile correspondiente. Fallback: español.
 */
export function resolveLanguageProfile(language?: string | null): LanguageProfile {
  if (!language) return LANGUAGE_PROFILES.es;

  const raw = language
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  // Mapeo directo por código ISO
  if (LANGUAGE_PROFILES[raw]) return LANGUAGE_PROFILES[raw];

  // Mapeo por nombre completo o variantes comunes
  const mapping: Record<string, string> = {
    // Español
    espanol: "es", spanish: "es", castellano: "es", es: "es",
    // Inglés
    english: "en", ingles: "en", en: "en",
    // Portugués
    portugues: "pt", portuguese: "pt", "pt-br": "pt", brasileiro: "pt", pt: "pt",
    // Francés
    frances: "fr", francais: "fr", french: "fr", fr: "fr",
    // Italiano
    italiano: "it", italian: "it", it: "it",
    // Alemán
    aleman: "de", deutsch: "de", german: "de", de: "de",
    // Holandés
    holandes: "nl", neerlandes: "nl", dutch: "nl", nederlands: "nl", nl: "nl",
    // Catalán
    catalan: "ca", catala: "ca", ca: "ca",
  };

  for (const [key, code] of Object.entries(mapping)) {
    if (raw.includes(key)) return LANGUAGE_PROFILES[code];
  }

  return LANGUAGE_PROFILES.es; // fallback español
}

/**
 * Construye el bloque maestro de prompt (gramática + formato + tono + vocabulario)
 * a partir de un LanguageProfile.
 */
function buildMasterPrompt(lang: LanguageProfile): string {
  return `${lang.outputInstruction}

${lang.grammarRules}

${lang.punctuationRules}

${lang.capitalizationRules}

${lang.vocabularyPreferences}

${lang.toneInstruction}

CONNECTORS: ${lang.connectors}

BANNED WORDS — NEVER USE (these reveal AI-generated content):
revolucionario, óptimo, integral, paradigma, holístico, duradera,
"bienestar pleno", "salud óptima", "enfoque innovador", "solución integral",
"de manera efectiva", "en el mundo actual", "en la sociedad moderna",
"transformar tu vida", "cambiar tu vida", "potenciar", "empoderar"

HTML FORMAT — MANDATORY, NO EXCEPTIONS:
- Allowed tags only: <p>, <strong>, <ul>, <li>, <a>
- No markdown, no **, no *, no #
- List items ALWAYS use this format: <li><strong>Term:</strong> explanation.</li>
`;
}

/* ======================================================
   CLASE PRINCIPAL
====================================================== */

class GeminiService {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey?.trim()) {
      throw new Error(
        "Gemini API key is required. Set VITE_GEMINI_API_KEY in your .env file."
      );
    }

    this.ai = new GoogleGenAI({ apiKey });
    console.log("[GeminiService] ✓ Servicio inicializado correctamente");
  }

  /* ======================================================
     UTILIDADES PRIVADAS
  ====================================================== */

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: unknown): boolean {
    const msg = String(error).toLowerCase();
    return ["429", "quota", "timeout", "503", "unavailable"].some((k) =>
      msg.includes(k)
    );
  }

  private calculateDelay(attempt: number): number {
    return (
      RETRY_CONFIG.BASE_DELAY *
      Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt - 1)
    );
  }

  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = RETRY_CONFIG.MAX_ATTEMPTS
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && this.isRetryableError(err)) {
          await this.sleep(this.calculateDelay(attempt));
          continue;
        }
        break;
      }
    }
    throw lastError;
  }

  private extractJSON<T = any>(text: string): T | null {
    try {
      return JSON.parse(text);
    } catch { }

    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { }
    }
    return null;
  }

  private async generateText(params: GenerateTextParams): Promise<string> {
    const { model, prompt, temperature = 0.7, maxRetries } = params;

    return this.executeWithRetry(async () => {
      const result = await this.ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature,
          maxOutputTokens: 8192,
        },
      });

      if (!result.text) {
        throw new Error("Respuesta vacía del modelo");
      }

      return result.text;
    }, maxRetries);
  }

  /* ======================================================
     MÉTODOS PÚBLICOS
  ====================================================== */

  async generateKeywords(context: string, location?: LocationContext, language: string = 'Español'): Promise<string[]> {
    const lang = resolveLanguageProfile(language);
    const masterPrompt = buildMasterPrompt(lang);

    const geoBlock = location
      ? `UBICACIÓN: ${location.city}${location.neighborhood ? `, barrio ${location.neighborhood}` : ''}${location.province ? `, ${location.province}` : ''}
REGLA LOCAL ESTRICTA: Genera máximo 1 o 2 keywords con intención local (ej: "[servicio principal] en [ciudad]"). NUNCA añadas la ciudad al final de una frase larga (Prohibido: "especialista en dolor de espalda crónico en Madrid"). Las demás keywords deben ser genéricas (sin ciudad).`
      : 'UBICACIÓN: no especificada.';

    const prompt = `${masterPrompt}

Genera 5 keywords SEO principales para el siguiente contexto.
${geoBlock}
- Cada keyword debe ser directa e intencional.
- No generes keywords vacías ni largas cadenas inmanejables.
- Si mencionas una ubicación geográfica, usa una preposición coherente ("en", "de"), pero asegúrate de que la keyword completa no supere las 4-5 palabras.

CONTEXTO:
${context.slice(0, 2000)}

RESPONDE SOLO EN JSON:
{ "keywords": ["k1","k2","k3","k4","k5"] }`;

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.3,
    });

    const parsed = this.extractJSON<KeywordsResponse>(text);
    if (!parsed?.keywords) {
      throw new Error("No se pudieron generar keywords");
    }

    const cleaned = parsed.keywords
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0)
      .map((k: string) => {
        if (location && location.city) {
          const cityEscaped = location.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const cityPattern = new RegExp(`\\b${cityEscaped}\\b`, 'i');

          if (cityPattern.test(k)) {
            const wellFormed = new RegExp(`\\b(en|de|a|para)\\s+${cityEscaped}\\b`, 'i').test(k);

            if (!wellFormed) {
              const badPattern = new RegExp(`\\b(?:en|de|a|para)\\s+(\\w+)\\s+${cityEscaped}\\b`, 'i');
              if (badPattern.test(k)) {
                let base = k.replace(badPattern, '$1').trim();
                return `${base} en ${location.city}`;
              }
              let base = k.replace(cityPattern, '').replace(/\b(en|de|a|para)$/i, '').trim();
              return `${base} en ${location.city}`;
            }
            return k;
          }
        }

        const placeMatch = k.match(/(\b[a-záéíóúñ]+\b)\s+\b(Maspalomas|Gran Canaria|[A-Z][\w]+)\b/i);
        if (placeMatch && !/\b(en|de|a|para)\b/i.test(k)) {
          return k.replace(placeMatch[0], `${placeMatch[1]} en ${placeMatch[2]}`);
        }
        return k;
      });
    return [...new Set(cleaned)].slice(0, 5);
  }

  async generateArticleCluster(
    topic: string,
    keywords: string[],
    businessName?: string,
    language: string = 'Español',
    location?: LocationContext,
    clusterSize: 2 | 3 = 3
  ): Promise<Partial<Article>[]> {
    const lang = resolveLanguageProfile(language);
    const masterPrompt = buildMasterPrompt(lang);

    const bizBlock = businessName
      ? `NOMBRE DEL NEGOCIO: "${businessName}"`
      : `NOMBRE DEL NEGOCIO: no especificado`;

    const geoBlock = location
      ? `UBICACIÓN: ${location.city}${location.neighborhood ? `, barrio ${location.neighborhood}` : ''}.
REGLA CRÍTICA LOCAL: No fuerces el nombre de la ciudad en los títulos (H1) si quedan antinaturales o excesivamente largos. Úsalo con moderación.`
      : 'UBICACIÓN: no especificada.';

    const prompt = `${masterPrompt}

Eres un estratega SEO de élite. Genera un CLUSTER de ${clusterSize} artículos distintos para cubrir el tema "${topic}" en ${clusterSize} sitios web diferentes sin canibalizar keywords.

${bizBlock}
${geoBlock}
IDIOMA: ${lang.nameNative}

DEBES generar exactamente ${clusterSize} estructuras de artículo (TOFU, MOFU${clusterSize === 3 ? ', BOFU' : ''}) en un solo JSON.

REGLAS DE DIFERENCIACIÓN:
1. SITIO A (TOFU - Informativo): ¿Qué es? ¿Por qué importa? Puramente educativo. Evita vender.
2. SITIO B (MOFU - Decisional): ¿Cómo elegir? Comparativas, señales de alerta, criterios de decisión.
${clusterSize === 3 ? '3. SITIO C (BOFU - Transaccional/Local): ¿Cómo prepararse? Primera consulta, acción inmediata, enfoque muy local.\n' : ''}
INSTRUCCIONES DE FORMATO:
- Cada artículo debe tener: metaTitle, metaDescription, title (H1), introduction, y 4 sections (H2).
- TODO en sentence case (solo primera letra mayúscula).
- SIN números en los títulos.
- Usa las keywords: ${keywords.join(", ")} de forma distribuida.

REGLAS DE FLUIDEZ GRAMATICAL (POSITIVE AFFIRMATION):
1. SUSTANTIVACIÓN OBLIGATORIA: En lugar de usar acciones en desarrollo (Ej: "Eligiendo", "Entendiendo", "Mejorando"), DEBES usar el sustantivo equivalente ("La elección de", "Cómo entender", "La mejora de"). Los H1 y H2 deben sonar como titulares de prensa profesionales, no como tutoriales activos. No empieces ningún título con un gerundio.
2. INTEGRACIÓN ORGÁNICA DE KEYWORDS: Las keywords sin preposición (Ej: "tratamiento inflamación crónica") son solo raíces de búsqueda. DEBES inyectar conectores gramaticales (de, para, con, en, la, el) para que la lectura sea 100% nativa.

RESPONDE ÚNICAMENTE CON ESTE FORMATO JSON (ARRAY DE ${clusterSize} OBJETOS):
[
  { "stage": "tofu", "targetSiteIndex": 0, "title": "...", "metaTitle": "...", "metaDescription": "...", "introduction": "...", "sections": [{ "title": "..." }, { "title": "..." }, { "title": "..." }, { "title": "..." }] },
  { "stage": "mofu", "targetSiteIndex": 1, "title": "...", "metaTitle": "...", "metaDescription": "...", "introduction": "...", "sections": [{ "title": "..." }, { "title": "..." }, { "title": "..." }, { "title": "..." }] }${clusterSize === 3 ? ',\n  { "stage": "bofu", "targetSiteIndex": 2, "title": "...", "metaTitle": "...", "metaDescription": "...", "introduction": "...", "sections": [{ "title": "..." }, { "title": "..." }, { "title": "..." }, { "title": "..." }] }' : ''}
]`;

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.6,
    });

    const parsed = this.extractJSON<Partial<Article>[]>(text);
    if (!parsed || !Array.isArray(parsed)) {
      console.error("Cluster inválido (respuesta cruda no es array JSON):", text);
      throw new Error(`Cluster inválido — Gemini no devolvió un array JSON válido.`);
    }

    if (parsed.length < clusterSize) {
      console.error("Cluster inválido (faltan artículos):", text);
      throw new Error(`Cluster inválido — Gemini devolvió solo ${parsed.length} artículos, se esperaban ${clusterSize}.`);
    }

    if (parsed.length > clusterSize) {
      console.warn(`Gemini devolvió ${parsed.length} artículos, truncando a los ${clusterSize} solicitados.`);
    }

    return parsed.slice(0, clusterSize);
  }

  async generateArticleOutline(
    topic: string,
    keywords: string[],
    type: ContentType,
    businessName?: string,
    language: string = 'Español',
    stage: ContentStage = 'tofu',
    location?: LocationContext,
    contentContext?: ContentContext,
    previousTitles?: string[],
  ): Promise<Partial<Article>> {
    const lang = resolveLanguageProfile(language);
    const masterPrompt = buildMasterPrompt(lang);

    const outlineParams = { masterPrompt, langNameNative: lang.nameNative, topic, keywords, businessName, stage, location };
    let prompt = type === 'off_page'
      ? buildOffPageOutlinePrompt(outlineParams)
      : buildOnBlogOutlinePrompt(outlineParams);

    // ── Perspectiva y tono según tipo de contenido ───────────────────────────
    if (type === 'off_page') {
      prompt += `

PERSPECTIVA OBLIGATORIA — OFF-PAGE (artículo externo):
- Escribe SIEMPRE en TERCERA PERSONA. El artículo habla SOBRE el negocio o el sector, nunca DESDE el negocio.
- PROHIBIDO ABSOLUTAMENTE: "tú", "usted", "nosotros", "nuestros servicios", "contáctanos", "te ofrecemos".
- CORRECTO: "los especialistas en X ofrecen...", "el negocio se enfoca en...", "quienes buscan X pueden encontrar...".
- Tono: objetivo, informativo, periodístico. Como un artículo de prensa especializada.`;
    } else if (contentContext?.writing_tone || contentContext?.grammatical_subject) {
      prompt += `

TONO Y SUJETO GRAMATICAL (detectados del sitio web del cliente):
${contentContext.writing_tone ? `- Tono de comunicación: ${contentContext.writing_tone}. Mantén este tono en todo el artículo.` : ''}
${contentContext.grammatical_subject ? `- Sujeto gramatical: usa "${contentContext.grammatical_subject}" de forma consistente. No mezcles formas de tratamiento.` : ''}`;
    }

    if (previousTitles && previousTitles.length > 0) {
      prompt += `\n\nTÍTULOS YA PUBLICADOS — NO REPETIR NI PARAFRASEAR:
${previousTitles.map(t => `- "${t}"`).join('\n')}
El título y enfoque del nuevo artículo deben ser claramente distintos a los anteriores.`;
    }

    if (contentContext) {
      prompt += `\n\n--- CONTENT CONTEXT (usa esta información para personalizar el artículo) ---\n${JSON.stringify(contentContext, null, 2)}\n---`;
    }

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.4,
    });

    console.log("[generateArticleOutline] Raw Gemini response:", text.slice(0, 800));

    const parsed = this.extractJSON<Partial<Article>>(text);
    console.log("[generateArticleOutline] Parsed JSON:", JSON.stringify(parsed, null, 2));

    if (!parsed?.sections || !Array.isArray(parsed.sections)) {
      throw new Error("Outline inválido — Gemini no devolvió JSON válido: " + text.slice(0, 300));
    }

    if (parsed.title && (parsed.title.startsWith('[') || parsed.title.includes('Pregunta H1'))) {
      parsed.title = "";
    }
    if (parsed.metaTitle && (parsed.metaTitle.startsWith('[') || parsed.metaTitle.includes('keyword principal'))) {
      parsed.metaTitle = "";
    }
    if (parsed.metaDescription && (parsed.metaDescription.startsWith('[') || parsed.metaDescription.includes('promesa'))) {
      parsed.metaDescription = "";
    }

    if (parsed.sections) {
      parsed.sections = parsed.sections.map(s => ({
        ...s,
        title: s.title
          .replace(/\bde forma distribuida\b/gi, '')
          .replace(/\bde manera distribuida\b/gi, '')
          .replace(/\bdistribuida\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .replace(/\.$/, '')
          .trim()
      }));
    }

    if (businessName) {
      const replaceFake = (str: string) =>
        str.replace(/(Agencia|Empresa)\s+[A-ZÁÉÍÓÚÑ][\w\s-]+/gi, businessName);
      if (parsed.title) {
        const cleaned = replaceFake(parsed.title);
        if (cleaned !== parsed.title) {
          console.log("[generateArticleOutline] Reemplazado nombre inventado en title");
          parsed.title = cleaned;
        }
      }
      if (parsed.introduction) {
        const cleaned = replaceFake(parsed.introduction);
        if (cleaned !== parsed.introduction) {
          console.log("[generateArticleOutline] Reemplazado nombre inventado en introduction");
          parsed.introduction = cleaned;
        }
      }
    }

    if (!parsed.title || parsed.title.trim().length === 0) {
      const kw = keywords[0] || topic;
      parsed.title = `¿Por qué elegir ${businessName || kw} para ${kw}?`;
      console.log("[generateArticleOutline] Title was empty — generated fallback:", parsed.title);
    }

    if (parsed.title && topic) {
      const lowerTitle = parsed.title.toLowerCase();
      const lowerTopic = topic.toLowerCase();
      const genericTopicFlag = /agencia|inmobiliaria|real\s*estate|servicio/i.test(lowerTopic);
      if (!lowerTitle.includes(lowerTopic)) {
        if (genericTopicFlag) {
          const keywordPhrase = topic.replace(/(^\s+|\s+$)/g, "");
          const cleanName = businessName ? businessName.replace(/[\.\s]+$/g, "") : "";
          if (cleanName) {
            parsed.title = `¿Cómo elegir ${keywordPhrase} con ${cleanName}?`;
          } else {
            parsed.title = `¿Cómo elegir ${keywordPhrase}?`;
          }
          console.log("[generateArticleOutline] Título regenerado para incluir keyword genérica:", parsed.title);
        }
      }
      if (businessName && lowerTitle.includes(businessName.toLowerCase()) && !lowerTitle.includes(lowerTopic)) {
        parsed.title = `¿Cómo elegir ${topic.trim()}?`;
        console.log("[generateArticleOutline] Título reemplazado porque sólo contenía nombre de empresa:", parsed.title);
      }
    }

    if (!parsed.introduction || parsed.introduction.trim().length === 0) {
      const name = businessName || topic;
      parsed.introduction = lang.introFallbackTemplate.replace("{name}", name);
    }
    if (businessName && parsed.introduction) {
      const replaceFake = (str: string) =>
        str.replace(/(Agencia|Empresa)\s+[A-ZÁÉÍÓÚÑ][\w\s-]+/gi, businessName);
      const cleaned = replaceFake(parsed.introduction);
      if (cleaned !== parsed.introduction) {
        console.log("[generateArticleOutline] Nombre inventado reemplazado en introduction");
        parsed.introduction = cleaned;
      }
    }
    if (parsed.introduction && !/[.!?]$/.test(parsed.introduction.trim())) {
      parsed.introduction = parsed.introduction.trim() + ".";
    }

    parsed.sections = parsed.sections.map((s, i) => ({
      ...s,
      id: s.id || `section-${i + 1}`,
      content: "",
    }));

    return parsed;
  }

  async generateSectionContent(
    section: Section,
    topic: string,
    businessName?: string,
    language: string = 'Español',
    type: ContentType = 'on_blog',
    internalLinks?: { anchor: string; url: string }[],
    websiteUrl?: string,
    location?: LocationContext,
    stage: ContentStage = 'tofu',
    contentContext?: ContentContext
  ): Promise<string> {
    const lang = resolveLanguageProfile(language);
    const masterPrompt = buildMasterPrompt(lang);

    const sectionKeywords =
      Array.isArray(section.keywords)
        ? section.keywords.join(", ")
        : typeof section.keywords === "string"
          ? section.keywords
          : "";

    // Normalizar capitalización del nombre del negocio
    let normalizedBizName = businessName || "";
    if (normalizedBizName === normalizedBizName.toUpperCase() && normalizedBizName.length > 3) {
      normalizedBizName = normalizedBizName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    console.log("[GeminiService][generateSectionContent]", {
      title: section.title,
      rawKeywords: section.keywords,
      normalizedKeywords: sectionKeywords,
    });

    const sectionParams = {
      masterPrompt,
      langNameNative: lang.nameNative,
      sectionTitle: section.title,
      sectionKeywords,
      topic,
      businessName: normalizedBizName || undefined,
      internalLinks,
      websiteUrl,
      location,
      stage,
    };
    let prompt = type === 'off_page'
      ? buildOffPageSectionPrompt(sectionParams)
      : buildOnBlogSectionPrompt(sectionParams);

    // ── Perspectiva y tono según tipo de contenido ───────────────────────────
    if (type === 'off_page') {
      prompt += `

PERSPECTIVA OBLIGATORIA — OFF-PAGE:
- Escribe SIEMPRE en TERCERA PERSONA. Nunca uses "tú", "usted", "nosotros", "contáctanos".
- CORRECTO: "los especialistas en X...", "el equipo se especializa en...", "los clientes que buscan X...".
- Tono: objetivo, informativo, periodístico.`;
    } else if (contentContext?.writing_tone || contentContext?.grammatical_subject) {
      prompt += `

TONO Y SUJETO GRAMATICAL (detectados del sitio web del cliente):
${contentContext.writing_tone ? `- Tono: ${contentContext.writing_tone}.` : ''}
${contentContext.grammatical_subject ? `- Sujeto gramatical: "${contentContext.grammatical_subject}". Aplícalo sin mezclar formas.` : ''}`;
    }

    // Regla universal anti-duplicación de anchor text
    prompt += `

ANCHOR TEXT DUPLICATION — STRICTLY FORBIDDEN:
The words used as anchor text must NOT appear again immediately before or after the hyperlink in plain text. The sentence must be written once, with the link embedded inside it. Never write the anchor text twice in the same sentence.
- CORRECT: "…puedes gestionar tus redes con [una herramienta que trabaja por ti](https://…)."
- INCORRECT: "…sin necesidad de cirugía mayor [necesidad cirugía mayor](https://…)."`;

    if (contentContext) {
      prompt += `\n\n--- CONTENT CONTEXT ---\n${JSON.stringify(contentContext, null, 2)}\n---`;
    }

    const raw = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.7,
    });

    if (businessName) {
      const fix = (text: string) =>
        text.replace(/(Agencia|Empresa)\s+[A-ZÁÉÍÓÚÑ][\w\s-]+/gi, businessName);
      const cleaned = fix(raw);
      if (cleaned !== raw) {
        console.log("[generateSectionContent] Nombre inventado reemplazado en sección");
      }
      return cleaned;
    }

    return raw;
  }

  async pickBestWordPressCategory(params: PickBestWordPressCategoryParams): Promise<string | null> {
    const {
      repository,
      companyCategory,
      companySubcategory,
      articleTitle,
      primaryKeyword,
      allowedCategories,
    } = params;

    if (!Array.isArray(allowedCategories) || allowedCategories.length === 0) return null;

    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&amp;|&#038;/g, "&")
        .toLowerCase()
        .trim();

    const byNormalized = new Map(allowedCategories.map((c) => [normalize(c), c]));

    // Detectar idioma del repositorio para usar el perfil correcto
    const language = /wall-trends\.com/i.test(repository) ? "en" : "es";
    const lang = resolveLanguageProfile(language);

    const prompt = `You are an SEO classifier. Select exactly one category from the allowed list.
${lang.outputInstruction}

REPOSITORY: ${repository}
COMPANY CATEGORY: ${companyCategory || ""}
COMPANY SUBCATEGORY: ${companySubcategory || ""}
ARTICLE TITLE: ${articleTitle}
PRIMARY KEYWORD: ${primaryKeyword}

ALLOWED CATEGORIES (must choose one of these exact strings):
${allowedCategories.map((c) => `- ${c}`).join("\n")}

Respond ONLY in JSON:
{ "category": "exact category from allowed list" }
`;

    const text = await this.generateText({ model: MODELS.FLASH, prompt, temperature: 0.1 });
    const parsed = this.extractJSON<{ category?: string | null }>(text);
    const aiCategory = (parsed?.category || "").trim();

    if (aiCategory) {
      const exact = byNormalized.get(normalize(aiCategory));
      if (exact) return exact;
    }

    // Fallback: scoring por tokens
    const context = normalize(
      [companyCategory, companySubcategory, articleTitle, primaryKeyword].filter(Boolean).join(" ")
    );
    if (!context) return null;

    const scoreCategory = (category: string): number => {
      const cat = normalize(category);
      if (!cat) return 0;
      if (context.includes(cat) || cat.includes(context)) return 100;
      const tokens = cat.split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.reduce((score, token) => (context.includes(token) ? score + 1 : score), 0);
    };

    const ranked = allowedCategories
      .map((category) => ({ category, score: scoreCategory(category) }))
      .sort((a, b) => b.score - a.score);

    return ranked[0]?.score > 0 ? ranked[0].category : null;
  }

  async analyzeSEO(content: string, keywords: string[], language?: string): Promise<SEOAnalysis> {
    const lang = resolveLanguageProfile(language);
    const masterPrompt = buildMasterPrompt(lang);

    const prompt = `${masterPrompt}

Analyze the SEO of the following content and respond ONLY in JSON:
{ "score": 0-100, "suggestions": [] }

CONTENT: ${content.slice(0, 3000)}
KEYWORDS: ${keywords.join(", ")}
`;
    const text = await this.generateText({ model: MODELS.FLASH, prompt, temperature: 0.2 });
    const parsed = this.extractJSON<SEOAnalysis>(text);
    if (!parsed) throw new Error("Invalid SEO analysis response");
    return parsed;
  }

  async polishText(html: string, language?: string): Promise<string> {
    const lang = resolveLanguageProfile(language);

    const prompt = `You are an expert ${lang.nameEn} copy editor with deep knowledge of ${lang.nameEn} grammar and style.
${lang.outputInstruction}

YOUR TASKS:
1. Correct all spelling errors and apply all required diacritics for ${lang.nameEn}.
${lang.grammarRules}
2. ${lang.capitalizationRules}
3. ${lang.punctuationRules}
4. ${lang.vocabularyPreferences}
5. Fix all bullets to: <li><strong>Term:</strong> explanation with period.</li> — colon INSIDE <strong>.

STRICT RULES:
- Keep ALL HTML tags exactly as they are.
- Do not add new paragraphs or change meaning.
- Return ONLY the corrected HTML, nothing else.
- ${lang.outputInstruction}

HTML TO CORRECT:
${html}

CORRECTED HTML:
`;
    const raw = await this.generateText({ model: MODELS.FLASH, prompt, temperature: 0.2 });
    return raw.trim();
  }

  async generateImage(prompt: string): Promise<string> {
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🖼️ Intento ${attempt} de generación de imagen`);

        const result = await this.ai.models.generateContent({
          model: MODELS.IMAGE,
          contents: prompt,
          config: {
            responseModalities: ["IMAGE", "TEXT"],
          },
        });

        const parts =
          (result as any)?.candidates?.[0]?.content?.parts ?? [];

        const imagePart = parts.find(
          (p: any) => p.inlineData?.mimeType?.startsWith("image/")
        );

        if (!imagePart?.inlineData?.data) {
          throw new Error("No image data returned by model");
        }

        const base64Image = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;

        await this.validateImageAspectRatio(base64Image);

        console.log("✅ Imagen válida (16:9) generada");
        return base64Image;

      } catch (error: any) {
        lastError = error.message;
        console.error("❌ Error en intento de imagen:", error);
      }
    }

    throw new Error(
      `No se pudo generar una imagen válida tras 3 intentos. Último error: ${lastError}`
    );
  }

  private async validateImageAspectRatio(base64Image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const ratio = img.width / img.height;
        const expected = 16 / 9;
        const tolerance = 0.02;

        if (Math.abs(ratio - expected) > tolerance) {
          reject(
            new Error(
              `Imagen inválida: ${img.width}x${img.height}. Se requiere ratio 16:9`
            )
          );
        } else {
          resolve();
        }
      };

      img.onerror = () =>
        reject(new Error("No se pudo cargar la imagen para validación"));

      img.src = base64Image;
    });
  }

  /**
   * Genera una imagen sin validar el aspect ratio.
   * Usar para GMB u otros formatos no 16:9.
   */
  async generateImageRaw(prompt: string): Promise<string> {
    const result = await this.ai.models.generateContent({
      model: MODELS.IMAGE,
      contents: prompt,
      config: { responseModalities: ["IMAGE", "TEXT"] },
    });

    const parts = (result as any)?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart?.inlineData?.data) {
      throw new Error("No image data returned by model");
    }

    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  }

  /* ======================================================
     GMB GENERATION
  ====================================================== */

  async generateGmbPost(params: GmbTextPromptParams): Promise<GmbPost> {
    const prompt = buildGmbTextPrompt(params);
    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.6,
    });
    return parseGmbPost(text);
  }

  buildGmbImagePrompt(params: GmbImagePromptParams): string {
    return buildGmbImagePrompt(params);
  }

  async analyzeWebsite(
    websiteUrl: string,
    keyword: string,
    businessName?: string,
    language: string = 'Español',
    extraContext?: string,
  ): Promise<ContentContext> {
    const lang = resolveLanguageProfile(language);

    const prompt = `Eres un agente experto en SEO y marketing de contenidos. Tu objetivo es analizar la web de un cliente y generar un bloque de contexto de contenido (CONTENT CONTEXT) en formato JSON estricto.

DATOS DE ENTRADA:
- URL del sitio web del cliente: ${websiteUrl}${extraContext ? `\n- Contexto adicional del cliente: ${extraContext}` : ''}
- Keyword principal del artículo: ${keyword}
- Nombre del negocio: ${businessName || 'No especificado'}
- Idioma del artículo: ${lang.nameNative}

INSTRUCCIONES:
1. Analiza el sitio web indicado para entender el negocio, su audiencia, tono de comunicación y propuesta de valor.
2. En base a la keyword principal y el contexto de la marca, genera el JSON de salida.
3. Si no puedes acceder al sitio web, infiere el contexto a partir de la URL, el nombre del negocio y la keyword.
4. Todos los textos deben estar en ${lang.nameNative}.
5. Para "related_questions": genera 5 preguntas estilo "People Also Ask" de Google, reales y concretas, que los usuarios buscan sobre esta keyword en el contexto de este negocio. Cada pregunta debe poder ser el eje de un artículo SEO diferente y único. No repitas la "main_user_question". OBLIGATORIO: cada pregunta debe empezar con un verbo interrogativo DISTINTO — usa exactamente este orden: ¿Cómo...?, ¿Cuánto...? / ¿Cuál es la diferencia...?, ¿Por qué...?, ¿Cuándo...? / ¿Cuál...?, ¿Dónde...? / long-tail con intención de conversión. NUNCA uses "¿Qué es...?" — eso ya lo cubre la main_user_question.
6. Para "writing_tone": detecta el tono de comunicación del sitio web (ej: "cercano y cercano", "formal", "profesional y técnico", "amigable", "informativo"). Una palabra o frase corta.
7. Para "grammatical_subject": detecta cómo el negocio se dirige a su audiencia. Usa EXACTAMENTE uno de estos valores: "yo a tú / nosotros a tú" | "yo a vosotros / nosotros a vosotros" | "yo a usted / nosotros a usted" | "yo a ustedes / nosotros a ustedes". Si no puedes determinarlo, usa "yo a tú / nosotros a tú".

Devuelve ÚNICAMENTE el siguiente JSON, sin texto adicional:
{
  "proposed_title": "Título H1 afirmativo optimizado para SEO (NO usar formato '¿Qué es X?')",
  "primary_keywords": ["keyword principal", "variante 1", "variante 2"],
  "secondary_keywords": ["keyword secundaria 1", "keyword secundaria 2", "keyword secundaria 3"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "search_intent": "Describe en 1-2 frases la intención de búsqueda del usuario objetivo",
  "brand_context_summary": "Resumen de 2-3 frases sobre el negocio, su audiencia y propuesta de valor",
  "main_user_question": "La pregunta principal que el usuario quiere responder con este artículo",
  "suggested_structure": ["Sección H2 1", "Sección H2 2", "Sección H2 3", "Sección H2 4"],
  "additional_notes": "Notas adicionales relevantes para la redacción (diferenciadores, CTAs recomendados)",
  "writing_tone": "cercano",
  "grammatical_subject": "yo a tú / nosotros a tú",
  "related_questions": [
    "Pregunta frecuente 1 que busca el usuario relacionada con la keyword y el negocio",
    "Pregunta frecuente 2 — ángulo diferente al artículo principal",
    "Pregunta frecuente 3 — problema o necesidad específica del cliente",
    "Pregunta frecuente 4 — comparación, precio, cómo funciona, etc.",
    "Pregunta frecuente 5 — long-tail con intención local o de conversión"
  ]
}`;

    const text = await this.generateText({
      model: MODELS.FLASH,
      prompt,
      temperature: 0.3,
    });

    const parsed = this.extractJSON<ContentContext>(text);
    if (!parsed || !parsed.proposed_title) {
      throw new Error('El agente web no pudo generar un contexto de contenido válido.');
    }
    return parsed;
  }

  /**
   * Aplica el feedback del cliente sobre un artículo existente.
   * Lee el HTML actual y el feedback, edita quirúrgicamente solo lo necesario
   * y devuelve el artículo completo modificado.
   */
  async applyFeedbackToArticle(
    existingTitle: string,
    existingHtml: string,
    feedback: string,
    language?: string
  ): Promise<{ title: string; content: string }> {
    const langProfile = resolveLanguageProfile(language);

    const prompt = `${langProfile.outputInstruction}

Eres un editor de contenido experto. Tu trabajo es aplicar el feedback de un cliente sobre un artículo existente.

REGLAS FUNDAMENTALES:
1. Lee el feedback con atención y aplica ÚNICAMENTE los cambios que este pide.
2. Si el feedback pide cambiar el tono → ajusta el tono pero mantén estructura y temas.
3. Si el feedback pide hablar de un tema específico → reorienta el contenido hacia ese tema.
4. Si el feedback pide agregar información → agrégala en la sección más apropiada.
5. Si el feedback pide eliminar algo → elimínalo.
6. Si el feedback pide cambiar el enfoque → cambia el enfoque pero conserva el formato HTML.
7. Lo que el feedback NO menciona → déjalo exactamente igual.
8. NUNCA regeneres el artículo completo desde cero si el feedback no lo pide.

${langProfile.grammarRules}

${langProfile.vocabularyPreferences}

FORMATO HTML — OBLIGATORIO:
- Solo estas etiquetas: <p>, <strong>, <ul>, <li>, <h2>, <a>
- Sin markdown, sin **, sin #

ARTÍCULO ACTUAL:
Título: ${existingTitle}

Contenido:
${existingHtml}

FEEDBACK DEL CLIENTE:
${feedback}

Devuelve ÚNICAMENTE este JSON (sin bloques de código, sin texto adicional):
{
  "title": "título del artículo (modificado solo si el feedback lo pide, si no, idéntico al original)",
  "content": "HTML completo del artículo con los cambios aplicados"
}`;

    const text = await this.generateText({
      model: MODELS.PRO,
      prompt,
      temperature: 0.4,
    });

    const parsed = this.extractJSON<{ title: string; content: string }>(text);
    if (!parsed?.content) {
      throw new Error('Gemini no pudo aplicar el feedback al artículo.');
    }
    return parsed;
  }
}

/* ======================================================
   EXPORT
====================================================== */

const API_KEY = (typeof import.meta !== 'undefined' && import.meta.env)
  ? (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)
  : (process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY);

const geminiService = new GeminiService(API_KEY || "");

export const generateKeywords =
  geminiService.generateKeywords.bind(geminiService);
export const generateArticleOutline =
  geminiService.generateArticleOutline.bind(geminiService);
export const generateSectionContent =
  geminiService.generateSectionContent.bind(geminiService);
export const analyzeSEO =
  geminiService.analyzeSEO.bind(geminiService);
export const polishText =
  geminiService.polishText.bind(geminiService);
export const pickBestWordPressCategory =
  geminiService.pickBestWordPressCategory.bind(geminiService);
export const generateImage =
  geminiService.generateImage.bind(geminiService);
export const generateArticleCluster =
  geminiService.generateArticleCluster.bind(geminiService);
export const generateGmbPost =
  geminiService.generateGmbPost.bind(geminiService);
export const buildGmbImagePromptFn =
  geminiService.buildGmbImagePrompt.bind(geminiService);
export const generateImageRaw =
  geminiService.generateImageRaw.bind(geminiService);
export const analyzeWebsite =
  geminiService.analyzeWebsite.bind(geminiService);
export const applyFeedbackToArticle =
  geminiService.applyFeedbackToArticle.bind(geminiService);

export default geminiService;