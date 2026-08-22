package com.wavewallet.app.listener

import com.wavewallet.app.listener.parser.PaymentSignals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class PaymentSignalsTest {

    @Test
    fun `gcash is the first recognised provider`() {
        assertEquals("gcash", PaymentSignals.providerFor("com.globe.gcash.android"))
        assertNull(PaymentSignals.providerFor("com.maya.app"))
    }

    @Test
    fun `money shapes are candidates`() {
        assertTrue(PaymentSignals.looksLikeMoney("You received PHP 500.00 from JUAN D."))
        assertTrue(PaymentSignals.looksLikeMoney("₱1,250.00 credited to your account"))
        assertTrue(PaymentSignals.looksLikeMoney("Payment of 300 received. Ref No. 123456"))
    }

    @Test
    fun `ordinary notifications are not candidates`() {
        assertFalse(PaymentSignals.looksLikeMoney("Mom: are you coming home?"))
        assertFalse(PaymentSignals.looksLikeMoney(""))
        assertFalse(PaymentSignals.looksLikeMoney("Your download is complete"))
    }
}
