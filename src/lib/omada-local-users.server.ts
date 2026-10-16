/**
 * Server-only Omada local-user calls, inside one shop's own site session.
 * Every request passes `assertSafeLocalUserRequest` first.
 */
import { omadaSiteCall, type OmadaSession } from "./omada-api.server";
import { assertSafeLocalUserRequest, LOCAL_USERS_PATH, type LocalUserRow } from "./omada-local-users";

const PAGE = 100;
const MAX_PAGES = 50;

export async function listAllLocalUsers(session: OmadaSession): Promise<LocalUserRow[]> {
  const out: LocalUserRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const path = `${LOCAL_USERS_PATH}?page=${page}&pageSize=${PAGE}`;
    assertSafeLocalUserRequest("GET", path);
    const result = (await omadaSiteCall<Record<string, unknown>>(session, path)) ?? {};
    const rows = Array.isArray(result["data"]) ? (result["data"] as LocalUserRow[]) : [];
    out.push(...rows);
    const total = Number(result["totalRows"] ?? rows.length);
    if (rows.length < PAGE || out.length >= total) break;
  }
  return out;
}

/** Fresh read of one user from the list (the list carries usage fields). */
export async function readLocalUser(session: OmadaSession, id: string): Promise<LocalUserRow> {
  const row = (await listAllLocalUsers(session)).find((r) => String(r["id"]) === id);
  if (!row) throw new Error("That local user no longer exists on Omada.");
  return row;
}

export async function createLocalUser(session: OmadaSession, body: LocalUserRow): Promise<void> {
  assertSafeLocalUserRequest("POST", LOCAL_USERS_PATH, body);
  await omadaSiteCall(session, LOCAL_USERS_PATH, { method: "POST", body: JSON.stringify(body) });
}

export async function updateLocalUser(
  session: OmadaSession,
  current: LocalUserRow,
  body: LocalUserRow,
): Promise<void> {
  const id = String(current["id"] ?? "");
  const path = `${LOCAL_USERS_PATH}/${encodeURIComponent(id)}`;
  assertSafeLocalUserRequest("POST", path, body, current);
  await omadaSiteCall(session, path, { method: "POST", body: JSON.stringify(body) });
}
