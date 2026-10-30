import { ImageOffIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Img = { id: string; kind: "gallery" | "aplus"; url: string };

const imageName = (img: Img) => `${img.kind === "aplus" ? "A+ image" : "Image"} ${img.id.replace(/^img\./, "")}`;

/**
 * A listing image with its name, so a person can check the transcribed claim at a glance.
 * `overlay` sits on the image's lower edge (the claim it carries); the image opens full size.
 */
export function ImageThumb({
  image,
  alt,
  className,
  overlay,
  caption = true,
}: {
  image: Img | undefined;
  alt: string;
  className?: string | undefined;
  overlay?: ReactNode;
  caption?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const wide = image?.kind === "aplus";
  return (
    <figure className={cn("min-w-0", className)}>
      <a
        href={image?.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group relative flex items-center justify-center overflow-hidden rounded-xl border bg-white",
          wide ? "aspect-[2.44/1]" : "aspect-square",
          !image && "pointer-events-none",
        )}
        aria-label={image ? `Open ${imageName(image).toLowerCase()} full size` : undefined}
      >
        {image && !failed ? (
          <img
            src={image.url}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="size-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
            <ImageOffIcon className="size-5" aria-hidden="true" />
            Image unavailable
          </span>
        )}
        {overlay}
      </a>
      {image && caption && (
        <figcaption className="mt-1.5 text-xs text-muted-foreground" title={image.id}>
          {imageName(image)}
        </figcaption>
      )}
    </figure>
  );
}
