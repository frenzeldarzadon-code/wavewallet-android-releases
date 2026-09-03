import {
  ArrowLeft,
  Flag,
  ImagePlus,
  Loader2,
  Package,
  Send,
  ShieldOff,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { MemberPicker } from "@/components/member-picker";
import { ImageCropper } from "@/components/image-cropper";
import { displayHandle } from "@/lib/profile";
import { useSession } from "@/lib/session";
import type { CropRect } from "@/lib/image-optimize";
import {
  SOCIAL_IMAGE_ASPECT,
  fetchMessages,
  fetchThreads,
  relativeTime,
  reportContent,
  sendMessage,
  sendThreadMessage,
  setBlocked,
  socialImageUrl,
  threadTitle,
  uploadSocialImage,
  validateMessageBody,
  validateSocialImage,
  type DmMessage,
  type DmThread,
} from "@/lib/social";

/** Signed-url image inside a chat bubble. */
function MessageImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void socialImageUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <div className="mb-1 aspect-4/3 w-48 animate-pulse rounded-xl bg-muted" />;
  return (
    <img
      src={url}
      alt="Attachment"
      loading="lazy"
      className="mb-1 aspect-4/3 w-48 rounded-xl object-cover"
    />
  );
}

const roleLabel: Record<string, string> = {
  customer: "Customer",
  seller: "Seller",
  delivery: "Delivery",
  collector: "Collector",
};

/**
 * Messages: private one-to-one threads plus Retail order-linked group chats
 * (customer + seller + delivery person + collector when assigned). Both reuse
 * the same infrastructure; the database decides who may read or post.
 *
 * `initialThreadId` (from `/universe/messages?thread=…`) opens that thread
 * directly — the way order and delivery details deep-link into the chat.
 */
