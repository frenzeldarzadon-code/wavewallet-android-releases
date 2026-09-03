import { useServerFn } from "@tanstack/react-start";
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
import { SocialLinksCard } from "@/components/social-links-card";
import { AccountSecurityCard } from "@/components/account-security-card";
import { LoginCredentialCard } from "@/components/login-credential-card";
import { supabase } from "@/integrations/supabase/client";
import { PageSection as CredentialSection } from "@/components/ui-kit";
import { UpdateCenterCard } from "@/components/update-center-card";
import type { CropRect } from "@/lib/image-optimize";
import {
  avatarUrl,
  deleteAvatar,
  fetchMyProfile,
  checkHandle,
  normalizeHandle,
  profileSaveIssue,
  updateOwnProfile,
  uploadAvatar,
  uploadProfileCover,
  updateOwnProfileCover,
  validateHandle,
  type MyProfile,
} from "@/lib/profile";
import { PROFILE_COVER_ASPECT, validateImageFile } from "@/lib/image-optimize";
import { updateOwnContact } from "@/lib/profile-contact.functions";
import { defaultStoreName } from "@/lib/seller-storefront";
import { useSession } from "@/lib/session";

type HandleState = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";

/** Seller's customised storefront name, stored in profile preferences. */
function storefrontNameOf(preferences: unknown): string {
  const v = (preferences as { storefront_name?: unknown } | null)?.storefront_name;
  return typeof v === "string" ? v.trim() : "";
}

