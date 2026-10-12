"use client";

function coverDataUri(seed: string, label: string) {
  let n = 0;
  for (const c of seed) n = (n + c.charCodeAt(0) * 7) % 360;
  const safe = label.replace(/[<>&]/g, "").slice(0, 32);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${n},78%,54%)"/><stop offset="1" stop-color="hsl(${(n + 36) % 360},68%,30%)"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><circle cx="690" cy="78" r="120" fill="white" opacity=".16"/><circle cx="90" cy="390" r="80" fill="white" opacity=".1"/><text x="48" y="240" fill="white" font-family="Arial,sans-serif" font-size="40" font-weight="700">${safe}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function CoverImage({
  src,
  alt,
  label,
}: {
  src?: string;
  alt: string;
  label: string;
}) {
  const fallback = coverDataUri(label || alt, label || alt);
  return (
    <img
      src={src || fallback}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      onError={(event) => {
        const img = event.currentTarget;
        if (img.src !== fallback) img.src = fallback;
      }}
    />
  );
}
