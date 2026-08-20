package com.wavewallet.gcashlistener

import com.wavewallet.gcashlistener.parser.GcashParser
import com.wavewallet.gcashlistener.parser.NotificationText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationTextTest {

    /** The exact wording from the failed PHP 1,000 transaction. */
    private val real = "You have received PHP 1000.00 of GCash from DH*A B. 09539940338."

    @Test
    fun `merge collapses whitespace and drops duplicate fragments`() {
        val merged = NotificationText.merge(listOf("GCash", "  GCash ", null, "", "You have\nreceived   PHP 10.00"))
        assertEquals("GCash You have received PHP 10.00", merged)
    }

    @Test
    fun `merge drops fragments already contained in a longer one`() {
        val merged = NotificationText.merge(listOf(real.take(20), real))
        assertEquals(real, merged)
    }

    @Test
    fun `inbox-style lines still parse as a payment`() {
        val body = NotificationText.merge(listOf(null, real, "Tap to view"))
        val result = GcashParser.parse("GCash", body)
        assertTrue(result is GcashParser.Result.Payment)
        result as GcashParser.Result.Payment
        assertEquals(1000.00, result.amountPhp, 0.001)
        assertEquals("09539940338", result.senderNumber)
    }

    @Test
    fun `merged text never invents an amount`() {
        val body = NotificationText.merge(listOf("You have received money in GCash!", "Tap to view"))
        assertTrue(GcashParser.parse("GCash", body) is GcashParser.Result.Unparsed)
    }
}
