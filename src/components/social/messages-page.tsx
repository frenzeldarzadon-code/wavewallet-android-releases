import { ArrowLeft, Flag, ImagePlus, Loader2, Send, ShieldOff, UserPlus, X } from "lucide-react";
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
import { EmptyState, PageSection } from "@/components/ui-kit";
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
  setBlocked,
  socialImageUrl,
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

export function MessagesPage() {
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
  const bottom = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await fetchThreads());
    } catch (e) {
      toast.error("Could not load messages", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const openThreadView = async (thread: DmThread) => {
    setActive(thread);
    try {
      setMessages(await fetchMessages(thread.thread_id));
      await loadThreads();
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));
    } catch (e) {
      toast.error("Could not open that conversation", { description: (e as Error).message });
    }
  };

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
      await sendMessage(active.member_id, body, imagePath);
      setBody("");
      setFile(null);
      setCrop(null);
      setMessages(await fetchMessages(active.thread_id));
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
    const existing = threads.find((t) => t.member_id === memberId);
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
    });
    setMessages([]);
  };

  const toggleBlock = async () => {
    if (!active) return;
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
    if (!active) return;
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
    return (
      <div className="flex min-h-[70vh] flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setActive(null)}>
            <ArrowLeft className="size-4" />
          </Button>
          <MemberAvatar path={active.member_avatar} name={active.member_name} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{active.member_name}</p>
            {active.member_handle ? (
              <p className="truncate text-xs text-muted-foreground">
                {displayHandle(active.member_handle)}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setReportOpen(true)}>
            <Flag className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-10" onClick={() => void toggleBlock()}>
            <ShieldOff className={active.blocked ? "size-4 text-destructive" : "size-4"} />
          </Button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-muted/40 p-3">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages yet — say hello.
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
      <PageSection devSlot="messages-page.messages"
        title="Messages"
        description="Private one-to-one conversations with members of your shop. Messages are free."
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
                <MemberAvatar path={t.member_avatar} name={t.member_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{t.member_name}</span>
                    {t.last_message_at ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {relativeTime(t.last_message_at)}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.preview ?? "No messages yet"}
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
