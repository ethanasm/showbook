"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import Image from "next/image";
import "./design-system.css";
import type { ShowKind } from "./KindBadge";

type ImageAspect = "square" | "3/2" | "16/9";
type ImageSize = "thumb" | "card" | "hero";
type FallbackKind = ShowKind | "venue" | "shows" | "artists" | "discover" | "map";

const KIND_COLOR: Record<FallbackKind, string> = {
  concert: "var(--kind-concert)",
  theatre: "var(--kind-theatre)",
  comedy: "var(--kind-comedy)",
  festival: "var(--kind-festival)",
  venue: "var(--accent)",
  shows: "var(--accent)",
  artists: "var(--kind-concert)",
  discover: "var(--kind-festival)",
  map: "var(--kind-theatre)",
};

const SIZE_HINTS: Record<ImageSize, string> = {
  thumb: "32px",
  card: "96px",
  hero: "(max-width: 768px) 100vw, 720px",
};

function aspectClass(aspect: ImageAspect) {
  if (aspect === "3/2") return "remote-image--aspect-3-2";
  if (aspect === "16/9") return "remote-image--aspect-16-9";
  return "remote-image--aspect-square";
}

function initials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "S";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}

export function MonogramFallback({
  name,
  kind,
}: {
  name: string;
  kind: FallbackKind;
}) {
  return (
    <span
      className="monogram-fallback"
      style={{ "--monogram-color": KIND_COLOR[kind] } as CSSProperties}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function RemoteImage({
  src,
  alt,
  kind,
  name,
  aspect = "square",
  size = "thumb",
  priority = false,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  kind: FallbackKind;
  name: string;
  aspect?: ImageAspect;
  size?: ImageSize;
  priority?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const imageSrc = src && !failed ? src : null;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span
      className={[
        "remote-image",
        `remote-image--${size}`,
        aspectClass(aspect),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--monogram-color": KIND_COLOR[kind] } as CSSProperties}
    >
      {imageSrc ? (
        <Image
          src={imageSrc}
          alt={alt}
          fill
          sizes={SIZE_HINTS[size]}
          className="remote-image__img"
          priority={priority}
          onError={() => setFailed(true)}
        />
      ) : (
        <MonogramFallback name={name} kind={kind} />
      )}
    </span>
  );
}
