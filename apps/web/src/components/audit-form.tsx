import { Asin, type SavedListing } from "@aloud/contracts";
import { ChevronDownIcon, GlobeIcon, InfoIcon, LoaderCircleIcon, ZapIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useCreateAudit, useListings } from "@/api/hooks";
import { USE_MOCKS, type CreateAuditInput, type SavedSource } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const SOURCES: { value: SavedSource; label: string }[] = [
  { value: "serpapi", label: "Live page" },
  { value: "dataset", label: "Saved (2023 dataset)" },
];

/** Placeholder ASIN for a pasted listing that has none; it passes the contract's ASIN check. */
const PASTE_ASIN = "B0PASTE001";

function asinError(value: string): string | null {
  const r = Asin.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? "Not a valid ASIN");
}

export function AuditForm() {
  const navigate = useNavigate();
  const create = useCreateAudit();
  const [asin, setAsin] = useState("");
  const [source, setSource] = useState<SavedSource>("serpapi");
  const [touched, setTouched] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const ids = { asin: useId(), asinHelp: useId(), mode: useId(), paste: useId() };
  const listings = useListings(source);

  const normalized = asin.trim().toUpperCase();
  const error = touched ? asinError(normalized) : null;
  const valid = !asinError(normalized);
  // Saved products audit instantly; anything else on the live source is fetched from Amazon.
  const saved = listings.data?.some((l) => l.asin === normalized) ?? false;
  const known = listings.data !== undefined;
  const live = source === "serpapi" && valid && known && !saved;

  function start(body: CreateAuditInput) {
    create.mutate(body, { onSuccess: (job) => navigate(`/audits/${job.id}`, { state: { live: body.live === true } }) });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (asinError(normalized)) return;
    start({ asin: normalized, source, ...(live && { live: true }) });
  }

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
      <form onSubmit={onSubmit} noValidate aria-label="Audit an ASIN">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label htmlFor={ids.asin}>Amazon ASIN</Label>
          <Segmented label="Listing source" value={source} onChange={setSource} options={SOURCES} />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            id={ids.asin}
            value={asin}
            onChange={(e) => setAsin(e.target.value)}
            onBlur={() => asin && setTouched(true)}
            placeholder="e.g. B0C9W8DD9S"
            autoComplete="off"
            spellCheck={false}
            maxLength={14}
            aria-invalid={!!error}
            aria-describedby={`${ids.asinHelp} ${ids.mode}`}
            className="h-11 font-mono text-base uppercase placeholder:normal-case sm:flex-1"
          />
          <Button type="submit" size="lg" disabled={create.isPending} className="sm:w-36">
            {create.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
            {create.isPending ? "Starting" : "Run audit"}
          </Button>
        </div>
        <p id={ids.asinHelp} className={cn("mt-2 text-[13px]", error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {error ?? "10 characters, starting with B0. Find it in the listing URL after /dp/."}
        </p>
        <ModeNote id={ids.mode} source={source} valid={valid} known={known} saved={saved} />
      </form>

      <DemoChips source={source} listings={listings} onPick={(a) => start({ asin: a, source })} disabled={create.isPending} />

      {create.error && (
        <p role="alert" className="mt-4 rounded-md bg-missing-bg px-3 py-2 text-sm text-missing">
          {create.error.message}
        </p>
      )}

      <div className="mt-5 border-t pt-4">
        <button
          type="button"
          aria-expanded={pasteOpen}
          aria-controls={ids.paste}
          onClick={() => setPasteOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-sm text-sm font-semibold text-primary-ink hover:underline"
        >
          <ChevronDownIcon className={cn("size-4 transition-transform", pasteOpen && "rotate-180")} aria-hidden="true" />
          Paste a listing instead
        </button>
        {pasteOpen && <PasteForm id={ids.paste} pending={create.isPending} onSubmit={start} asin={normalized} />}
      </div>
    </div>
  );
}

/** What happens when the button is pressed, said before it's pressed. */
function ModeNote({ id, source, valid, known, saved }: { id: string; source: SavedSource; valid: boolean; known: boolean; saved: boolean }) {
  let icon = null;
  let text: string | null = null;
  if (valid && known) {
    if (saved) {
      icon = <ZapIcon className="size-3.5 text-answered" aria-hidden="true" />;
      text = "Saved product: the audit is ready in seconds.";
    } else if (source === "dataset") {
      icon = <InfoIcon className="size-3.5" aria-hidden="true" />;
      text = "This ASIN isn't in the 2023 dataset. Switch to Live page to fetch it from Amazon.";
    } else if (USE_MOCKS) {
      icon = <InfoIcon className="size-3.5" aria-hidden="true" />;
      text = "New product: demo mode only has the saved products below. Start the API to fetch new ones from Amazon.";
    } else {
      icon = <GlobeIcon className="size-3.5 text-primary-ink" aria-hidden="true" />;
      text = "New product: we'll fetch it from Amazon, which takes about 1 to 2 minutes.";
    }
  }
  return (
    <p id={id} className="mt-1 flex min-h-5 items-center gap-1.5 text-[13px] text-muted-foreground" aria-live="polite">
      {icon}
      {text}
    </p>
  );
}

/** Demo products shown first, one per story: the hero, a strong listing, proof, other categories. */
const FEATURED = ["B0C9W8DD9S", "B001GAOTSW", "B097CF46RC", "B09VD1Z3TK", "B08PD98HYG", "B00P6N6LC2"];
const MAX_CHIPS = 6;

function pickChips(all: SavedListing[]): SavedListing[] {
  const rank = (a: string) => (FEATURED.includes(a) ? FEATURED.indexOf(a) : FEATURED.length);
  return [...all].sort((a, b) => rank(a.asin) - rank(b.asin)).slice(0, MAX_CHIPS);
}

function DemoChips({
  listings,
  onPick,
  disabled,
}: {
  source: SavedSource;
  listings: ReturnType<typeof useListings>;
  onPick: (asin: string) => void;
  disabled: boolean;
}) {
  if (listings.isError) return null;
  return (
    <div className="mt-5">
      <p className="text-[13px] font-semibold text-muted-foreground">Or try a saved product, ready in seconds</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-busy={listings.isLoading}>
        {listings.isLoading && [0, 1, 2].map((i) => <li key={i} className="h-8 w-40 animate-pulse rounded-full bg-muted" />)}
        {listings.data && pickChips(listings.data).map((l) => (
          <li key={l.asin}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(l.asin)}
              title={l.title}
              className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border bg-background px-3 text-[13px] transition-colors hover:border-[#f5b56a] hover:bg-tint active:scale-[0.98] disabled:opacity-50"
            >
              <span className="font-semibold">{l.brand ?? l.asin}</span>
              <span className="truncate text-muted-foreground">{l.category}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function PasteForm({ id, pending, onSubmit, asin }: { id: string; pending: boolean; onSubmit: (b: CreateAuditInput) => void; asin: string }) {
  const [v, setV] = useState({ title: "", bullets: "", description: "", attributes: "", category: "" });
  const [tried, setTried] = useState(false);
  const titleError = tried && v.title.trim().length < 3 ? "A title of at least 3 characters is needed." : null;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const f = { title: useId(), bullets: useId(), description: useId(), attributes: useId(), category: useId(), err: useId() };

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (v.title.trim().length < 3) return;
    const bullets = v.bullets.split("\n").map((b) => b.trim()).filter(Boolean).slice(0, 10);
    const attributes = parseAttributes(v.attributes);
    onSubmit({
      asin: Asin.safeParse(asin).success ? asin : PASTE_ASIN,
      source: "paste",
      paste: {
        title: v.title.trim(),
        ...(bullets.length && { bullets }),
        ...(v.description.trim() && { description: v.description.trim() }),
        ...(Object.keys(attributes).length && { attributes }),
      },
      ...(v.category.trim() && { category: v.category.trim() }),
    });
  }

  return (
    <form id={id} onSubmit={submit} noValidate aria-label="Paste a listing" className="mt-4 grid gap-4">
      <p className="text-[13px] text-muted-foreground">For a listing that isn't live yet, or a draft. The ASIN above is used if it's valid.</p>
      <div className="grid gap-1.5">
        <Label htmlFor={f.title}>Title</Label>
        <Input id={f.title} value={v.title} onChange={set("title")} aria-invalid={!!titleError} aria-describedby={titleError ? f.err : undefined} />
        {titleError && (
          <p id={f.err} className="text-[13px] text-destructive">
            {titleError}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={f.bullets}>Bullets</Label>
        <Textarea id={f.bullets} value={v.bullets} onChange={set("bullets")} rows={4} placeholder="One bullet per line" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={f.description}>Description</Label>
        <Textarea id={f.description} value={v.description} onChange={set("description")} rows={3} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={f.attributes}>Attributes</Label>
          <Textarea id={f.attributes} value={v.attributes} onChange={set("attributes")} rows={3} placeholder={"Line size: 0.5 mm\nInk color: Black"} className="font-mono text-[13px]" />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={f.category}>Category</Label>
          <Input id={f.category} value={v.category} onChange={set("category")} placeholder="Gel Ink Rollerball Pens" />
          <p className="text-[13px] text-muted-foreground">Picks which shopper questions to grade against.</p>
        </div>
      </div>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          Audit pasted listing
        </Button>
      </div>
    </form>
  );
}
