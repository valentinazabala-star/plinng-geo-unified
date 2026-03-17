export type ContentType = 'on_blog' | 'off_page' | 'gmb';

export type ContentStage = 'tofu' | 'mofu' | 'bofu';

export interface LocationContext {
  city: string;
  neighborhood?: string;
  province?: string;
  country?: string;
}

// NUEVO: de geo2-main (soporte multiidioma)
export type SupportedLanguageCode = 'es' | 'en' | 'pt' | 'fr' | 'it' | 'de' | 'nl' | 'ca';

export interface SEOAnalysis {
  score: number;
  suggestions: string[];
  keywordDensity: { [key: string]: number };
  readability: string;
}

export interface Section {
  id: string;
  title: string;
  content: string;
  keywords: string[];
}

export interface Article {
  title: string;
  metaTitle?: string;
  metaDescription: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  introduction?: string;
  sections: Section[];
  contentType: ContentType;
  competitorUrls?: string[];
  language?: string;              // NUEVO: de geo2-main (idioma detectado del brief)
  featuredImage?: {
    prompt: string;
    size: string;
    altText: string;
    base64?: string;
  };
}

// Se mantiene EXACTAMENTE como lo tienes (as const)
export const AppStep = {
  AUTH: 'auth',
  ACCOUNT: 'account',
  KEYWORDS: 'keywords',
  CONTENT_TYPE: 'content_type',
  WEBSITE_ANALYSIS: 'website_analysis',
  OUTLINE: 'outline',
  WRITING: 'writing',
} as const;

export type AppStep = (typeof AppStep)[keyof typeof AppStep];

export interface ContentContext {
  proposed_title: string;
  primary_keywords: string[];
  secondary_keywords: string[];
  tags: string[];
  search_intent: string;
  brand_context_summary: string;
  main_user_question: string;
  suggested_structure: string[];
  additional_notes: string;
}