/**
 * Emails the shop admin about a retail order.
 *
 * The email goes to the contact email configured on that shop — never to a
 * hard-coded address. When the shop has no email, or the platform has no email
 * provider configured yet, this returns a clear reason instead of failing
 * silently so the console can show a setup notice.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NotifyResult {
  sent: boolean;
  reason: string;
}

export const notifyRetailOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = (input?.orderId ?? "").trim();
    if (!orderId) throw new Error("An order id is required.");
    return { orderId };
  })
  .handler(async ({ data, context }): Promise<NotifyResult> => {
    // RLS: only the buyer or the shop's admin can read this order at all.
    const { data: order, error } = await context.supabase
      .from("retail_orders")
      .select(
        "id, order_no, ecosystem_id, customer_name, status, fulfillment, delivery_address, delivery_notes, payment_method, total",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) return { sent: false, reason: "Order not found." };

    const { data: items } = await context.supabase
      .from("retail_order_items")
      .select("product_name, quantity, line_total")
      .eq("order_id", order.id);

    const { data: shop } = await context.supabase
      .from("ecosystems")
      .select("name, contact_email")
      .eq("id", order.ecosystem_id)
      .maybeSingle();

    const to = (shop?.contact_email ?? "").trim();
    if (!to) {
      return {
        sent: false,
        reason: "This shop has no contact email configured — add one in Shop settings.",
      };
    }

    const apiKey = process.env["RESEND_API_KEY"];
    if (!apiKey) {
      return {
        sent: false,
        reason: "Email delivery is not set up for this platform yet, so no email was sent.",
      };
    }

    const lines = (items ?? [])
      .map((i) => `- ${i.quantity} x ${i.product_name} = ${i.line_total} coins`)
      .join("\n");
    const body = [
      `New retail order ${order.order_no} for ${shop?.name ?? "your shop"}.`,
      ``,
      `Customer: ${order.customer_name}`,
      `Fulfillment: ${order.fulfillment}`,
      order.delivery_address ? `Address: ${order.delivery_address}` : null,
      order.delivery_notes ? `Instructions: ${order.delivery_notes}` : null,
      `Payment: ${order.payment_method}`,
      ``,
      lines,
      ``,
      `Order total: ${order.total} coins`,
      `Status: ${order.status} — approve or reject it in your admin console.`,
    ]
      .filter((l) => l !== null)
      .join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "WaveWallet <orders@wavewallet.app>",
        to: [to],
        subject: `New retail order ${order.order_no}`,
        text: body,
      }),
    });
    if (!response.ok) {
      return { sent: false, reason: "The email provider rejected the message." };
    }

    await context.supabase
      .from("retail_orders")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", order.id);
    return { sent: true, reason: `Emailed ${to}` };
  });
