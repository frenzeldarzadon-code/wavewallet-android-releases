import { describe, expect, it } from "vitest";
import {
  BACKOFF_MAX_MS,
  HEALTHY_INTERVAL_MS,
  backoffDelayMs,
  nextHealthUpdate,
  offlineTooLong,
  type OmadaHealthOutcome,
} from "../omada-health.server";
import { omadaHttpFailure } from "../omada.server";

const outcome = (o: Partial<OmadaHealthOutcome>): OmadaHealthOutcome => ({
  state: "healthy",
  reason: null,
  siteId: null,
  token: null,
  reusedToken: false,
  ...o,
});

describe("omada health backoff", () => {
  it("identifies an HTTP 526 as a TLS certificate path failure", () => {
    expect(omadaHttpFailure(526, "HTTP 526")).toContain("TLS certificate validation failed");
    expect(omadaHttpFailure(401, "HTTP 401")).toBe("HTTP 401");
  });

  it("uses the calm interval while healthy", () => {
    expect(backoffDelayMs(0)).toBe(HEALTHY_INTERVAL_MS);
  });

  it("doubles per consecutive failure and is capped", () => {
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(3)).toBe(240_000);
    expect(backoffDelayMs(20)).toBe(BACKOFF_MAX_MS);
  });

  it("warns only after sustained downtime", () => {
    const now = Date.now();
    expect(offlineTooLong(null, now)).toBe(false);
    expect(offlineTooLong(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(offlineTooLong(new Date(now - 60 * 60_000).toISOString(), now)).toBe(true);
  });
});

describe("omada health state machine", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("records a failure and starts the offline clock", () => {
    const u = nextHealthUpdate(
      { health_state: "healthy", consecutive_failures: 0, offline_since: null },
      outcome({ state: "unreachable", reason: "Controller not reachable" }),
      now,
    );
    expect(u.health_state).toBe("unreachable");
    expect(u.consecutive_failures).toBe(1);
    expect(u.offline_since).toBe(now.toISOString());
    expect(u.last_failure_at).toBe(now.toISOString());
    expect(u.next_check_at).toBe(new Date(now.getTime() + 60_000).toISOString());
  });

  it("keeps the original offline_since across repeated failures", () => {
    const first = "2025-12-31T23:00:00.000Z";
    const u = nextHealthUpdate(
      { health_state: "unreachable", consecutive_failures: 3, offline_since: first },
      outcome({ state: "unreachable", reason: "still down" }),
      now,
    );
    expect(u.offline_since).toBe(first);
    expect(u.consecutive_failures).toBe(4);
  });

  it("marks recovery when a failing controller answers again", () => {
    const u = nextHealthUpdate(
      { health_state: "unreachable", consecutive_failures: 5, offline_since: "2025-12-31T23:00:00.000Z" },
      outcome({ state: "healthy", siteId: "site-1" }),
      now,
    );
    expect(u.health_state).toBe("healthy");
    expect(u.consecutive_failures).toBe(0);
    expect(u.offline_since).toBeNull();
    expect(u.last_recovered_at).toBe(now.toISOString());
    expect(u.site_id).toBe("site-1");
    expect(u.next_check_at).toBe(new Date(now.getTime() + HEALTHY_INTERVAL_MS).toISOString());
  });

  it("treats auth failure as a failure state without recovery marking", () => {
    const u = nextHealthUpdate(
      { health_state: "healthy", consecutive_failures: 0, offline_since: null },
      outcome({ state: "auth_failed", reason: "Authentication failed." }),
      now,
    );
    expect(u.last_status).toBe("failed");
    expect(u.last_recovered_at).toBeUndefined();
  });

  it("counts a reachable-but-site-missing controller as a success, not downtime", () => {
    const u = nextHealthUpdate(
      { health_state: "unknown", consecutive_failures: 2, offline_since: null },
      outcome({ state: "degraded", reason: "site not visible" }),
      now,
    );
    expect(u.consecutive_failures).toBe(0);
    expect(u.last_success_at).toBe(now.toISOString());
    expect(u.last_status).toBe("degraded");
  });
});
