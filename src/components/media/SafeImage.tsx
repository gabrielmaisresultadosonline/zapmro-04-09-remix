import React, { useEffect, useState } from "react";

/** Imagem que mostra `fallback` quando o arquivo não carrega (ex.: perdido no servidor). */
export function SafeImage({
  fallback,
  src,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & { fallback: React.ReactNode }) {
  const [broken, setBroken] = useState(!src);
  useEffect(() => setBroken(!src), [src]);
  if (broken) return <>{fallback}</>;
  return <img src={src} onError={() => setBroken(true)} {...rest} />;
}

export default SafeImage;
