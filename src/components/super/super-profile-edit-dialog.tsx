/**
 * Edit dialog for the platform owner's own profile.
 *
 * Authorization is unchanged: every write goes through `update_own_profile`
 * (which only ever edits `auth.uid()`'s row) and the contact server function.
 */
import { useServerFn } from "@tanstack/react-start";
import { Check, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ImageCropper } from "@/components/image-cropper";
import { MemberAvatar } from "@/components/member-avatar";
import type { CropRect } from "@/lib/image-optimize";
import { validateImageFile } from "@/lib/image-optimize";
import {
  checkHandle,
  deleteAvatar,
  normalizeHandle,
  profileSaveIssue,
  updateOwnProfile,
  uploadAvatar,
  validateHandle,
  type HandleCheck,
  type MyProfile,
} from "@/lib/profile";
import { updateOwnContact } from "@/lib/profile-contact.functions";
import {
  preferencesPatch,
  validateBio,
  type MemberPreferences,
} from "@/lib/super-profile";

type HandleState = "idle" | "checking" | HandleCheck;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: MyProfile;
  ecosystemId: string | null;
  preferences: MemberPreferences;
  onSaved: () => void | Promise<void>;
}

export function SuperProfileEditDialog({
  open,
  onOpenChange,
  profile,
  ecosystemId,
  preferences,
  onSaved,
}: Props) {
  const saveContact = useServerFn(updateOwnContact);
  const [name, setName] = useState(profile.full_name ?? "");
  const [handle, setHandle] = useState(profile.handle ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [notify, setNotify] = useState(preferences);
  const [handleState, setHandleState] = useState<HandleState>("idle");
  const [handleError, setHandleError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens so a cancelled edit never sticks.
  useEffect(() => {
    if (!open) return;
    setName(profile.full_name ?? "");
    setHandle(profile.handle ?? "");
    setEmail(profile.email ?? "");
    setPhone(profile.phone ?? "");
    setBio(profile.bio ?? "");
    setNotify(preferences);
    setFile(null);
    setCrop(null);
    setRemovePhoto(false);
    setHandleState("idle");
    setHandleError(null);
  }, [open, profile, preferences]);

  useEffect(() => {
    const value = normalizeHandle(handle);
    const current = normalizeHandle(profile.handle ?? "");
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
      const result = await checkHandle(value, profile.handle);
      if (active) setHandleState(result);
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [handle, profile.handle]);

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

  const currentAvatar = removePhoto ? null : (profile.avatar_path ?? null);

  const save = async () => {
    const issue =
      profileSaveIssue({
        name,
        handle,
        handleState,
        hasFile: Boolean(file),
        hasCrop: Boolean(crop),
      }) ?? validateBio(bio);
    if (issue) {
      toast.error(issue);
      return;
    }
    setBusy(true);
    try {
      let avatarPath: string | undefined;
      if (file && crop) {
        avatarPath = await uploadAvatar({
          ecosystemId,
          userId: profile.id,
          source: crop.image,
          crop: crop.crop,
          previousPath: profile.avatar_path,
        });
      }
      const prefPatch = preferencesPatch(notify, preferences);
      await updateOwnProfile({
        fullName: name,
        handle: normalizeHandle(handle),
        bio,
        ...(avatarPath ? { avatarPath } : {}),
        ...(removePhoto && !avatarPath ? { clearAvatar: true } : {}),
        ...(prefPatch ? { preferences: prefPatch } : {}),
      });
      if (removePhoto && !avatarPath) await deleteAvatar(profile.avatar_path);

      const contactChanged =
        phone.trim() !== (profile.phone ?? "") ||
        email.trim().toLowerCase() !== (profile.email ?? "").toLowerCase();
      if (contactChanged) {
        await saveContact({ data: { phone: phone.trim(), email: email.trim() } });
      }

      toast.success("Profile updated");
      await onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? null : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your name, @handle and photo identify you across the platform console.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label>Profile photo</Label>
            {file ? (
              <ImageCropper file={file} aspect={1} circular onChange={setCrop} resultLabel="Profile photo" />
            ) : (
              <div className="flex items-center gap-4">
                <MemberAvatar
                  path={currentAvatar}
                  name={name || profile.full_name}
                  className="size-16 text-base"
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
                onClick={() => document.getElementById("super-avatar-input")?.click()}
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
              id="super-avatar-input"
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
            <Label htmlFor="super-name">Display name</Label>
            <Input
              id="super-name"
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="super-handle">Username</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                @
              </span>
              <Input
                id="super-handle"
                className="h-11 pl-7"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/^@+/, ""))}
                placeholder="yourhandle"
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
                @{normalizeHandle(handle)} is already taken
              </p>
            ) : handleState === "unknown" ? (
              <p className="text-xs text-muted-foreground">
                We could not check that username right now. You can still try saving it.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                3–20 letters, numbers, dots or underscores.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="super-email">Email address</Label>
              <Input
                id="super-email"
                className="h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoCapitalize="none"
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="super-phone">Phone number</Label>
              <Input
                id="super-phone"
                className="h-11"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="super-bio">Bio</Label>
            <Textarea
              id="super-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="A short professional description shown on your profile."
            />
            <p className="text-xs text-muted-foreground">{bio.trim().length}/280 characters</p>
          </div>

          <Separator />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Notification preferences</legend>
            {(
              [
                ["notifySubscriptions", "Subscription requests", "Payment proofs awaiting review"],
                ["notifyApplications", "Membership applications", "New accounts awaiting approval"],
                ["notifySecurity", "Security events", "Account access and role changes"],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor={`pref-${key}`} className="text-sm font-normal">
                    {label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  id={`pref-${key}`}
                  checked={notify[key]}
                  onCheckedChange={(v) => setNotify((p) => ({ ...p, [key]: v }))}
                />
              </div>
            ))}
          </fieldset>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11"
            onClick={() => void save()}
            disabled={busy || handleState === "checking" || handleState === "taken"}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
