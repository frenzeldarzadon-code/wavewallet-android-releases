package com.wavewallet.app.listener

import com.wavewallet.app.listener.work.deliveryStatusFor
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A real payment must never be dropped because of a temporary upload failure.
 */
class DeliveryRetryTest {
    @Test
    fun `an accepted upload is done`() {
        assertEquals("sent", deliveryStatusFor(true, 200))
    }

    @Test
    fun `a replay means the server already has it`() {
        assertEquals("sent", deliveryStatusFor(false, 409))
    }

    @Test
    fun `a signature or clock failure is retried, never dropped`() {
        for (code in listOf(401, 403, 408, 425, 429, 500, 502, 503, 504)) {
            assertEquals("retryable for HTTP $code", "queued", deliveryStatusFor(false, code))
        }
    }

    @Test
    fun `only a contract error is given up on`() {
        for (code in listOf(400, 413, 422)) {
            assertEquals("rejected", deliveryStatusFor(false, code))
        }
    }
}
