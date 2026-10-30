import { DownloadIcon, LoaderCircleIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { useCreateBriefs } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CopyButton } from "@/components/copy-button";

export function SendToStudio({ auditId, disabled, size = "default" }: { auditId: string; disabled: boolean; size?: "default" | "sm" }) {
  const create = useCreateBriefs();
  const [open, setOpen] = useState(false);
  const json = create.data ? JSON.stringify(create.data, null, 2) : "";

  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `studio-briefs-${create.data?.asin ?? auditId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        disabled={disabled || create.isPending}
        onClick={() => create.mutate(auditId, { onSuccess: () => setOpen(true), onError: () => setOpen(true) })}
      >
        {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <SendIcon aria-hidden="true" />}
        Send to Studio
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{create.error ? "Couldn't build the briefs" : "Briefs ready for Creative Studio"}</DialogTitle>
          {create.error ? (
            <DialogDescription className="text-destructive">{create.error.message}</DialogDescription>
          ) : (
            <>
              <DialogDescription>
                {create.data?.briefs.length} briefs for <span className="font-mono">{create.data?.asin}</span>, in the shape Studio takes. Each one names the
                field to change, the draft, and the brand data it came from.
              </DialogDescription>
              <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-[#2f2f2d] p-4 font-mono text-[12px] leading-relaxed text-[#f7f6f5]" tabIndex={0} aria-label="Briefs JSON">
                {json}
              </pre>
              <div className="flex flex-wrap justify-end gap-2">
                <CopyButton text={json} label="Copy JSON" />
                <Button type="button" variant="outline" size="sm" onClick={download}>
                  <DownloadIcon aria-hidden="true" /> Download
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