export function ProfilePage() {
  // No required role here: the parent layout route (/app, /admin, /reseller, /super)
  // already gates access. Every member edits only their own profile — the database
  // authorizes each write via auth.uid().
  const { account, ecosystemDbId, reload, actingAs } = useSession();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [storeName, setStoreName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [handleState, setHandleState] = useState<HandleState>("idle");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverCrop, setCoverCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  // Signed URL of the cover already saved, so the editor never shows a blank block.
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void avatarUrl(profile?.cover_path).then((url) => {
      if (active) setCurrentCoverUrl(url);
    });
    return () => {
      active = false;
    };
  }, [profile?.cover_path]);

  const userId = account?.id ?? null;
  // Existing username sign-in, if the member set one. Passwords are never read back.
  const [loginUsername, setLoginUsername] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void supabase
      .from("login_usernames")
      .select("username")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setLoginUsername((data as { username: string } | null)?.username ?? null);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  const saveContact = useServerFn(updateOwnContact);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const p = await fetchMyProfile(userId);
      setProfile(p);
      setName(p?.full_name ?? "");
      setHandle(p?.handle ?? "");
      setPhone(p?.phone ?? "");
      setEmail(p?.email ?? "");
      setStoreName(storefrontNameOf(p?.preferences));
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
      const result = await checkHandle(value, profile?.handle);
      if (active) setHandleState(result);
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
    if (!userId || !profile) {
      toast.error("Your profile is still loading — try again in a moment");
      return;
    }
    const issue = profileSaveIssue({
      name,
      handle,
      handleState,
      hasFile: Boolean(file),
      hasCrop: Boolean(crop),
    });
    if (issue) {
      toast.error(issue);
      return;
    }
    setBusy(true);
    try {
      let avatarPath: string | null | undefined;
      let coverPath: string | null | undefined;
      if (file && crop) {
        avatarPath = await uploadAvatar({
          ecosystemId: ecosystemDbId,
          userId,
          source: crop.image,
          crop: crop.crop,
          previousPath: profile.avatar_path,
        });
      }
      if (coverFile && coverCrop) {
        coverPath = await uploadProfileCover({ ecosystemId: ecosystemDbId, userId, source: coverCrop.image, crop: coverCrop.crop, previousPath: profile.cover_path });
        await updateOwnProfileCover(coverPath);
      }
      const storedStoreName = storefrontNameOf(profile.preferences);
      await updateOwnProfile({
        fullName: name,
        handle: normalizeHandle(handle),
        ...(avatarPath ? { avatarPath } : {}),
        ...(removePhoto && !avatarPath ? { clearAvatar: true } : {}),
        ...(storeName.trim() !== storedStoreName
          ? { preferences: { storefront_name: storeName.trim() } }
          : {}),
      });
      if (removePhoto && !avatarPath) await deleteAvatar(profile.avatar_path);

      // Contact details move the auth login too, so they go through a server function.
      const contactChanged =
        phone.trim() !== (profile.phone ?? "") ||
        email.trim().toLowerCase() !== (profile.email ?? "").toLowerCase();
      if (contactChanged) {
        await saveContact({ data: { phone: phone.trim(), email: email.trim() } });
      }

      setFile(null);
      setCrop(null);
      setRemovePhoto(false);
      setCoverFile(null);
      setCoverCrop(null);
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

  // Identity and security settings stay with the account owner: an operator who
  // is acting as a member cannot change their name, @handle, photo or contacts.
  if (actingAs) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <PageSection devSlot="profile-page.profile"
          title="Profile"
          description={`You are acting as ${actingAs.session.targetName}.`}
        >
          <Card>
            <CardContent className="space-y-2 p-4 sm:p-5">
              <p className="text-sm font-medium">Profile editing is unavailable while acting as a member.</p>
              <p className="text-sm text-muted-foreground">
                Names, @handles, photos, contact details and security settings can only be changed
                by the account owner. Use “Edit” in your member list for permitted admin changes —
                those are logged under your own name.
              </p>
            </CardContent>
          </Card>
        </PageSection>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <PageSection devSlot="profile-page.my-profile"
        title="My profile"
        description="Your display name, @handle and photo are visible to your shop when you send or receive coins."
      >
        <Card>
          <CardContent className="space-y-5 p-4 sm:p-5">
            <div className="space-y-2">
              <Label>Profile cover</Label>
              {coverFile ? (
                <ImageCropper
                  file={coverFile}
                  aspect={PROFILE_COVER_ASPECT}
                  onChange={setCoverCrop}
                  resultLabel="Cover as shown on your profile"
                />
              ) : (
                <div
                  className="aspect-[3/1] w-full rounded-lg border border-border bg-brand-soft bg-cover bg-center"
                  style={currentCoverUrl ? { backgroundImage: `url(${currentCoverUrl})` } : undefined}
                  role="img"
                  aria-label={currentCoverUrl ? "Current profile cover" : "No cover yet"}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => document.getElementById("cover-input")?.click()}><ImagePlus className="size-4" /> {profile?.cover_path || coverFile ? "Replace cover" : "Add cover"}</Button>
                {coverFile ? (
                  <Button type="button" variant="ghost" className="h-11 flex-1" onClick={() => { setCoverFile(null); setCoverCrop(null); }}>
                    <X className="size-4" /> Cancel
                  </Button>
                ) : null}
              </div>
              <input id="cover-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const picked = e.target.files?.[0] ?? null; if (picked) { const problem = validateImageFile(picked); if (problem) toast.error(problem); else setCoverFile(picked); } e.target.value = ""; }} />
            </div>
            <div className="space-y-2">
              <Label>Profile photo</Label>
              {file ? (
                <ImageCropper file={file} aspect={1} circular onChange={setCrop} resultLabel="Profile photo" />
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
              ) : handleState === "unknown" ? (
                <p className="text-xs text-muted-foreground">
                  We could not check that handle right now. You can still try saving it.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  3–20 letters, numbers, dots or underscores. Others can find you by @handle when
                  sending coins.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="storefront-name">Storefront name</Label>
              <Input
                id="storefront-name"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="h-11"
                placeholder={defaultStoreName(name || "My")}
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                Shown to Universe customers on your seller card and storefront. Leave blank to use
                &ldquo;{defaultStoreName(name || "My")}&rdquo;.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-phone">Phone number</Label>
              <Input
                id="profile-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-11"
                placeholder="09XX XXX XXXX"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email address</Label>
              <Input
                id="profile-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
                placeholder="Your email address"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
              />
              <p className="text-xs text-muted-foreground">
                This is also your sign-in address. Your phone and email are never shown in coin
                recipient search results.
              </p>
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

      <AccountSecurityCard username={profile?.handle ?? null} />

      {userId ? (
        <CredentialSection
          title="Username sign-in"
          description="Optional: sign in with a username and password instead of your email or mobile number."
        >
          <LoginCredentialCard userId={userId} current={loginUsername} self onSaved={(u) => setLoginUsername(u || null)} />
        </CredentialSection>
      ) : null}

      <UpdateCenterCard />

      {ecosystemDbId && userId ? (
        <SocialLinksCard ecosystemId={ecosystemDbId} userId={userId} />
      ) : null}
    </div>
  );
}
