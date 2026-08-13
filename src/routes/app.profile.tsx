import { createFileRoute } from "@tanstack/react-router";
import { Check, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection } from "@/components/ui-kit";
import { ImageCropper } from "@/components/image-cropper";
import { MemberAvatar } from "@/components/member-avatar";
import type { CropRect } from "@/lib/image-optimize";
import {
  deleteAvatar,
  fetchMyProfile,
  isHandleAvailable,
  normalizeHandle,
  updateOwnProfile,
  uploadAvatar,
  validateDisplayName,
  validateHandle,
  type MyProfile,
} from "@/lib/profile";
import { validateImageFile } from "@/lib/image-optimize";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — WaveWallet" },
      {
        name: "description",
        content:
          "Update your display name, choose a unique @handle and set a profile photo for your WaveWallet account.",
      },
      { property: "og:title", content: "My Profile — WaveWallet" },
      {
        property: "og:description",
        content: "Manage your display name, @handle and profile photo.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerProfile,
});

type HandleState = "idle" | "checking" | "available" | "taken" | "invalid";

function CustomerProfile() {
  const { account, ecosystemDbId, reload } = useSession("customer");
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleState, setHandleState] = useState<HandleState>("idle");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const p = await fetchMyProfile(userId);
      setProfile(p);
      setName(p?.full_name ?? "");
      setHandle(p?.handle ?? "");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Friendly availability check; the database still enforces uniqueness on save.
  useEffect(() => {
    const value = normalizeHandle(handle);
    const current = normalizeHandle(profile?.handle ?? "");
    if (!value || value === current) {
      setHandleState("idle");
      setHandleError(null);
      return;
    }
    const problem = validateHandle(value);
    if (problem) {
      setHandleState("invalid");
      setHandleError(problem);
      return;
    }
    setHandleError(null);
    setHandleState("checking");
    let active = true;
    const timer = window.setTimeout(async () => {
      const ok = await isHandleAvailable(value);
      if (active) setHandleState(ok ? "available" : "taken");
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [handle, profile?.handle]);

  const pickFile = (picked: File | null) => {
    if (!picked) return;
    const problem = validateImageFile(picked);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(picked);
    setCrop(null);
    setRemovePhoto(false);
  };

  const save = async () => {
    if (!userId || !ecosystemDbId || !profile) return;
    const nameProblem = validateDisplayName(name);
    if (nameProblem) {
      toast.error(nameProblem);
      return;
    }
    const handleProblem = validateHandle(handle);
    if (handleProblem) {
      toast.error(handleProblem);
      return;
    }
    if (handleState === "taken") {
      toast.error("That handle is already taken in this shop");
      return;
    }
    setBusy(true);
    try {
      let avatarPath: string | null | undefined;
      if (file && crop) {
        avatarPath = await uploadAvatar({
          ecosystemId: ecosystemDbId,
          userId,
          source: crop.image,
          crop: crop.crop,
          previousPath: profile.avatar_path,
        });
      }
      await updateOwnProfile({
        fullName: name,
        handle: normalizeHandle(handle),
        ...(avatarPath ? { avatarPath } : {}),
        ...(removePhoto && !avatarPath ? { clearAvatar: true } : {}),
      });
      if (removePhoto && !avatarPath) await deleteAvatar(profile.avatar_path);
      setFile(null);
      setCrop(null);
      setRemovePhoto(false);
      toast.success("Profile updated");
      await load();
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentAvatar = removePhoto ? null : (profile?.avatar_path ?? null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <PageSection
        title="My profile"
        description="Your display name, @handle and photo are visible to your shop when you send or receive credits."
      >
        <Card>
          <CardContent className="space-y-5 p-4 sm:p-5">
            <div className="space-y-2">
              <Label>Profile photo</Label>
              {file ? (
                <ImageCropper file={file} aspect={1} circular onChange={setCrop} />
              ) : (
                <div className="flex items-center gap-4">
                  <MemberAvatar
                    path={currentAvatar}
                    name={profile?.full_name ?? "You"}
                    className="size-20 text-lg"
                  />
                  <p className="text-xs text-muted-foreground">
                    Square photo, stored small and compressed. JPG, PNG, WEBP or GIF up to 8 MB.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => document.getElementById("avatar-input")?.click()}
                >
                  <ImagePlus className="size-4" />
                  {currentAvatar || file ? "Replace photo" : "Upload photo"}
                </Button>
                {file ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 flex-1"
                    onClick={() => {
                      setFile(null);
                      setCrop(null);
                    }}
                  >
                    <X className="size-4" /> Cancel
                  </Button>
                ) : currentAvatar ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 flex-1 text-destructive"
                    onClick={() => setRemovePhoto(true)}
                  >
                    <Trash2 className="size-4" /> Remove
                  </Button>
                ) : null}
              </div>
              <input
                id="avatar-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11"
                placeholder="Your name"
                autoComplete="name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="handle">Social handle</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  @
                </span>
                <Input
                  id="handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.replace(/^@+/, ""))}
                  className="h-11 pl-7"
                  placeholder="yourhandle"
                  inputMode="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              {handleError ? (
                <p className="text-xs text-destructive">{handleError}</p>
              ) : handleState === "checking" ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Checking availability…
                </p>
              ) : handleState === "available" ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <Check className="size-3" /> @{normalizeHandle(handle)} is available
                </p>
              ) : handleState === "taken" ? (
                <p className="text-xs text-destructive">
                  @{normalizeHandle(handle)} is already taken in this shop
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  3–20 letters, numbers, dots or underscores. Others can find you by @handle when
                  sending credits.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Signed in as {profile?.email}. Contact your shop admin to change your email or phone
              number.
            </div>

            <Button
              className="h-11 w-full"
              onClick={() => void save()}
              disabled={busy || handleState === "checking" || handleState === "taken"}
            >
              {busy ? "Saving…" : "Save profile"}
            </Button>
          </CardContent>
        </Card>
      </PageSection>
    </div>
  );
}
