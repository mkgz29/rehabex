type ImageTransformOptions = {
  width: number;
};

export function getOptimizedImageUrl(url: string, { width }: ImageTransformOptions) {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'res.cloudinary.com' || !parsed.pathname.includes('/upload/')) return url;

    const transform = `f_auto,q_auto:eco,c_limit,w_${Math.round(width)}`;
    parsed.pathname = parsed.pathname.replace('/upload/', `/upload/${transform}/`);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function getResponsiveImageSrcSet(url: string, widths: number[]) {
  if (!url || !url.includes('res.cloudinary.com')) return undefined;
  return widths.map((width) => `${getOptimizedImageUrl(url, { width })} ${width}w`).join(', ');
}
