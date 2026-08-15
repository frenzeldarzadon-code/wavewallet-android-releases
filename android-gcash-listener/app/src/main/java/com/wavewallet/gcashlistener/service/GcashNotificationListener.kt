package com.wavewallet.gcashlistener.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.wavewallet.gcashlistener.BuildConfig
import com.wavewallet.gcashlistener.crypto.EventUid
import com.wavewallet.gcashlistener.data.ListenerDb
import com.wavewallet.gcashlistener.data.QueuedEvent
import com.wavewallet.gcashlistener.parser.GcashParser
import com.wavewallet.gcashlistener.util.LastStatus
import com.wavewallet.gcashlistener.work.ListenerScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Reads notifications only after the user grants Notification Access.
 *
 * Everything that is not a GCash incoming-payment notification is discarded in
 * memory and never stored or transmitted.
 */
class GcashNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        super.onListenerConnected()
        ListenerForegroundService.start(this)
        ListenerScheduler.scheduleHeartbeat(this)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != BuildConfig.GCASH_PACKAGE) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()
        val raw = listOfNotNull(title, text).joinToString(" ").trim()
        if (raw.isEmpty()) return

        when (val result = GcashParser.parse(title, text)) {
            is GcashParser.Result.Ignored -> Unit // not a payment: drop, never stored
            is GcashParser.Result.Unparsed -> {
                LastStatus.recordNotification(this, "Unreadable GCash payment notification (${result.reason})")
                enqueue(sbn, raw, null, null, null, status = "unparsed")
            }
            is GcashParser.Result.Payment -> {
                LastStatus.recordNotification(
                    this,
                    "PHP %.2f from %s".format(result.amountPhp, result.senderNumber ?: result.senderName ?: "unknown"),
                )
                enqueue(sbn, raw, result.amountPhp, result.senderNumber, result.senderName, status = "queued")
            }
        }
    }

    private fun enqueue(
        sbn: StatusBarNotification,
        raw: String,
        amount: Double?,
        number: String?,
        name: String?,
        status: String,
    ) {
        val event = QueuedEvent(
            eventUid = EventUid.of(sbn.key ?: "${sbn.packageName}:${sbn.id}", sbn.postTime, raw),
            packageName = sbn.packageName,
            postedAt = sbn.postTime,
            amountPhp = amount,
            senderNumber = number,
            senderName = name,
            rawText = raw,
            parserVersion = GcashParser.VERSION,
            status = status,
        )
        scope.launch {
            // Unique index on eventUid: a reposted notification is ignored.
            val inserted = ListenerDb.get(applicationContext).events().insertIfNew(event)
            if (inserted > 0 && status == "queued") ListenerScheduler.syncNow(applicationContext)
        }
    }
}
