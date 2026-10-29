import { ImageOffIcon } from "lucide-react";
import { useState } from "react";
import { imageKindLabel } from "@/lib/report";
import { cn } from "@/lib/utils";

type Img = { id: string; kind: "gallery" | "aplus"; url: string };

/** A listing image with its id and kind, so a person can check the transcribed claim at a glance. */
export function ImageThumb({ image, alt, className }: { image: Img | undefined; alt: string; className?: string | undefined }) {
  const [failed, setFailed] = useState(false);
  const wide = image?.kind === "aplus";
  return (
    <figure className={cn("min-w-0", className)}>
      <a
        href={image?.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-md border bg-white",
          wide ? "aspect-[2.44/1]" : "aspect-square",
          !image && "pointer-events-none",
        )}
        aria-label={image ? `Open ${imageKindLabel(image.kind).toLowerCase()} ${image.id} full size` : undefined}
      >
        {image && !failed ? (
          <img src={image.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-full object-contain" />
        ) : (
          <ImageOffIcon className="size-5 text-muted-foreground" aria-label="Image unavailable" />
        )}
      </a>
      {image && (
        <figcaption className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{imageKindLabel(image.kind)}</span>
          <span className="font-mono">{image.id}</span>
        </figcaption>
      )}
    </figure>
  );
}
