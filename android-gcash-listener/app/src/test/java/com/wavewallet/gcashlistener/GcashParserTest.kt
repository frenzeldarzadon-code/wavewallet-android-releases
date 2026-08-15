package com.wavewallet.gcashlistener

import com.wavewallet.gcashlistener.parser.GcashParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GcashParserTest {

    private val observed =
        "You have received money in GCash! You have received PHP 10.00 of GCash from FR****L A. 09070321959."

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
    fun `ignores outgoing money`() {
        assertEquals(
            GcashParser.Result.Ignored,
            GcashParser.parse("GCash", "You have sent PHP 500.00 to JUAN D. 09171234567."),
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
}
