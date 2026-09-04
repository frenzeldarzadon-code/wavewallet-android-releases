import { describe, expect, it } from "vitest";
import { extractNotificationFields } from "../payment-notification-fields";
import { parseReceiptReading } from "../cash-in-receipt";

describe("receiver-side notification extraction", () => {
  it("reads a GCash 'received from' notification as the payee's view", () => {
    const d = extractNotificationFields(
      "You have received PHP 500.00 of GCash from JUAN D. 09171234567 with message: Cash in. Ref. No. 1029384756. Your new balance is PHP 12,345.67.",
    );
    expect(d.viewpoint).toBe("receiver");
    expect(d.amount_php).toBe(500);
    expect(d.sender_name).toBe("JUAN D");
    expect(d.sender_number).toBe("09171234567");
    expect(d.reference).toBe("1029384756");
    expect(d.balance_php).toBe(12345.67);
    expect(d.message).toBe("Cash in");
    expect(d.raw_text).toContain("received PHP 500.00");
  });

  it("keeps the receiving account when a bank notification prints it", () => {
    const d = extractNotificationFields(
      "MariBank: You received ₱1,200.00 via InstaPay from MARIA S. ****4321 to your account ****3427 on 09/04/2026 10:15 AM. Reference No: MB2026ABC123. Fee: ₱0.00",
    );
    expect(d.amount_php).toBe(1200);
    expect(d.sender_account_masked).toBe("****4321");
    expect(d.receiving_account).toBe("****3427");
    expect(d.reference).toBe("MB2026ABC123");
    expect(d.transfer_method?.toLowerCase()).toBe("instapay");
    expect(d.fee_php).toBeUndefined(); // ₱0.00 is not a positive fee; nothing invented
    expect(d.time_text).toContain("09/04/2026");
  });

  it("never invents fields that are absent", () => {
    const d = extractNotificationFields("You have received money in GCash!");
    expect(d.amount_php).toBeUndefined();
    expect(d.reference).toBeUndefined();
    expect(d.sender_name).toBeUndefined();
    expect(Object.keys(d).sort()).toEqual(["raw_text", "viewpoint"]);
  });

  it("keeps every labelled pair, not a whitelist", () => {
    const d = extractNotificationFields("Amount: PHP 250.00 Sender: PEDRO P Ref: ABCDEF12 Channel: QR Ph");
    expect(d.labeled_fields).toMatchObject({
      amount: "PHP 250.00",
      sender: "PEDRO P",
      ref: "ABCDEF12",
      channel: "QR Ph",
    });
  });
});

describe("sender-side receipt reading keeps everything printed", () => {
  it("retains the full label → value map and extra fields", () => {
    const reading = parseReceiptReading(
      JSON.stringify({
        raw_text: "GCash\nSent to\nWA**E W. 0917···0072\nAmount ₱500.00\nRef No. 1029 384 756",
        fields: { "Sent to": "WA**E W. 0917···0072", Amount: "₱500.00", "Ref No.": "1029 384 756", "Total Amount Sent": "₱500.00" },
        provider_name: "GCash",
        reference: "1029 384 756",
        amount_php: 500,
        sender_number: "09171234567",
        sender_name: "JUAN D",
        receiving_number: "0917···0072",
        receiving_name: "WA**E W.",
        total_php: 500,
        balance_php: 1500.5,
        receiving_institution: "GCash",
        paid_at: "2026-09-04T02:15:00Z",
        readable: true,
        confidence: 0.95,
      }),
    );
    expect(reading.readable).toBe(true);
    expect(reading.fields).toEqual({
      "Sent to": "WA**E W. 0917···0072",
      Amount: "₱500.00",
      "Ref No.": "1029 384 756",
      "Total Amount Sent": "₱500.00",
    });
    expect(reading.totalPhp).toBe(500);
    expect(reading.balancePhp).toBe(1500.5);
    expect(reading.receivingInstitution).toBe("GCash");
    // Direction: the receipt's "Sent to" is the receiving side, "From" the payer.
    expect(reading.receivingNumber).toBe("0917···0072");
    expect(reading.senderNumber).toBe("09171234567");
  });

  it("leaves absent fields null instead of inventing them", () => {
    const reading = parseReceiptReading(JSON.stringify({ reference: "ABC123", readable: true, confidence: 0.9 }));
    expect(reading.fields).toBeNull();
    expect(reading.totalPhp).toBeNull();
    expect(reading.message).toBeNull();
  });
});
