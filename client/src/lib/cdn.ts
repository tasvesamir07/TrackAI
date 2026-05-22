const CLOUDFLARE_URL = String(import.meta.env.VITE_CLOUDFLARE_URL || '').trim();
const SUPABASE_CDN_URL = String(import.meta.env.VITE_SUPABASE_CDN_URL || '').trim();

export function getCdnUrl(path: string): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }
  
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  
  const cdnBase = CLOUDFLARE_URL || SUPABASE_CDN_URL;
  if (!cdnBase) return normalized;
  
  return `${cdnBase.replace(/\/+$/, '')}${normalized}`;
}

export function getOptimizedImageUrl(path: string, options?: {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'jpeg';
}): string {
  const baseUrl = getCdnUrl(path);
  
  if (!baseUrl || !CLOUDFLARE_URL) return baseUrl;
  
  const params = new URLSearchParams();
  if (options?.width) params.set('width', String(options.width));
  if (options?.height) params.set('height', String(options.height));
  if (options?.quality) params.set('quality', String(options.quality));
  if (options?.format) params.set('format', options.format);
  
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

export const CDN_CONFIG = {
  imageFormats: ['webp', 'avif'],
  defaultQuality: 80,
  cacheControl: {
    staticAssets: 'public, max-age=2592000, immutable',
    dynamicContent: 'no-cache',
    apiResponses: 'no-store, no-cache, must-revalidate',
  },
  compression: {
    enabled: true,
    algorithms: ['br', 'gzip'],
  },
};

export default {
  getCdnUrl,
  getOptimizedImageUrl,
  CDN_CONFIG,
};