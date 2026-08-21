package com.wavewallet.app.listener.crypto

/**
 * Stable per-notification identity.
 *
 * Derived from the notification's own key + posted time + exact text, so a
 * reposted/updated notification for the same payment yields the same UID and
 * is deduplicated locally and server-side. Two genuine payments of the same
 * amount from the same sender at different times differ in posted time and
 * notification key, so they stay separate events — sender+amount is never a key.
 */
object EventUid {
    fun of(notificationKey: String, postedAtMillis: Long, rawText: String): String =
        "gcash-" + ListenerSigner.sha256Hex("$notificationKey|$postedAtMillis|$rawText").take(40)

    /**
     * Identity derived from the GCash reference number. The reference belongs
     * to the payment, so the same payment always yields the same UID no matter
     * how many times Android reposts or the app recovers the notification.
     */
    fun ofReference(reference: String): String =
        "gcashref-" + ListenerSigner.sha256Hex(reference.trim().uppercase()).take(40)
}

