/**
 * One password policy for the whole platform.
 *
 * The same rules apply to sign-up, self-service password change, the recovery
 * screen and the Super Admin "set a new password" action, so a password that
 * is accepted in one place is never rejected in another.
 *
 * Nothing here ever stores, transmits or logs a password — it only inspects
 * the string the person is typing, in their own browser.
 */

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (v) => v.length >= MIN_PASSWORD_LENGTH,
  },
  { id: "upper", label: "One uppercase letter (A–Z)", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "One lowercase letter (a–z)", test: (v) => /[a-z]/.test(v) },
  { id: "number", label: "One number (0–9)", test: (v) => /[0-9]/.test(v) },
  {
    id: "special",
    label: "One special character (!@#$…)",
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/** Which rules the candidate password already satisfies. */
export function passwordChecklist(value: string): { rule: PasswordRule; ok: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ rule, ok: rule.test(value) }));
}

export function isStrongPassword(value: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(value));
}

/**
 * A precise message naming everything that is still missing — never a vague
 * "incomplete password".
 */
export function passwordIssue(value: string): string | null {
  const missing = PASSWORD_RULES.filter((r) => !r.test(value)).map((r) => r.label.toLowerCase());
  if (missing.length === 0) return null;
  return `Your password still needs: ${missing.join(", ")}.`;
}

/** Validates a new password plus its confirmation. Returns null when valid. */
export function newPasswordIssue(password: string, confirm: string): string | null {
  const issue = passwordIssue(password);
  if (issue) return issue;
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}
