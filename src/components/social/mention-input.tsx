import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Textarea } from "@/components/ui/textarea";
import { MemberAvatar } from "@/components/member-avatar";
import { applyMention, mentionDraft, type MentionDraft } from "@/lib/mentions";
import { displayHandle } from "@/lib/profile";
import { searchHandles, type MentionSuggestion } from "@/lib/social";
import { cn } from "@/lib/utils";

/** Imperative helpers the composer toolbar uses (insert "@" / "#", focus). */
export interface MentionInputHandle {
  focus: () => void;
  /** Inserts text at the caret (adding a leading space when needed) and keeps focus. */
  insert: (text: string) => void;
}

/**
 * Textarea with @handle autocomplete. Suggestions come from the database, so
 * only real, unique handles can be inserted. Touch targets stay large enough
 * for phones.
 */
export function MentionInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  className,
  textareaClassName,
  id,
  autoFocus,
  onFocus,
  onKeyDown,
  handleRef,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
  textareaClassName?: string;
  id?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleRef?: Ref<MentionInputHandle>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<MentionDraft | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);

  useEffect(() => {
    if (!draft || draft.query.length < 1) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void searchHandles(draft.query).then((rows) => active && setSuggestions(rows));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft]);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => ref.current?.focus());
  }, [autoFocus]);

  const sync = (next: string, caret: number) => {
    onChange(maxLength ? next.slice(0, maxLength) : next);
    setDraft(mentionDraft(next, caret));
  };

  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => ref.current?.focus(),
      insert: (text: string) => {
        const el = ref.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? value.length;
        const before = value.slice(0, start);
        const needsSpace = before.length > 0 && !/\s$/.test(before);
        const inserted = (needsSpace ? " " : "") + text;
        const next = before + inserted + value.slice(end);
        const caret = start + inserted.length;
        sync(next, caret);
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(caret, caret);
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, maxLength],
  );

  const pick = (handle: string) => {
    if (!draft) return;
    const res = applyMention(value, draft, handle);
    onChange(maxLength ? res.text.slice(0, maxLength) : res.text);
    setDraft(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(res.caret, res.caret);
    });
  };

  return (
    <div className={cn("relative", className)}>
      <Textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onChange={(e) => sync(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyUp={(e) => {
          const el = e.currentTarget;
          setDraft(mentionDraft(el.value, el.selectionStart ?? el.value.length));
        }}
        onBlur={() => setTimeout(() => setDraft(null), 150)}
        className={cn("min-h-11", textareaClassName)}
      />
      {draft && suggestions.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {suggestions.map((s) => (
            <li key={s.user_id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s.handle)}
              >
                <MemberAvatar path={s.avatar_path} name={s.full_name} className="size-8" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.full_name}</span>
                  <span className="block truncate text-xs text-primary">
                    {displayHandle(s.handle)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
