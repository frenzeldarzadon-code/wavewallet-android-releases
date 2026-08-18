/**
 * Reads the GCash reference off an uploaded Cash In receipt.
 *
 * Runs on the server only: it signs a short-lived URL for the private
 * screenshot, asks a vision model to transcribe the receipt fields, and hands
 * the result to the database. Nothing here decides whether money moves —
 * `apply_cash_in_receipt_ocr` stores the comparison and the database's own
 * rules decide.
 */
import { parseReceiptReading, type ReceiptReading } from "./cash-in-receipt";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

const PROMPT = `You are reading a GCash payment receipt screenshot.
Return ONLY JSON with these keys and nothing else:
{"reference": string|null, "amount_php": number|null, "sender_number": string|null, "paid_at": string|null, "readable": boolean, "confidence": number}
- "reference" is the GCash reference number printed on the receipt (often labelled "Ref No." or "Reference No."). Copy the digits exactly as printed.
- "paid_at" is the payment date AND time printed on the receipt, as an ISO 8601 string (assume Asia/Manila when no zone is shown). Use null when it is not legible.
- "confidence" is 0..1: how certain you are that you read the reference correctly.
- If the image is not a payment receipt, is cropped, blurred or the reference is not fully legible, set "readable": false and "reference": null. Never guess or reconstruct a reference.`;

export async function readReceipt(imageUrl: string): Promise<ReceiptReading> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("No AI key is configured, so receipts cannot be read automatically.");

  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`The receipt reader returned ${response.status}.`);
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return parseReceiptReading(content);
}
