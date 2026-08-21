package com.wavewallet.app.listener

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.wavewallet.app.listener.parser.GcashParser
import com.wavewallet.app.listener.util.LastStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The server must be able to tell "the app process is alive" apart from
 * "Android is actually delivering notifications". Those states fail
 * independently, so the health snapshot keeps them separate.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, sdk = [34])
class ListenerHealthTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun `a connected listener without notification access is never reported connected`() {
        LastStatus.recordListenerConnected(context, true)
        val health = LastStatus.health(context)
        // Robolectric grants no notification access, which is the exact
        // situation where a stale "connected" flag must not be trusted.
        assertFalse(health.notificationAccess)
        assertFalse(health.listenerConnected)
    }

    @Test
    fun `reception is counted before parsing and surfaces in the health snapshot`() {
        LastStatus.recordReceived(context, "posted", 120)
        LastStatus.recordReceived(context, "recovery", 130)
        val health = LastStatus.health(context)
        assertTrue(health.receivedCount >= 2)
        assertTrue(health.lastReceivedAt > 0)
    }

    @Test
    fun `disconnect is recorded so the phone can report itself offline`() {
        LastStatus.recordListenerConnected(context, false)
        assertFalse(LastStatus.isListenerConnected(context))
        assertFalse(LastStatus.health(context).listenerConnected)
    }

    /** The 1,500 peso notification shape that was reported as missed. */
    @Test
    fun `parses the PHP 1,500 incoming payment notification`() {
        val result = GcashParser.parse(
            "Express Send Notification",
            "You have received PHP 1,500.00 from DO**A RO**F B. +639752505196 w/ MSG: . " +
                "Your new balance is PHP 3,602.95. Ref. No. 9044057598178.",
        )
        assertTrue(result is GcashParser.Result.Payment)
        result as GcashParser.Result.Payment
        assertEquals(1500.00, result.amountPhp, 0.001)
        assertEquals("09752505196", result.senderNumber)
        assertEquals("9044057598178", result.reference)
    }
}
