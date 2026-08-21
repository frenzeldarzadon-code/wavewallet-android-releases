package com.wavewallet.app.listener

import com.wavewallet.app.listener.crypto.PairingCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingCodeTest {

    @Test
    fun parsesCombinedValue() {
        val parsed = PairingCode.parse(" WWL1:dev-123:s3cr3t ")
        assertEquals("dev-123", parsed?.deviceId)
        assertEquals("s3cr3t", parsed?.secret)
    }

    @Test
    fun roundTrips() {
        assertEquals(
            PairingCode.Parsed("dev-1", "abc"),
            PairingCode.parse(PairingCode.format("dev-1", "abc")),
        )
    }

    @Test
    fun rejectsNonCombinedValues() {
        assertNull(PairingCode.parse("dev-123:s3cr3t"))
        assertNull(PairingCode.parse("plain-secret"))
        assertNull(PairingCode.parse("WWL1::s3cr3t"))
        assertNull(PairingCode.parse(null))
    }

    @Test
    fun secretOfFallsBackToRawInput() {
        assertEquals("s3cr3t", PairingCode.secretOf("WWL1:dev-1:s3cr3t"))
        assertEquals("plain", PairingCode.secretOf(" plain "))
    }
}
