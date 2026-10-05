import { useState } from "react";

/** Photo of a catalog item, or a neutral placeholder when there is none or the file is broken. */
export default function ProductImage({ src, alt, className = "", lazy = true }) {
  const [failedSrc, setFailedSrc] = useState(null);

  if (!src || failedSrc === src) {
    return (
      <span
        className={`product-image-placeholder ${className}`.trim()}
        role="img"
        aria-label={alt ? `${alt}: нет фото` : "Нет фото"}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className || undefined}
      loading={lazy ? "lazy" : undefined}
      onError={() => setFailedSrc(src)}
    />
  );
}
