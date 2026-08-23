/**
 * Password input with a show/hide toggle, plus an optional live requirements
 * checklist. The toggle only reveals what the person typed in this browser —
 * a stored password is never read back from anywhere.
 */
import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_HINT } from "@/lib/password-policy";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  /** Shows the short "any password" hint under the field. */
  hint?: boolean;
  onEnter?: () => void;
}

export function PasswordField({
  label,
  value,
  onChange,
  id,
  placeholder,
  autoComplete,
  disabled,
  hint,
  onEnter,
}: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const [shown, setShown] = useState(false);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Input
          id={inputId}
          type={shown ? "text" : "password"}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "••••••••"}
          autoComplete={autoComplete}
          className="h-11 pr-11"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{PASSWORD_HINT}</p> : null}
    </div>
  );
}