export function MessagesPage({ initialThreadId }: { initialThreadId?: string | null } = {}) {
  const session = useSession();
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<DmThread | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<{ image: HTMLImageElement; crop: CropRect } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [openedInitial, setOpenedInitial] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const list = await fetchThreads();
      setThreads(list);
      return list;
    } catch (e) {
      toast.error("Could not load messages", { description: (e as Error).message });
      return [] as DmThread[];
    } finally {
      setLoading(false);
    }
  }, []);

  const openThreadView = useCallback(
    async (thread: DmThread) => {
      setActive(thread);
      try {
        setMessages(await fetchMessages(thread.thread_id));
        await loadThreads();
        requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));
      } catch (e) {
        toast.error("Could not open that conversation", { description: (e as Error).message });
      }
    },
    [loadThreads],
  );

  useEffect(() => {
    void (async () => {
      const list = await loadThreads();
      if (initialThreadId && !openedInitial) {
        setOpenedInitial(true);
        const t = list.find((x) => x.thread_id === initialThreadId);
        if (t) await openThreadView(t);
        else toast.error("That conversation is not available to you");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreads, initialThreadId]);

  useEffect(() => {
    const touch = () => {
      void supabase.rpc("touch_member_presence");
    };
    touch();
    const timer = window.setInterval(touch, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const pickFile = (f: File | null) => {
    if (!f) {
      setFile(null);
      setCrop(null);
      return;
    }
    const problem = validateSocialImage(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(f);
  };

  const send = async () => {
    if (!active) return;
    const hasImage = Boolean(file && crop);
    const problem = hasImage && !body.trim() ? null : validateMessageBody(body);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSending(true);
    try {
      let imagePath: string | null = null;
      if (file && crop && session.ecosystemDbId && session.account) {
        imagePath = await uploadSocialImage({
          ecosystemId: session.ecosystemDbId,
          userId: session.account.id,
          file,
          crop: crop.crop,
          preloaded: crop.image,
        });
      }
      const res =
        active.kind === "order"
          ? await sendThreadMessage(active.thread_id, body, imagePath)
          : await sendMessage(active.member_id ?? "", body, imagePath);
      setBody("");
      setFile(null);
      setCrop(null);
      const tid = active.thread_id || res.thread_id;
      if (!active.thread_id) setActive({ ...active, thread_id: tid });
      setMessages(await fetchMessages(tid));
      await loadThreads();
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));
    } catch (e) {
      toast.error("Could not send", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const startWith = async (memberId: string, name: string) => {
    setNewOpen(false);
    const existing = threads.find((t) => t.kind === "direct" && t.member_id === memberId);
    if (existing) {
      await openThreadView(existing);
      return;
    }
    setActive({
      thread_id: "",
      member_id: memberId,
      member_name: name,
      member_handle: null,
      member_avatar: null,
      last_message_at: null,
      preview: null,
      unread: 0,
      blocked: false,
      member_online: false,
      kind: "direct",
      order_id: null,
      title: null,
      participants: [],
    });
    setMessages([]);
  };

  const toggleBlock = async () => {
    if (!active || !active.member_id) return;
    try {
      await setBlocked(active.member_id, !active.blocked);
      toast.success(active.blocked ? "Unblocked" : "Blocked");
      setActive({ ...active, blocked: !active.blocked });
      await loadThreads();
    } catch (e) {
      toast.error("Could not update block", { description: (e as Error).message });
    }
  };

  const submitReport = async () => {
    if (!active || !active.member_id) return;
    try {
      await reportContent("member", active.member_id, reportReason);
      setReportOpen(false);
      setReportReason("");
      toast.success("Reported", { description: "Your shop admin will review this." });
    } catch (e) {
      toast.error("Could not report", { description: (e as Error).message });
    }
  };

  if (!session.account) return null;

  if (active) {
    const isOrder = active.kind === "order";
    return (
      <div className="flex min-h-[70vh] flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setActive(null)}>
            <ArrowLeft className="size-4" />
          </Button>
          {isOrder ? (
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand-soft text-primary">
              <Package className="size-4" />
            </span>
          ) : (
            <MemberAvatar
              path={active.member_avatar}
              name={active.member_name ?? "Member"}
              className="size-9"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{threadTitle(active)}</p>
            {isOrder ? (
              <p className="truncate text-xs text-muted-foreground">
                {active.participants
                  .map((p) => `${p.name} (${roleLabel[p.role] ?? p.role})`)
                  .join(" · ")}
              </p>
            ) : active.member_handle ? (
              <p className="truncate text-xs text-muted-foreground">
                {displayHandle(active.member_handle)} ·{" "}
                {active.member_online ? "Online" : "Offline"}
              </p>
            ) : null}
          </div>
          {!isOrder ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                onClick={() => setReportOpen(true)}
              >
                <Flag className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-10" onClick={() => void toggleBlock()}>
                <ShieldOff className={active.blocked ? "size-4 text-destructive" : "size-4"} />
              </Button>
            </>
          ) : null}
        </div>

        {isOrder ? (
          <div className="flex flex-wrap gap-1">
            {active.participants.map((p) => (
              <StatusBadge key={p.id} tone={p.role === "seller" ? "brand" : "muted"}>
                {roleLabel[p.role] ?? p.role}: {p.name}
              </StatusBadge>
            ))}
          </div>
        ) : null}

        <div className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-muted/40 p-3">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {isOrder
                ? "No messages yet — coordinate the delivery here."
                : "No messages yet — say hello."}
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={m.mine ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.mine
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "max-w-[80%] rounded-2xl rounded-bl-sm bg-card px-3 py-2 text-sm shadow-[var(--shadow-card)]"
                  }
                >
                  {isOrder && !m.mine && m.sender_name ? (
                    <p className="mb-0.5 text-[10px] font-semibold text-muted-foreground">
                      {m.sender_name}
                    </p>
                  ) : null}
                  {m.image_path ? <MessageImage path={m.image_path} /> : null}
                  {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                  <p className="mt-1 text-[10px] opacity-70">{relativeTime(m.created_at)}</p>
                </div>
              </div>
            ))
          )}
          <div ref={bottom} />
        </div>

        {active.blocked ? (
          <p className="text-center text-sm text-destructive">
            You blocked this member. Unblock to continue the conversation.
          </p>
        ) : (
          <div className="space-y-2">
            {file ? (
              <div className="space-y-2">
                <ImageCropper file={file} aspect={SOCIAL_IMAGE_ASPECT} onChange={setCrop} />
                <Button variant="ghost" size="sm" onClick={() => pickFile(null)}>
                  <X className="size-4" /> Remove photo
                </Button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <Label
                htmlFor="dmPhoto"
                className="inline-flex h-11 cursor-pointer items-center rounded-xl border border-border px-3"
              >
                <ImagePlus className="size-4" />
                <span className="sr-only">Attach a photo</span>
              </Label>
              <Input
                id="dmPhoto"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <Textarea
                rows={1}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Message…"
                className="min-h-11 text-base"
              />
              <Button
                className="h-11"
                disabled={(!body.trim() && !crop) || sending}
                onClick={() => void send()}
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
          </div>
        )}

        <Dialog open={reportOpen} onOpenChange={setReportOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Report {active.member_name}</DialogTitle>
              <DialogDescription>Your shop admin will review this privately.</DialogDescription>
            </DialogHeader>
            <Textarea
              rows={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="What happened?"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setReportOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void submitReport()}>
                Send report
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <>
      <PageSection
        devSlot="messages-page.messages"
        title="Messages"
        description="Private conversations and Retail order chats. Messages are free."
      >
        <Button className="h-11" onClick={() => setNewOpen(true)}>
          <UserPlus className="size-4" /> New message
        </Button>
      </PageSection>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading conversations…</p>
      ) : threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Start a chat from a member's post or with New message."
        />
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Card
              key={t.thread_id}
              className="cursor-pointer shadow-[var(--shadow-card)]"
              onClick={() => void openThreadView(t)}
            >
              <CardContent className="flex items-center gap-3 py-3">
                {t.kind === "order" ? (
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary">
                    <Users className="size-4" />
                  </span>
                ) : (
                  <span className="relative">
                    <MemberAvatar path={t.member_avatar} name={t.member_name ?? "Member"} />
                    {t.member_online ? (
                      <span
                        aria-label="Online"
                        className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-card bg-success"
                      />
                    ) : null}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{threadTitle(t)}</span>
                    {t.kind === "order" ? (
                      <StatusBadge tone="brand">Order chat</StatusBadge>
                    ) : t.member_online ? (
                      <span className="text-[11px] font-medium text-success">Online</span>
                    ) : null}
                    {t.last_message_at ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {relativeTime(t.last_message_at)}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.preview ??
                      (t.kind === "order"
                        ? t.participants.map((p) => p.name).join(", ")
                        : "No messages yet")}
                  </p>
                </div>
                {t.unread > 0 ? (
                  <span className="ml-1 inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {t.unread}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              Search members of your shop by name or @handle. Contact details stay private.
            </DialogDescription>
          </DialogHeader>
          <MemberPicker
            onSelect={(m) => {
              void startWith(m.id, m.full_name);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
