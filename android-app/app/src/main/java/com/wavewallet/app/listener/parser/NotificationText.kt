package com.wavewallet.app.listener.parser

import android.app.Notification
import android.os.Bundle

/**
 * Collects every legitimate text surface a NotificationListenerService can see.
 *
 * GCash does not always use the same notification style: some builds put the
 * payment sentence in EXTRA_TEXT, some in EXTRA_BIG_TEXT, some in the inbox
 * style EXTRA_TEXT_LINES, and messaging-style builds put it in the message
 * bundle. Reading only title/text/bigText silently loses the others, which
 * looks exactly like "Android never delivered the notification".
 *
 * This only widens *where* text is read from. It does not widen what the
 * parser accepts, so payment safety is unchanged.
 */
object NotificationText {

    /** Joins parts, de-duplicating repeats and collapsing whitespace. */
    fun merge(parts: List<String?>): String {
        val seen = LinkedHashSet<String>()
        for (part in parts) {
            val clean = part?.replace(Regex("""\s+"""), " ")?.trim().orEmpty()
            if (clean.isNotEmpty()) seen.add(clean)
        }
        // Drop fragments already fully contained in a longer fragment.
        val kept = seen.filter { candidate -> seen.none { it != candidate && it.contains(candidate) } }
        return kept.joinToString(" ").trim()
    }

    /** Title only — used as the parser's `title` argument. */
    fun titleOf(extras: Bundle?): String? =
        extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()?.takeIf { it.isNotEmpty() }

    /** Every body surface, merged into one string. */
    fun bodyOf(extras: Bundle?): String {
        if (extras == null) return ""
        val parts = mutableListOf<String?>()
        parts += extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        parts += extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        parts += extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()
        parts += extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString()
        parts += extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString()
        parts += extras.getCharSequence(Notification.EXTRA_TITLE_BIG)?.toString()

        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.forEach { parts += it?.toString() }

        // Messaging style: each message is a Bundle with a "text" CharSequence.
        @Suppress("DEPRECATION")
        (extras.getParcelableArray(Notification.EXTRA_MESSAGES))?.forEach { item ->
            (item as? Bundle)?.getCharSequence("text")?.let { parts += it.toString() }
        }

        return merge(parts)
    }
}
