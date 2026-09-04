/**
 * Reads a payment receipt uploaded with a Cash In.
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

const PROMPT = `You are reading a payment receipt / transfer confirmation screenshot from ANY e-wallet or bank app (for example GCash, Maya, GoTyme, MariBank, BPI, BDO, UnionBank, SeaBank, a QR payment result, or any other provider). Do not assume GCash.
This receipt is the SENDER's (payer's) view of the transfer: the person who holds this screenshot SENT the money. "Sent to" / "Paid to" / "Recipient" is the party who RECEIVED it; "From" / "Paid from" / "Source" is the payer.
Return ONLY JSON with these keys and nothing else:
{"raw_text": string|null, "fields": object, "provider_name": string|null, "reference": string|null, "amount_php": number|null, "fee_php": number|null, "total_php": number|null, "balance_php": number|null, "sender_number": string|null, "sender_name": string|null, "sender_account_masked": string|null, "receiving_number": string|null, "receiving_name": string|null, "receiving_account_masked": string|null, "receiving_institution": string|null, "transfer_method": string|null, "status": string|null, "merchant_name": string|null, "message": string|null, "qr_or_payment_id": string|null, "paid_at": string|null, "readable": boolean, "confidence": number}
- "raw_text" is EVERY line of text you can read on the screenshot, in the order it appears, separated by newlines. Transcribe only — do not summarise, translate, reorder or add anything.
- "fields" is an object holding EVERY labelled item printed on the receipt, using the label exactly as printed as the key and the value exactly as printed (e.g. {"Amount": "₱500.00", "Sent to": "WA**E W. 0917···0072", "Ref No.": "1234 567 890"}). Include everything — fees, totals, balances, dates, account names, institutions, messages, payment IDs — do not filter it down to a few fields.
- "total_php" is the total debited including fees, "balance_php" any remaining/available balance, "receiving_institution" the bank / wallet the money was sent to, "merchant_name" any merchant / biller name, "message" any note the payer attached, "qr_or_payment_id" any QR / invoice / payment ID other than the main reference.
- "provider_name" is the app or bank the receipt came from, exactly as printed (e.g. "GCash", "Maya", "MariBank", "BPI"). Use null when it is not shown.
- "reference" is the transaction / reference / trace number printed on the receipt (labels vary: "Ref No.", "Reference No.", "Transaction ID", "Trace No."). Copy the characters exactly as printed.
- "sender_number" is the account the money was sent FROM — it may be a mobile number (e-wallets) OR a bank/e-money account number, whatever is printed under labels like "Paid from", "From", "Source account", "Sender", "Debit account". "receiving_number" is the mobile or account number it was sent TO ("Paid to", "To", "Recipient", "Credit account"). These two are different things: never put the "Paid to" value in "sender_number" or the "Paid from" value in "receiving_number". Copy digits exactly, including masked characters as printed.
- "sender_name" is the payer's printed name; "receiving_name" is the payee's printed name; "sender_account_masked" and "receiving_account_masked" are masked account or card numbers as printed (e.g. "****1234"). Banks usually print these instead of a mobile number.
- "transfer_method" is how the money moved as printed ("Send Money", "Express Send", "InstaPay", "QR Ph", "Bank Transfer"); "status" is the printed outcome ("Successful", "Completed", "Pending").
- "fee_php" is any transfer/service fee printed on the receipt.
- Use null for any field the receipt does not show. Never move a value into a field it was not printed under.
- "paid_at" is the payment date AND time printed on the receipt, as an ISO 8601 string (assume Asia/Manila when no zone is shown). Use null when it is not legible.
- "confidence" is 0..1: how certain you are that you read the reference correctly.
- If the image is not a payment receipt, is cropped, blurred or the reference is not fully legible, set "readable": false and "reference": null, but still return whatever "raw_text" and other fields you could read. Never guess or reconstruct a reference, a name, an amount or an account number.`;

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
