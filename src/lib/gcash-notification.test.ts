import { describe, expect, it } from "vitest";
import { parseGcashNotification, normalizePhMobile } from "./gcash-notification";

/** The exact notification that was missed on the operator's phone. */
const EXPRESS_SEND_TITLE = "Express Send Notification";
const EXPRESS_SEND_BODY =
  "You have received PHP 1000.00 from DO**A RO**F B. +639752505196 w/ MSG: . " +
  "Your new balance is PHP 2102.95. Ref. No. 9044057598177.";

describe("GCash Express Send notification", () => {
  it("reads amount, sender and reference from the exact missed notification", () => {
    const result = parseGcashNotification(EXPRESS_SEND_TITLE, EXPRESS_SEND_BODY);
    expect(result.incoming).toBe(true);
    expect(result.amountPhp).toBe(1000.0);
    expect(result.senderNumber).toBe("09752505196");
    expect(result.reference).toBe("9044057598177");
  });

  it("survives line breaks, extra whitespace and a title/body split", () => {
    const result = parseGcashNotification(
      "  Express Send   Notification ",
      "You have received PHP 1,000.00\n from DO**A RO**F B.  09752505196 w/ MSG: .\n\nRef. No.  9044057598177 .",
    );
    expect(result.amountPhp).toBe(1000.0);
    expect(result.senderNumber).toBe("09752505196");
    expect(result.reference).toBe("9044057598177");
  });

  it("still reads the older 'received money in GCash' wording", () => {
    const result = parseGcashNotification(
      "GCash",
      "You have received money in GCash! You have received PHP 10.00 of GCash from FR****L A. 09070321959.",
    );
    expect(result.amountPhp).toBe(10);
    expect(result.senderNumber).toBe("09070321959");
    expect(result.reference).toBeNull();
  });

  it("never treats outgoing money, cash out or promos as incoming", () => {
    for (const text of [
      "You have sent PHP 500.00 to JUAN D. 09171234567. Ref. No. 123456789.",
      "Cash out of PHP 200.00 successful.",
      "Win up to PHP 1,000.00 in vouchers!",
    ]) {
      expect(parseGcashNotification("GCash", text).incoming).toBe(false);
    }
  });

  it("reports an incoming payment it cannot read as amount-less, never guessed", () => {
    const result = parseGcashNotification("GCash", "You have received money in GCash! Amount unavailable.");
    expect(result.incoming).toBe(true);
    expect(result.amountPhp).toBeNull();
  });

  it("normalises Philippine mobile formats", () => {
    expect(normalizePhMobile("+63 975 250 5196")).toBe("09752505196");
    expect(normalizePhMobile("639752505196")).toBe("09752505196");
    expect(normalizePhMobile("09752505196")).toBe("09752505196");
  });
});

describe("bank-to-GCash (InstaPay / PESONet) credits", () => {
  it("reads a MariBank -> GCash InstaPay transfer with a bank account payer", () => {
    const result = parseGcashNotification(
      "GCash",
      "You have received PHP 150.00 from MARIBANK 15976553427 via InstaPay. Ref. No. 104116.",
    );
    expect(result.incoming).toBe(true);
    expect(result.amountPhp).toBe(150);
    expect(result.senderNumber).toBe("15976553427");
    expect(result.senderName).toBe("MARIBANK");
    expect(result.reference).toBe("104116");
  });

  it("reads the 'has been credited to your GCash account' wording", () => {
    const result = parseGcashNotification(
      "GCash",
      "PHP 150.00 has been credited to your GCash account via InstaPay from SEABANK. Reference No. 104116",
    );
    expect(result.incoming).toBe(true);
    expect(result.amountPhp).toBe(150);
    expect(result.reference).toBe("104116");
    expect(result.senderName).toBe("SEABANK");
  });

  it("reads a PESONet credit with a transaction number", () => {
    const result = parseGcashNotification(
      "GCash",
      "Fund transfer received: your GCash was credited with PHP 1,250.00 via PESONet. Transaction No. AB1234567890",
    );
    expect(result.amountPhp).toBe(1250);
    expect(result.reference).toBe("AB1234567890");
  });

  it("never treats the sender-side bank transfer notification as incoming", () => {
    for (const text of [
      "Your InstaPay transfer of PHP 150.00 to 09541230072 was successful. Ref No. 104116",
      "PHP 150.00 has been debited from your account via InstaPay. Ref No. 104116",
    ]) {
      expect(parseGcashNotification("MariBank", text).incoming).toBe(false);
    }
  });

  it("never mistakes the reference number for the sending account", () => {
    const result = parseGcashNotification(
      "GCash",
      "PHP 150.00 has been credited to your GCash account from MARIBANK. Ref. No. 104116104116",
    );
    expect(result.senderNumber).toBeNull();
    expect(result.reference).toBe("104116104116");
  });
});
