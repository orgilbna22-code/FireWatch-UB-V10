export const UB_MEDIA = {
  ger: '/assets/images/ub_ger_hillside_1794629996135.jpg',
  mixed: '/assets/images/ub_mixed_settlement_1794629996821.jpg',
  apartment: '/assets/images/ub_urban_apartments_1794629996588.jpg',
  satellite: '/assets/images/ub_satellite_orthophoto_1794629996932.jpg',
} as const;

export interface ResponsiveMediaSources {
  fallback: string;
  avifSrcSet?: string;
  webpSrcSet?: string;
  width: number;
  height: number;
}

const KNOWN_MEDIA_STEMS = new Set([
  '/assets/images/ub_ger_hillside_1794629996135.jpg',
  '/assets/images/ub_mixed_settlement_1794629996821.jpg',
  '/assets/images/ub_urban_apartments_1794629996588.jpg',
  '/assets/images/ub_satellite_orthophoto_1794629996932.jpg',
]);

export function getResponsiveMediaSources(url: string): ResponsiveMediaSources {
  if (!KNOWN_MEDIA_STEMS.has(url)) {
    return {
      fallback: url,
      width: 960,
      height: 717,
    };
  }
  const stem = url.replace(/\.jpg$/i, '');
  return {
    fallback: url,
    avifSrcSet: `${stem}-800.avif 800w`,
    webpSrcSet: `${stem}-400.webp 400w, ${stem}-800.webp 800w, ${stem}-1200.webp 1200w`,
    width: 960,
    height: 717,
  };
}
