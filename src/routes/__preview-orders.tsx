import { createFileRoute } from "@tanstack/react-router";
import { CustomerOrdersPanel } from "@/components/retail/customer-orders-panel";
import type { RetailOrder } from "@/lib/retail";
const mk = (o: Partial<RetailOrder>): RetailOrder =>
  ({ id: Math.random().toString(), order_no: "R-2609-0001", status: "approved", fulfillment: "delivery", fulfillment_status: "out_for_delivery", payment_method: "cod", total: 101, delivery_fee: 20, shop_name: "Sari-Sari Hub", seller_name: "Ana", delivery_address: "12 Rizal St, Brgy. Poblacion", delivery_person_name: "Ben", collector_name: "Cara", created_at: "2026-09-01T02:00:00Z", items: [{ product_id: "p1", name: "Coffee 3-in-1 (pack)", quantity: 1, unit_price: 101, line_total: 101 }], ...o }) as RetailOrder;
const orders = [mk({}), mk({ order_no: "R-2609-0002", status: "pending", fulfillment: "pickup", payment_method: "credit", delivery_fee: 0 }), mk({ order_no: "R-2609-0003", fulfillment_status: "delivered", delivered_at: "2026-09-02T02:00:00Z" }), mk({ order_no: "R-2609-0004", fulfillment_status: "completed", completed_at: "2026-09-02T04:00:00Z" }), mk({ order_no: "R-2609-0005", status: "cancelled" })];
export const Route = createFileRoute("/__preview-orders")({
  component: () => (
    <div className="mx-auto max-w-2xl p-4">
      <CustomerOrdersPanel orders={orders} loading={false} error={null} onRetry={() => {}} onChanged={() => {}} onChat={() => {}} onRate={() => {}} />
    </div>
  ),
});
