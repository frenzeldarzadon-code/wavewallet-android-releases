package com.wavewallet.app.listener.parser

import com.wavewallet.app.BuildConfig

/**
 * Provider-agnostic triage of a notification, done on the phone.
 *
 * The phone deliberately decides as little as possible. It only answers
 * "could this text be about money at all?", so notifications that clearly are
 * not payments (chats, news, system messages) never leave the device. Every
 * real decision — which provider it is, whether it matches a Cash In, whether
 * it may ever credit a wallet — happens on the server, which re-parses the
 * text itself.
 *
 * A source package by itself never makes something a payment, and an amount by
 * itself never approves anything: those rules live in the database.
 */
object PaymentSignals {

    /** Bump when the triage heuristic changes; reported as `parser_version`. */
    const val VERSION: String = "generic-triage-v1"

    /** GCash stays the first supported provider, but nothing is built around it. */
    fun providerFor(packageName: String): String? = when {
        packageName.equals(BuildConfig.GCASH_PACKAGE, ignoreCase = true) -> "gcash"
        else -> null
    }

    private val MONEY = Regex(
        """(?:php|piso|₱|p)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{2}\s?(?:php|pesos?)""",
        RegexOption.IGNORE_CASE,
    )

    private val MONEY_WORDS = Regex(
        """received|payment|paid|sent\s+you|transfer|credited|deposit|ref(?:erence)?\s*(?:no\.?|number|#)|amount""",
        RegexOption.IGNORE_CASE,
    )

    /**
     * True when the text carries a money-shaped amount, or a money word next to
     * digits. Intentionally generous: false positives cost one stored event the
     * server marks non-payment, false negatives lose a real payment.
     */
    fun looksLikeMoney(text: String): Boolean {
        if (text.isBlank()) return false
        if (MONEY.containsMatchIn(text)) return true
        return MONEY_WORDS.containsMatchIn(text) && Regex("""\d""").containsMatchIn(text)
    }
}
