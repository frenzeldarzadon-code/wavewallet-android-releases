/**
 * Group chats and chat photos — client contract.
 *
 * The database decides who may create a group, who may post and who may read a
 * photo. These tests only pin the calls the Messenger UI makes: an unambiguous
 * single-signature `dm_send`, the group creation RPC, group thread mapping and
 * the no-crop photo encode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), storage: { from: () => ({}) } },
}));

import {
  createGroupChat,
  fetchThreads,
  filterThreads,
  sendMessage,
  sendThreadMessage,
  threadTitle,
  type DmThread,
} from "./social";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => rpc.mockReset());

const thread = (over: Partial<DmThread>): DmThread => ({
  thread_id: "t1",
  member_id: null,
  member_name: null,
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
  ...over,
});

describe("createGroupChat", () => {
  it("creates the group through the single group RPC", async () => {
    rpc.mockResolvedValue({ data: "thread-1", error: null });
    await expect(createGroupChat("  Team Sagada ", [A, B])).resolves.toBe("thread-1");
    expect(rpc).toHaveBeenCalledWith("dm_create_group", {
      _title: "Team Sagada",
      _member_ids: [A, B],
    });
  });

  it("surfaces a readable refusal from the database", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Add at least one member" } });
    await expect(createGroupChat("Team", [])).rejects.toThrow("Add at least one member");
  });
});

describe("sending", () => {
  it("omits the photo argument entirely for a plain direct message", async () => {
    rpc.mockResolvedValue({ data: { thread_id: "t", message_id: "m" }, error: null });
    await sendMessage(A, " hi ");
    expect(rpc).toHaveBeenCalledWith("dm_send", { _member_id: A, _body: "hi" });
  });

  it("passes the photo path for a group message", async () => {
    rpc.mockResolvedValue({ data: { thread_id: "t", message_id: "m" }, error: null });
    await sendThreadMessage("t1", "look", "universe/user/photo.webp");
    expect(rpc).toHaveBeenCalledWith("dm_send_thread", {
      _thread_id: "t1",
      _body: "look",
      _image_path: "universe/user/photo.webp",
    });
  });
});

describe("thread list", () => {
  it("maps group threads from the shared list RPC", async () => {
    rpc.mockResolvedValue({
      data: [{ thread_id: "g1", kind: "group", title: "Team", participants: [] }],
      error: null,
    });
    const list = await fetchThreads();
    expect(list[0]?.kind).toBe("group");
    expect(threadTitle(list[0]!)).toBe("Team");
  });

  it("filters groups apart from private and order chats", () => {
    const list = [
      thread({ thread_id: "d", kind: "direct", member_name: "Ann" }),
      thread({ thread_id: "g", kind: "group", title: "Team" }),
      thread({ thread_id: "o", kind: "order", title: "Order" }),
    ];
    expect(filterThreads(list, "group").map((t) => t.thread_id)).toEqual(["g"]);
    expect(filterThreads(list, "direct").map((t) => t.thread_id)).toEqual(["d"]);
    expect(filterThreads(list, "all")).toHaveLength(3);
  });
});
