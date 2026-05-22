import React from 'react';

type OptimizedImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string | null;
  fallbackSrc?: string;
};

const cdnBase = String(import.meta.env.VITE_SUPABASE_CDN_URL || '').trim().replace(/\/+$/, '');

const toCdnSrc = (value?: string | null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }
  if (!cdnBase) return raw;
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return `${cdnBase}${normalized}`;
};

export default function OptimizedImage({ src, fallbackSrc, loading, decoding, onError, ...props }: OptimizedImageProps) {
  const [resolvedSrc, setResolvedSrc] = React.useState(() => toCdnSrc(src));

  React.useEffect(() => {
    setResolvedSrc(toCdnSrc(src));
  }, [src]);

  return (
    <img
      {...props}
      src={resolvedSrc || fallbackSrc || ''}
      loading={loading || 'lazy'}
      decoding={decoding || 'async'}
      onError={(event) => {
        if (fallbackSrc && resolvedSrc !== fallbackSrc) {
          setResolvedSrc(fallbackSrc);
        } else if (!fallbackSrc) {
          // Hide broken-image alt text boxes when source is invalid/unreachable.
          setResolvedSrc('');
        }
        onError?.(event);
      }}
    />
  );
}
