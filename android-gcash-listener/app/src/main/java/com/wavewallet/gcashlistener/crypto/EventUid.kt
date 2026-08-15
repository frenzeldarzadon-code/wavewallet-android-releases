package com.wavewallet.gcashlistener.crypto

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
}
