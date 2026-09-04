import { describe, expect, it } from "vitest";
import { filterThreads, orderChatLabel, type DmThread, type OrderChatContext } from "./social";

const base = (over: Partial<DmThread>): DmThread => ({
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
  kind: "order",
  order_id: "o1",
  title: "Order chat",
  participants: [],
  ...over,
});

const ctx: OrderChatContext = {
  thread_id: "t1",
  order_no: "#1042",
  status: "confirmed",
  fulfillment_status: "out_for_delivery",
  shop_name: "Sari-Sari ni Aling Nena",
  shop_slug: "aling-nena",
};

describe("order chat helpers", () => {
  it("labels order chats with number, live state and shop", () => {
    expect(orderChatLabel(base({}), ctx)).toBe(
      "Order #1042 · Out for delivery · Sari-Sari ni Aling Nena",
    );
  });

  it("falls back to order status when there is no fulfillment yet", () => {
    expect(orderChatLabel(base({}), { ...ctx, fulfillment_status: "none" })).toBe(
      "Order #1042 · Confirmed · Sari-Sari ni Aling Nena",
    );
  });

  it("never invents context: without it the plain thread title is used", () => {
    expect(orderChatLabel(base({}), undefined)).toBe("Order chat");
  });

  it("filters by kind without dropping anything under All", () => {
    const list = [base({ thread_id: "a" }), base({ thread_id: "b", kind: "direct", member_id: "u" })];
    expect(filterThreads(list, "all")).toHaveLength(2);
    expect(filterThreads(list, "order").map((t) => t.thread_id)).toEqual(["a"]);
    expect(filterThreads(list, "direct").map((t) => t.thread_id)).toEqual(["b"]);
  });
});
