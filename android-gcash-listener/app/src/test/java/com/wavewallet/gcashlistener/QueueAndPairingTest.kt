package com.wavewallet.gcashlistener

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.wavewallet.gcashlistener.data.ListenerDb
import com.wavewallet.gcashlistener.data.QueuedEvent
import com.wavewallet.gcashlistener.parser.GcashParser
import com.wavewallet.gcashlistener.store.PairingStore
import com.wavewallet.gcashlistener.util.LastStatus
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class QueueAndPairingTest {

    private lateinit var db: ListenerDb
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun event(uid: String, amount: Double? = 10.0) = QueuedEvent(
        eventUid = uid,
        packageName = "com.globe.gcash.android",
        postedAt = 1_700_000_000_000,
        amountPhp = amount,
        senderNumber = "09070321959",
        senderName = "FR****L A",
        rawText = "raw",
        parserVersion = GcashParser.VERSION,
    )

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, ListenerDb::class.java).allowMainThreadQueries().build()
    }

    @After fun tearDown() = db.close()

    @Test
    fun `duplicate event uid is queued only once`() = runBlocking {
        assertTrue(db.events().insertIfNew(event("uid-1")) > 0)
        assertEquals(-1L, db.events().insertIfNew(event("uid-1")))
        assertEquals(1, db.events().pending().size)
    }

    @Test
    fun `offline failures keep the event queued for retry`() = runBlocking {
        val id = db.events().insertIfNew(event("uid-2"))
        db.events().mark(id, "queued", "Network error", null)
        val pending = db.events().pending()
        assertEquals(1, pending.size)
        assertEquals(1, pending.first().attempts)
        db.events().mark(id, "sent", null, "{\"accepted\":true}")
        assertTrue(db.events().pending().isEmpty())
    }

    @Test
    fun `pairing stores only the derived key and never the secret`() {
        val store = PairingStore(context)
        store.pair("device-abc", "super-secret-pairing-code", "https://wallet.example.com")
        assertTrue(store.isPaired)
        assertEquals("device-abc", store.deviceId)
        val dumped = context.getSharedPreferences("wavewallet_pairing", Context.MODE_PRIVATE).all.toString()
        assertFalse(dumped.contains("super-secret-pairing-code"))
        store.unpair()
        assertFalse(store.isPaired)
    }

    @Test
    fun `missing notification access is reported as not ready`() {
        assertFalse(LastStatus.hasNotificationAccess(context))
    }
}
