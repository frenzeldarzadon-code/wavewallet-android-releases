/**
 * Portal Design Gallery.
 *
 * A theme changes the generated portal's presentation only: the canonical
 * Omada master, its authentication mechanics, manual voucher entry and the
 * shop's enabled WaveWallet features are identical on every theme.
 *
 * Each tile is a real mini-preview rendered from the SAME CSS the generated
 * page uses, inside a sandboxed iframe with no network access at all.
 */
import { useMemo, useState } from "react";
import { Check, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { portalThemePreviewHtml, type PortalTheme } from "@/lib/portal-themes";
import type { PortalSectionFeatures } from "@/lib/portal-sections";

interface Props {
  themes: PortalTheme[];
  value: string;
  shopName: string;
  busy?: boolean;
  disabled?: boolean;
  /** The features currently enabled for this portal, so the design preview
   *  shows the same cards and buttons the generated page will contain. */
  features?: Partial<PortalSectionFeatures> | undefined;
  onSelect: (slug: string) => void;
}

export function PortalThemeGallery({
  themes,
  value,
  shopName,
  busy = false,
  disabled = false,
  features,
  onSelect,
}: Props) {
  const [preview, setPreview] = useState<PortalTheme | null>(null);
  const sorted = useMemo(
    () => [...themes].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [themes],
  );

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Design gallery</p>
          <p className="text-[11px] text-muted-foreground">
            {sorted.length} themes. The look changes; the Omada mechanics, manual voucher entry and
            your enabled features never do.
          </p>
        </div>
        {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((theme) => {
          const selected = theme.slug === value;
          return (
            <div
              key={theme.slug}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card transition",
                selected ? "border-primary ring-2 ring-primary/40" : "hover:border-primary/40",
              )}
            >
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => onSelect(theme.slug)}
                aria-pressed={selected}
                aria-label={`Use the ${theme.name} theme`}
                className="block w-full text-left disabled:opacity-60"
              >
                <span className="pointer-events-none block h-[132px] w-full overflow-hidden bg-muted">
                  <iframe
                    title={`${theme.name} preview`}
                    srcDoc={portalThemePreviewHtml(theme, { shopName, compact: true, features })}
                    sandbox=""
                    loading="lazy"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="h-[396px] w-[300%] origin-top-left scale-[.3333] border-0"
                  />
                </span>
                <span className="block space-y-0.5 px-2.5 py-2">
                  <span className="flex items-center gap-1.5">
                    {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                    <span className="truncate text-xs font-medium">{theme.name}</span>
                  </span>
                  <span className="line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                    {theme.description}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="absolute right-1.5 top-1.5 h-7 px-2 text-[11px] opacity-90"
                onClick={() => setPreview(theme)}
              >
                <Eye className="mr-1 h-3.5 w-3.5" />
                Preview
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-sm">{preview?.name}</DialogTitle>
            <DialogDescription className="text-xs">{preview?.description}</DialogDescription>
          </DialogHeader>
          {preview ? (
            <>
              <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border">
                <iframe
                  title={`${preview.name} full preview`}
                  srcDoc={portalThemePreviewHtml(preview, { shopName, features })}
                  sandbox=""
                  className="h-[520px] w-full border-0"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Static design preview with representative data. It uses the same layout, copy and
                CSS as the generated page; real shop products, coins and points only appear on the
                live portal.
              </p>
              <Button
                type="button"
                disabled={disabled || busy || preview.slug === value}
                onClick={() => {
                  onSelect(preview.slug);
                  setPreview(null);
                }}
              >
                {preview.slug === value ? "Currently selected" : `Use ${preview.name}`}
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
