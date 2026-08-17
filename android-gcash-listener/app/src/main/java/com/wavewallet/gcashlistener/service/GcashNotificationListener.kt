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
 * memory and never stored or transmitted. On (re)connect the service also
 * sweeps the notifications still on the status bar, so a payment that arrived
 * while the service was disconnected is still captured.
 */
class GcashNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        super.onListenerConnected()
        ListenerForegroundService.start(this)
        ListenerScheduler.scheduleHeartbeat(this)
        recoverActiveNotifications()
    }

    /** Android delivers the current status-bar notifications only after connect. */
    private fun recoverActiveNotifications() {
        val active = try {
            activeNotifications
        } catch (e: SecurityException) {
            LastStatus.recordNotification(this, "Could not read existing notifications: ${e.message}")
            null
        } ?: return
        var recovered = 0
        for (sbn in active) {
            if (sbn.packageName != BuildConfig.GCASH_PACKAGE) continue
            if (handle(sbn)) recovered++
        }
        if (recovered > 0) {
            LastStatus.recordNotification(this, "Recovered $recovered GCash notification(s) after reconnect")
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != BuildConfig.GCASH_PACKAGE) return
        handle(sbn)
    }

    /** Returns true when the notification was a GCash payment worth keeping. */
    private fun handle(sbn: StatusBarNotification): Boolean {
        val extras = sbn.notification?.extras ?: return false
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()
        val raw = listOfNotNull(title, text).joinToString(" ").trim()
        if (raw.isEmpty()) return false

        return when (val result = GcashParser.parse(title, text)) {
            is GcashParser.Result.Ignored -> false // not a payment: drop, never stored
            is GcashParser.Result.Unparsed -> {
                LastStatus.recordNotification(this, "Unreadable GCash payment notification (${result.reason})")
                enqueue(sbn, raw, null, null, null, null, status = "unparsed")
                true
            }
            is GcashParser.Result.Payment -> {
                LastStatus.recordNotification(
                    this,
                    "PHP %.2f from %s%s".format(
                        result.amountPhp,
                        result.senderNumber ?: result.senderName ?: "unknown",
                        result.reference?.let { " (ref $it)" } ?: "",
                    ),
                )
                enqueue(
                    sbn, raw, result.amountPhp, result.senderNumber, result.senderName,
                    result.reference, status = "queued",
                )
                true
            }
        }
    }

    private fun enqueue(
        sbn: StatusBarNotification,
        raw: String,
        amount: Double?,
        number: String?,
        name: String?,
        reference: String?,
        status: String,
    ) {
        val event = QueuedEvent(
            // A reference identifies the payment itself, so a reposted or
            // recovered copy of the same notification resolves to one event.
            eventUid = reference?.let { EventUid.ofReference(it) }
                ?: EventUid.of(sbn.key ?: "${sbn.packageName}:${sbn.id}", sbn.postTime, raw),
            packageName = sbn.packageName,
            postedAt = sbn.postTime,
            amountPhp = amount,
            senderNumber = number,
            senderName = name,
            gcashReference = reference,
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
