/**
 * Platform owner profile — the Super Admin "command centre" view.
 *
 * Every figure on this page is read from data the console already owns
 * (`platform_overview`, `audit_logs`, the caller's own profile and auth user).
 * Nothing here widens permissions: the database still authorizes each read and
 * write, and an operator acting as another member cannot edit identity.
 */
import { Link } from "@tanstack/react-router";
import {
  Activity,
  BadgeCheck,
  Building2,
  Clock,
  Coins,
  Fingerprint,
  Globe,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  Pencil,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { SuperProfileEditDialog } from "@/components/super/super-profile-edit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { displayHandle, fetchMyProfile, updateOwnProfile, type MyProfile } from "@/lib/profile";
import { type EcosystemOverviewRow } from "@/lib/platform-overview";
import { useSession } from "@/lib/session";
import {
  applyAppearance,
  describeDevice,
  isSecurityEvent,
  LANGUAGES,
  parsePreferences,
  platformSnapshot,
  preferencesPatch,
  profileCompletion,
  systemHealth,
  TIMEZONES,
  type AppearanceMode,
  type MemberPreferences,
} from "@/lib/super-profile";
import { cn } from "@/lib/utils";
import { peso, shortDate, shortDateTime } from "@/lib/wavewallet";

interface AuditRow {
  id: string;
  action: string;
  target: string;
  actor_name: string;
  ecosystem_id: string | null;
  created_at: string;
}

interface AuthFacts {
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  provider: string;
  mfaEnabled: boolean;
}

const PRIVILEGES: Array<{ label: string; hint: string; icon: LucideIcon; to?: string }> = [
  { label: "Manage admins", hint: "Create, invite and restructure shop owners", icon: UserCheck, to: "/super/admins" },
  { label: "Access shops", hint: "Enter any tenant with a full audit trail", icon: Building2, to: "/super/admins" },
  { label: "Platform settings", hint: "Pricing, payments and platform defaults", icon: Settings, to: "/super/settings" },
  { label: "Credit management", hint: "Mint or remove credits in any shop", icon: Coins, to: "/super/credits" },
  { label: "Reports", hint: "Cross-tenant financial reporting", icon: TrendingUp, to: "/super/reports" },
  { label: "Audit trail", hint: "Every privileged action, permanently recorded", icon: ScrollText, to: "/super/audit" },
];

export function SuperProfilePage() {
  const { account, ecosystemDbId, actingAs, reload, signOut } = useSession();
  const userId = account?.id ?? null;

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [rows, setRows] = useState<EcosystemOverviewRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [auth, setAuth] = useState<AuthFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [p, overview, events, user] = await Promise.all([
        fetchMyProfile(userId),
        supabase.rpc("platform_overview"),
        supabase
          .from("audit_logs")
          .select("id, action, target, actor_name, ecosystem_id, created_at")
          .eq("actor_id", userId)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase.auth.getUser(),
      ]);
      setProfile(p);
      setRows((overview.data as EcosystemOverviewRow[] | null) ?? []);
      setStatsLoaded(!overview.error);
      setAudit((events.data as AuditRow[] | null) ?? []);
      const u = user.data.user;
      setAuth(
        u
          ? {
              lastSignInAt: u.last_sign_in_at ?? null,
              emailConfirmed: Boolean(u.email_confirmed_at),
              provider: (u.app_metadata?.provider as string | undefined) ?? "email",
              mfaEnabled: ((u.factors ?? []) as Array<{ status?: string }>).some(
                (f) => f.status === "verified",
              ),
            }
          : null,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const preferences = useMemo(
    () => parsePreferences(profile?.preferences ?? null),
    [profile?.preferences],
  );

  useEffect(() => {
    applyAppearance(preferences.appearance);
  }, [preferences.appearance]);

  const snapshot = useMemo(() => platformSnapshot(rows), [rows]);
  const health = systemHealth(snapshot, statsLoaded);
  const completion = profileCompletion({
    fullName: profile?.full_name,
    handle: profile?.handle,
    email: profile?.email,
    phone: profile?.phone,
    bio: profile?.bio,
    avatarPath: profile?.avatar_path,
  });
  const ecosystemName = useMemo(() => {
    const map = new Map(rows.map((r) => [r.id, r.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "A shop") : "Platform");
  }, [rows]);

  const securityEvents = audit.filter((e) => isSecurityEvent(e.action)).slice(0, 4);
  const device = describeDevice(typeof navigator === "undefined" ? "" : navigator.userAgent);

  const savePreference = async (patch: Partial<MemberPreferences>) => {
    if (!profile) return;
    const next = { ...preferences, ...patch };
    const diff = preferencesPatch(next, preferences);
    if (!diff) return;
    setSavingPrefs(true);
    // Optimistic: the control reflects the choice immediately, then reloads.
    setProfile({ ...profile, preferences: { ...preferences, ...diff } as MyProfile["preferences"] });
    if (diff.appearance) applyAppearance(diff.appearance);
    try {
      await updateOwnProfile({ preferences: diff });
      toast.success("Preferences saved");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
      await load();
    } finally {
      setSavingPrefs(false);
    }
  };

  const signOutEverywhere = async () => {
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      /* fall through to the local sign out below */
    }
    void signOut();
  };

  if (loading && !profile) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (actingAs) {
    return (
      <PageSection title="Profile" description={`You are acting as ${actingAs.session.targetName}.`}>
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="text-sm font-medium">
              Profile editing is unavailable while acting as a member.
            </p>
            <p className="text-sm text-muted-foreground">
              Exit the account to return to your own platform owner profile.
            </p>
          </CardContent>
        </Card>
      </PageSection>
    );
  }

  const name = profile?.full_name ?? account?.name ?? "Platform owner";
  const handle = displayHandle(profile?.handle);

  return (
    <div className="space-y-6 pb-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/super">Platform console</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>My profile</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* ---------------------------------------------------------- Hero */}
      <Card className="overflow-hidden border-border/70 p-0 shadow-[var(--shadow-card)]">
        <div className="relative h-28 bg-[linear-gradient(120deg,var(--color-primary)_0%,oklch(0.55_0.14_205)_55%,var(--color-success)_100%)] sm:h-32">
          {/* Abstract WaveWallet network motif, drawn with CSS only. */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-40 [background:radial-gradient(closest-side,rgba(255,255,255,0.55),transparent_70%)_-40px_-30px/220px_220px_no-repeat,radial-gradient(closest-side,rgba(255,255,255,0.3),transparent_70%)_75%_120%/260px_260px_no-repeat]"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-16 opacity-30 [mask-image:linear-gradient(to_top,black,transparent)] [background:repeating-linear-gradient(115deg,rgba(255,255,255,0.35)_0_1px,transparent_1px_16px)]"
          />
        </div>
        <CardContent className="-mt-12 space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="relative">
                <div className="rounded-full bg-background p-1 shadow-[var(--shadow-float)] ring-2 ring-primary/25">
                  <MemberAvatar
                    path={profile?.avatar_path ?? null}
                    name={name}
                    className="size-20 text-xl sm:size-24 sm:text-2xl"
                  />
                </div>
                <span
                  className="absolute bottom-1.5 right-1.5 block size-4 rounded-full border-2 border-background bg-success"
                  title="Signed in"
                >
                  <span className="sr-only">Signed in and active</span>
                </span>
              </div>
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
                <p className="truncate text-sm text-muted-foreground">
                  {handle ?? "No username set"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="h-11 min-w-11" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit profile
              </Button>
              <Button variant="outline" className="h-11 min-w-11" asChild>
                <a href="#security-center">
                  <ShieldCheck className="size-4" /> Security
                </a>
              </Button>
              <Button variant="outline" className="h-11 min-w-11" asChild>
                <Link to="/super/audit">
                  <ScrollText className="size-4" /> Activity log
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="brand">
              <ShieldCheck className="mr-1 size-3" /> Super Administrator
            </StatusBadge>
            <StatusBadge tone="success">
              <BadgeCheck className="mr-1 size-3" /> Platform Owner
            </StatusBadge>
            <StatusBadge tone="muted">
              <Clock className="mr-1 size-3" />
              Member since {profile?.joined_at ? shortDate(profile.joined_at) : "—"}
            </StatusBadge>
          </div>

          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {profile?.bio?.trim() ||
              "No bio yet — add a short professional description so admins know who runs the platform."}
          </p>

          {completion.percent < 100 ? (
            <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium">Profile completion</p>
                <p className="text-xs font-semibold text-primary">{completion.percent}%</p>
              </div>
              <Progress value={completion.percent} className="mt-2 h-1.5" />
              <p className="mt-2 text-xs text-muted-foreground">
                Still to add: {completion.missing.join(", ")}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ------------------------------------------------- Platform cards */}
      <PageSection
        title="Platform overview"
        description="Live counters across every tenant. Archived shops are excluded."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <LinkStat
            label="Total shops"
            value={statsLoaded ? String(snapshot.ecosystems) : "—"}
            hint={`${snapshot.archived} archived`}
            icon={Building2}
            tone="brand"
            to="/super/admins"
          />
          <LinkStat
            label="Active admins"
            value={statsLoaded ? String(snapshot.admins) : "—"}
            hint="One owner per shop"
            icon={UserCheck}
            tone="brand"
            to="/super/admins"
          />
          <LinkStat
            label="Total resellers"
            value={statsLoaded ? String(snapshot.resellers) : "—"}
            hint="Resellers and subresellers"
            icon={Users}
          />
          <LinkStat
            label="Total users"
            value={statsLoaded ? String(snapshot.users) : "—"}
            hint="Customer accounts"
            icon={Users}
          />
          <LinkStat
            label="System health"
            value={health.label}
            hint={health.detail}
            icon={Activity}
            tone={
              health.tone === "success"
                ? "positive"
                : health.tone === "danger"
                  ? "negative"
                  : "neutral"
            }
          />
        </div>
      </PageSection>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ At a glance */}
        <PageSection
          title="Super Admin at a glance"
          description="Your access level and current session."
          className="mb-0"
        >
          <Card className="h-full shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <Fact icon={ShieldCheck} label="Access level" value="Platform-wide (all tenants)" tone="brand" />
              <Fact
                icon={Sparkles}
                label="Permissions"
                value="Full administrative access, including every Admin capability inside any shop"
              />
              <Fact
                icon={BadgeCheck}
                label="Account status"
                value={account?.status === "suspended" ? "Suspended" : "Active"}
                tone={account?.status === "suspended" ? "danger" : "success"}
              />
              <Fact
                icon={Clock}
                label="Last sign in"
                value={auth?.lastSignInAt ? shortDateTime(auth.lastSignInAt) : "Not recorded"}
              />
              <Fact icon={Monitor} label="Current session" value={device} />
              <Fact
                icon={KeyRound}
                label="Security"
                value={
                  auth?.emailConfirmed
                    ? `Email verified · sign in with ${auth.provider}`
                    : "Email not verified"
                }
                tone={auth?.emailConfirmed ? "success" : "warning"}
              />
            </CardContent>
          </Card>
        </PageSection>

        {/* ------------------------------------------- Security centre */}
        <PageSection
          title="Security centre"
          description="What protects the platform owner account today."
          className="mb-0"
        >
          <Card id="security-center" className="h-full scroll-mt-20 shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <Fact
                icon={KeyRound}
                label="Password"
                value="Managed by the account owner — reset by email"
              />
              <Fact
                icon={Fingerprint}
                label="Two-factor authentication"
                value={auth?.mfaEnabled ? "Enabled" : "Not configured"}
                tone={auth?.mfaEnabled ? "success" : "warning"}
              />
              <Fact
                icon={Monitor}
                label="Active sessions"
                value={`This browser (${device}). Sign out everywhere below to revoke the rest.`}
              />
              <div>
                <p className="text-xs font-medium text-muted-foreground">Recent security events</p>
                {securityEvents.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    No security-related actions recorded.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {securityEvents.map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">{e.action}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {shortDateTime(e.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="outline" className="h-11 w-full" asChild>
                <Link to="/super/operator-log">
                  <ShieldCheck className="size-4" /> Review security
                </Link>
              </Button>
            </CardContent>
          </Card>
        </PageSection>
      </div>

      {/* ------------------------------------------------------ Activity */}
      <PageSection
        title="Recent activity"
        description="Your own recorded actions across the platform."
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/super/audit">View all</Link>
          </Button>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-0">
            {audit.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No activity recorded yet"
                  description="Approvals, shop access and platform changes you make will appear here."
                />
              </div>
            ) : (
              <ol className="divide-y divide-border">
                {audit.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                        isSecurityEvent(e.action)
                          ? "bg-brand-soft text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {isSecurityEvent(e.action) ? (
                        <ShieldCheck className="size-4" />
                      ) : (
                        <Activity className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.action}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {ecosystemName(e.ecosystem_id)}
                        {e.target ? ` · ${e.target}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </PageSection>

      {/* ---------------------------------------------------- Privileges */}
      <PageSection
        title="Platform privileges"
        description="Capabilities granted to the platform owner. Every use is audited."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRIVILEGES.map((p) => {
            const body = (
              <Card
                className={cn(
                  "h-full shadow-[var(--shadow-card)] transition-all",
                  p.to && "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-float)]",
                )}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary">
                    <p.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground">{p.hint}</p>
                    <StatusBadge tone="success" className="mt-2 text-[10px]">
                      Full access
                    </StatusBadge>
                  </div>
                </CardContent>
              </Card>
            );
            return p.to ? (
              <Link
                key={p.label}
                to={p.to}
                className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {body}
              </Link>
            ) : (
              <div key={p.label}>{body}</div>
            );
          })}
        </div>
      </PageSection>

      {/* --------------------------------------------------- Preferences */}
      <PageSection
        title="Account preferences"
        description="Saved to your profile, so they follow you to any device."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-primary" /> Regional and interface
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pref-timezone">Timezone</Label>
                <Select
                  value={preferences.timezone}
                  onValueChange={(v) => void savePreference({ timezone: v })}
                  disabled={savingPrefs}
                >
                  <SelectTrigger id="pref-timezone" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pref-language">Language</Label>
                <Select
                  value={preferences.language}
                  onValueChange={(v) => void savePreference({ language: v })}
                  disabled={savingPrefs}
                >
                  <SelectTrigger id="pref-language" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pref-appearance">Appearance</Label>
                <Select
                  value={preferences.appearance}
                  onValueChange={(v) => void savePreference({ appearance: v as AppearanceMode })}
                  disabled={savingPrefs}
                >
                  <SelectTrigger id="pref-appearance" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">Match device</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              {(
                [
                  ["compact", "Compact interface", "Tighter spacing in dense tables and lists"],
                  ["notifySubscriptions", "Subscription requests", "Payment proofs awaiting review"],
                  ["notifyApplications", "Membership applications", "New accounts awaiting approval"],
                  ["notifySecurity", "Security events", "Account access and role changes"],
                ] as const
              ).map(([key, label, hint]) => (
                <div key={key} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label htmlFor={`toggle-${key}`} className="text-sm font-normal">
                      {label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <Switch
                    id={`toggle-${key}`}
                    checked={preferences[key]}
                    disabled={savingPrefs}
                    onCheckedChange={(v) => void savePreference({ [key]: v })}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </PageSection>

      {/* --------------------------------------------------- Danger zone */}
      <PageSection title="Danger zone" description="Actions that affect access to your account.">
        <Card className="border-destructive/30 shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">Sign out of all sessions</p>
                <p className="text-xs text-muted-foreground">
                  Revokes every signed-in device, including this one. Platform data is untouched.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="h-11 shrink-0">
                    <LogOut className="size-4" /> Sign out everywhere
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out of all sessions?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every device signed in as {name} will be signed out immediately, including
                      this one. You will need to sign in again. No platform data is changed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void signOutEverywhere()}>
                      Sign out everywhere
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-destructive">Deactivate account</p>
                <p className="text-xs text-muted-foreground">
                  Suspends platform owner sign-in. Shops, wallets and ledgers are always
                  retained — nothing is deleted.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="h-11 shrink-0 text-destructive">
                    <ShieldAlert className="size-4" /> Deactivate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Deactivation is blocked</AlertDialogTitle>
                    <AlertDialogDescription>
                      The platform owner account cannot deactivate itself while it is the only
                      account with platform-wide access — doing so would lock every shop out of
                      subscription review and support. Promote a second platform owner first. No
                      shop, wallet or ledger data is ever deleted by deactivation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Close</AlertDialogCancel>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      {profile ? (
        <SuperProfileEditDialog
          open={editing}
          onOpenChange={setEditing}
          profile={profile}
          ecosystemId={ecosystemDbId}
          preferences={preferences}
          onSaved={async () => {
            await load();
            reload();
          }}
        />
      ) : null}

    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "brand"
      ? "text-primary"
      : tone === "success"
        ? "text-success"
        : tone === "danger"
          ? "text-destructive"
          : tone === "warning"
            ? "text-warning-foreground"
            : "text-foreground";
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className={cn("size-4", toneClass)} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("text-sm font-medium", toneClass)}>{value}</p>
      </div>
    </div>
  );
}

function LinkStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "neutral" | "brand" | "positive" | "negative";
  to?: "/super/admins";
}) {
  const toneClass =
    tone === "brand"
      ? "text-primary"
      : tone === "positive"
        ? "text-success"
        : tone === "negative"
          ? "text-destructive"
          : "text-foreground";
  const card = (
    <Card
      className={cn(
        "h-full gap-0 py-4 shadow-[var(--shadow-card)] transition-all",
        to && "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-float)]",
      )}
    >
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <Icon className={cn("size-4", toneClass)} />
        </div>
        <p className={cn("mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl", toneClass)}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link
      to={to}
      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {card}
    </Link>
  ) : (
    card
  );
}
