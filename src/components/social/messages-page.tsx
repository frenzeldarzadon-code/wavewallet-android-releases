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
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { OrderWorkspacePanel } from "@/components/social/order-workspace-panel";
import { PeopleSheet } from "@/components/universe/people-sheet";
import { cn } from "@/lib/utils";
import { displayHandle } from "@/lib/profile";
import { useSession } from "@/lib/session";
import {
  createGroupChat,
  fetchMessages,
  fetchOrderChatContext,
  fetchThreads,
  filterThreads,
  orderChatLabel,
  relativeTime,
  reportContent,
  sendMessage,
  sendThreadMessage,
  setBlocked,
  socialImageUrl,
  threadTitle,
  uploadChatImage,
  validateMessageBody,
  validateSocialImage,
  type DmMessage,
  type DmThread,
  type OrderChatContext,
  type ThreadFilter,
} from "@/lib/social";

/**
 * Signed-url photo inside a chat bubble. The complete picture is always shown:
 * it is scaled proportionally to fit the bubble width and never cropped, so a
 * portrait stays portrait and a landscape stays landscape. Tapping it opens the
 * same photo full screen, still uncropped.
 */
function MessageImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void socialImageUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <div className="mb-1 h-32 w-48 animate-pulse rounded-xl bg-muted" />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mb-1 block">
        <img
          src={url}
          alt="Attachment"
          loading="lazy"
          className="max-h-72 w-auto max-w-full rounded-xl object-contain"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[96vw] p-2 sm:max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Photo</DialogTitle>
            <DialogDescription>Full picture</DialogDescription>
          </DialogHeader>
          <img
            src={url}
            alt="Attachment"
            className="max-h-[80vh] w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
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
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupPicks, setGroupPicks] = useState<Array<{ id: string; name: string }>>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [orderCtx, setOrderCtx] = useState<Map<string, OrderChatContext>>(new Map());
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [openedInitial, setOpenedInitial] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const list = await fetchThreads();
      setThreads(list);
      // Order number / status / shop for order chats — the database only
      // answers for threads the caller actually belongs to.
      const orderIds = list.filter((t) => t.kind === "order").map((t) => t.thread_id);
      if (orderIds.length > 0) {
        void fetchOrderChatContext(orderIds)
          .then(setOrderCtx)
          .catch(() => undefined);
      }
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

  // Presence heartbeat lives app-wide in __root (src/lib/presence.ts).

  const pickFile = (f: File | null) => {
    setUploadFailed(false);
    setFilePreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    if (!f) {
      setFile(null);
      return;
    }
    const problem = validateSocialImage(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
  };

  const send = async () => {
    if (!active) return;
    const hasImage = Boolean(file);
    const problem = hasImage && !body.trim() ? null : validateMessageBody(body);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSending(true);
    setUploadFailed(false);
    try {
      let imagePath: string | null = null;
      if (file && session.account) {
        imagePath = await uploadChatImage({
          ecosystemId: session.ecosystemDbId,
          userId: session.account.id,
          file,
        });
      }
      const res =
        active.kind === "direct"
          ? await sendMessage(active.member_id ?? "", body, imagePath)
          : await sendThreadMessage(active.thread_id, body, imagePath);
      setBody("");
      pickFile(null);
      const tid = active.thread_id || res.thread_id;
      if (!active.thread_id) setActive({ ...active, thread_id: tid });
      setMessages(await fetchMessages(tid));
      await loadThreads();
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));
    } catch (e) {
      if (file) setUploadFailed(true);
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
    const isGroup = active.kind === "group";
    // Order chats and member groups share the same multi-party presentation.
    const isMulti = isOrder || isGroup;
    return (
      <div className="flex min-h-[70vh] flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setActive(null)}>
            <ArrowLeft className="size-4" />
          </Button>
          {isMulti ? (
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand-soft text-primary">
              {isOrder ? <Package className="size-4" /> : <Users className="size-4" />}
            </span>
          ) : (
            <MemberAvatar
              path={active.member_avatar}
              name={active.member_name ?? "Member"}
              className="size-9"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {isOrder
                ? orderChatLabel(active, orderCtx.get(active.thread_id))
                : threadTitle(active)}
            </p>
            {isGroup ? (
              <p className="truncate text-xs text-muted-foreground">
                {active.participants.length} members · group chat
              </p>
            ) : isOrder ? (
              <p className="truncate text-xs text-muted-foreground">
                {orderCtx.get(active.thread_id)?.shop_name
                  ? "Order chat · everyone on this order can read this"
                  : active.participants
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
          {!isMulti ? (
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

        {isOrder ? <OrderWorkspacePanel key={active.thread_id} threadId={active.thread_id} /> : null}

        {isMulti ? (
          <div className="flex flex-wrap gap-1">
            {active.participants.map((p) => (
              <StatusBadge key={p.id} tone={p.role === "seller" || p.role === "owner" ? "brand" : "muted"}>
                {isGroup ? p.name : `${roleLabel[p.role] ?? p.role}: ${p.name}`}
              </StatusBadge>
            ))}
          </div>
        ) : null}

        <div className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-muted/40 p-3">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {isOrder
                ? "No messages yet — coordinate the delivery here."
                : isGroup
                  ? "No messages yet — say hello to the group."
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
                  {isMulti && !m.mine && m.sender_name ? (
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
            {file && filePreview ? (
              <div className="space-y-2 rounded-xl border border-border p-2">
                <img
                  src={filePreview}
                  alt="Selected photo"
                  className="max-h-56 w-auto max-w-full rounded-lg object-contain"
                />
                {sending ? (
                  <p className="text-xs text-muted-foreground">Uploading photo…</p>
                ) : uploadFailed ? (
                  <p className="text-xs text-destructive">
                    That photo did not upload. Tap send to try again, or remove it.
                  </p>
                ) : null}
                <Button variant="ghost" size="sm" disabled={sending} onClick={() => pickFile(null)}>
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
                disabled={(!body.trim() && !file) || sending}
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

  const visible = filterThreads(threads, filter);
  const orderCount = threads.filter((t) => t.kind === "order").length;
  const filters: Array<{ id: ThreadFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "direct", label: "Private" },
    { id: "order", label: orderCount ? `Orders · ${orderCount}` : "Orders" },
  ];

  return (
    <>
      <PageSection
        devSlot="messages-page.messages"
        title="Messages"
        description="Private conversations and Retail order chats. Messages are free."
      >
        <div className="flex gap-2">
          <Button variant="outline" className="h-11" onClick={() => setPeopleOpen(true)}>
            <Wifi className="size-4" /> Online
          </Button>
          <Button className="h-11" onClick={() => setNewOpen(true)}>
            <UserPlus className="size-4" /> New message
          </Button>
        </div>
      </PageSection>

      <div
        role="tablist"
        aria-label="Filter conversations"
        className="flex gap-1 rounded-xl bg-muted p-1"
      >
        {filters.map((f) => (
          <button
            key={f.id}
            role="tab"
            type="button"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-9 flex-1 rounded-lg text-sm font-medium transition-colors",
              filter === f.id
                ? "bg-card text-foreground shadow-[var(--shadow-card)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading conversations…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            filter === "order"
              ? "No order chats"
              : filter === "direct"
                ? "No private chats yet"
                : "No conversations yet"
          }
          description={
            filter === "order"
              ? "An order chat appears here automatically after you place or receive a Retail order."
              : "Start a chat from a member's post, from Online, or with New message."
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((t) => {
            const ctx = t.kind === "order" ? orderCtx.get(t.thread_id) : undefined;
            return (
              <Card
                key={t.thread_id}
                className="cursor-pointer shadow-[var(--shadow-card)]"
                onClick={() => void openThreadView(t)}
              >
                <CardContent className="flex items-center gap-3 py-3">
                  {t.kind === "order" ? (
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary">
                      <Package className="size-4" />
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
                      <span className="truncate text-sm font-semibold">
                        {t.kind === "order" ? orderChatLabel(t, ctx) : threadTitle(t)}
                      </span>
                      {t.kind === "order" ? (
                        <StatusBadge tone="brand">Order</StatusBadge>
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
                          ? t.participants
                              .map((p) => `${p.name} (${roleLabel[p.role] ?? p.role})`)
                              .join(", ")
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
            );
          })}
        </div>
      )}

      <PeopleSheet
        open={peopleOpen}
        onOpenChange={setPeopleOpen}
        title="Online now"
        description="Members online or recently active, from the same presence signal shown on posts. Tap to chat."
        onSelect={(p) => {
          setPeopleOpen(false);
          void startWith(p.id, p.full_name);
        }}
      />

      <PeopleSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        title="New message"
        description="Who is online right now, then recently active. Search anyone in the Universe by name or @handle — no shop needed."
        onSelect={(p) => void startWith(p.id, p.full_name)}
      />
    </>
  );
}
