package com.wavewallet.gcashlistener

import com.wavewallet.gcashlistener.parser.GcashParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GcashParserTest {

    private val observed =
        "You have received money in GCash! You have received PHP 10.00 of GCash from FR****L A. 09070321959."

    /** The exact notification that was missed on the operator's phone. */
    private val expressSend =
        "You have received PHP 1000.00 from DO**A RO**F B. +639752505196 w/ MSG: . " +
            "Your new balance is PHP 2102.95. Ref. No. 9044057598177."

    @Test
    fun `parses the express send notification that was missed`() {
        val result = GcashParser.parse("Express Send Notification", expressSend)
        assertTrue(result is GcashParser.Result.Payment)
        result as GcashParser.Result.Payment
        assertEquals(1000.00, result.amountPhp, 0.001)
        assertEquals("09752505196", result.senderNumber)
        assertEquals("9044057598177", result.reference)
    }

    @Test
    fun `express send survives line breaks and extra whitespace`() {
        val result = GcashParser.parse(
            "  Express Send   Notification ",
            "You have received PHP 1,000.00\n from DO**A RO**F B.  09752505196 w/ MSG: .\n\nRef. No.  9044057598177 .",
        ) as GcashParser.Result.Payment
        assertEquals(1000.00, result.amountPhp, 0.001)
        assertEquals("09752505196", result.senderNumber)
        assertEquals("9044057598177", result.reference)
    }

    @Test
    fun `parses the notification observed on the phone`() {
        val result = GcashParser.parse("GCash", observed)
        assertTrue(result is GcashParser.Result.Payment)
        result as GcashParser.Result.Payment
        assertEquals(10.00, result.amountPhp, 0.001)
        assertEquals("09070321959", result.senderNumber)
        assertEquals("FR****L A.".trimEnd('.'), result.senderName)
    }

    @Test
    fun `parses thousands separators and 63 prefixed numbers`() {
        val result = GcashParser.parse(
            "GCash",
            "You have received money in GCash! You have received PHP 1,250.50 of GCash from JU****N D. +639171234567.",
        ) as GcashParser.Result.Payment
        assertEquals(1250.50, result.amountPhp, 0.001)
        assertEquals("09171234567", result.senderNumber)
    }

    @Test
    fun `ignores outgoing money even with a reference`() {
        assertEquals(
            GcashParser.Result.Ignored,
            GcashParser.parse("GCash", "You have sent PHP 500.00 to JUAN D. 09171234567. Ref. No. 123456789."),
        )
    }

    @Test
    fun `ignores promos and unrelated PHP text`() {
        assertEquals(GcashParser.Result.Ignored, GcashParser.parse("GCash", "Win up to PHP 1,000.00 in vouchers!"))
        assertEquals(GcashParser.Result.Ignored, GcashParser.parse("GCash", "Your GCredit bill of PHP 300.00 is due."))
        assertEquals(GcashParser.Result.Ignored, GcashParser.parse("GCash", "Cash out of PHP 200.00 successful."))
        assertEquals(GcashParser.Result.Ignored, GcashParser.parse("Messages", "PHP 10.00 received somewhere"))
    }

    @Test
    fun `malformed incoming payment is unparsed, never guessed`() {
        val result = GcashParser.parse("GCash", "You have received money in GCash! Amount unavailable.")
        assertTrue(result is GcashParser.Result.Unparsed)
    }

    @Test
    fun `sender number is optional`() {
        val result = GcashParser.parse(
            "GCash",
            "You have received money in GCash! You have received PHP 25.00 of GCash from A MERCHANT.",
        ) as GcashParser.Result.Payment
        assertEquals(25.00, result.amountPhp, 0.001)
        assertEquals(null, result.senderNumber)
    }

    @Test
    fun `normalizes philippine mobile formats`() {
        assertEquals("09070321959", GcashParser.normalizePhMobile("+63 907 032 1959"))
        assertEquals("09070321959", GcashParser.normalizePhMobile("639070321959"))
        assertEquals("09070321959", GcashParser.normalizePhMobile("09070321959"))
    }

    @Test
    fun `parses a bank to GCash InstaPay credit with a bank account payer`() {
        val result = GcashParser.parse(
            "GCash",
            "You have received PHP 150.00 from MARIBANK 15976553427 via InstaPay. Ref. No. 104116.",
        ) as GcashParser.Result.Payment
        assertEquals(150.00, result.amountPhp, 0.001)
        assertEquals("15976553427", result.senderNumber)
        assertEquals("MARIBANK", result.senderName)
        assertEquals("104116", result.reference)
    }

    @Test
    fun `parses the credited to your GCash account wording`() {
        val result = GcashParser.parse(
            "GCash",
            "PHP 150.00 has been credited to your GCash account via InstaPay from SEABANK. Reference No. 104116",
        ) as GcashParser.Result.Payment
        assertEquals(150.00, result.amountPhp, 0.001)
        assertEquals("104116", result.reference)
        assertEquals("SEABANK", result.senderName)
    }

    @Test
    fun `parses a PESONet credit with a transaction number`() {
        val result = GcashParser.parse(
            "GCash",
            "Fund transfer received: your GCash was credited with PHP 1,250.00 via PESONet. Transaction No. AB1234567890",
        ) as GcashParser.Result.Payment
        assertEquals(1250.00, result.amountPhp, 0.001)
        assertEquals("AB1234567890", result.reference)
    }

    @Test
    fun `ignores the sender side bank transfer notification`() {
        assertEquals(
            GcashParser.Result.Ignored,
            GcashParser.parse("MariBank", "Your InstaPay transfer of PHP 150.00 to 09541230072 was successful. Ref No. 104116"),
        )
        assertEquals(
            GcashParser.Result.Ignored,
            GcashParser.parse("MariBank", "PHP 150.00 has been debited from your account via InstaPay. Ref No. 104116"),
        )
    }

    @Test
    fun `never mistakes the reference number for the sending account`() {
        val result = GcashParser.parse(
            "GCash",
            "PHP 150.00 has been credited to your GCash account from MARIBANK. Ref. No. 104116104116",
        ) as GcashParser.Result.Payment
        assertEquals(null, result.senderNumber)
        assertEquals("104116104116", result.reference)
    }
}
