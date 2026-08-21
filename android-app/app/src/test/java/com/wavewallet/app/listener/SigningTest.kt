package com.wavewallet.app.listener

import com.wavewallet.app.listener.crypto.EventUid
import com.wavewallet.app.listener.crypto.ListenerSigner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * Vectors are shared with the web test suite
 * (src/lib/__tests__/listener-signature.test.ts) so the phone and Phase 1
 * server agree byte-for-byte.
 */
class SigningTest {

    @Test
    fun `sha256 of the pairing secret is the hmac key`() {
        assertEquals(
            "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
            ListenerSigner.deriveHmacKey("123"),
        )
    }

    @Test
    fun `signing payload matches the phase 1 contract`() {
        assertEquals(
            "dev.1700000000.nonce-1.{\"kind\":\"heartbeat\"}",
            ListenerSigner.signingPayload("dev", "1700000000", "nonce-1", "{\"kind\":\"heartbeat\"}"),
        )
    }

    @Test
    fun `hmac is deterministic and body sensitive`() {
        val key = ListenerSigner.deriveHmacKey("pair-secret")
        val a = ListenerSigner.hmacHex(key, ListenerSigner.signingPayload("dev", "1", "n", "{}"))
        val b = ListenerSigner.hmacHex(key, ListenerSigner.signingPayload("dev", "1", "n", "{}"))
        val c = ListenerSigner.hmacHex(key, ListenerSigner.signingPayload("dev", "1", "n", "{\"x\":1}"))
        assertEquals(a, b)
        assertNotEquals(a, c)
        assertEquals(64, a.length)
    }

    @Test
    fun `event uid is stable for reposts and unique per payment`() {
        val text = "You have received money in GCash! You have received PHP 10.00 of GCash from FR****L A. 09070321959."
        val first = EventUid.of("0|com.globe.gcash.android|1|null|10", 1_700_000_000_000, text)
        val repost = EventUid.of("0|com.globe.gcash.android|1|null|10", 1_700_000_000_000, text)
        val later = EventUid.of("0|com.globe.gcash.android|2|null|10", 1_700_000_600_000, text)
        assertEquals(first, repost)
        assertNotEquals(first, later) // same sender and amount, different payment
    }
}
