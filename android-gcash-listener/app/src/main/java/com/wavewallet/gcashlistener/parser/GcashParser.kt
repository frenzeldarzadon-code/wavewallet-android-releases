package com.wavewallet.gcashlistener.parser

/**
 * Versioned parser for GCash incoming-payment notifications.
 *
 * Safety rules:
 *  - Only incoming-payment shapes are parsed. Anything else is IGNORED.
 *  - Outgoing / sent / cash-out / promo notifications are explicitly rejected.
 *  - When the text looks like an incoming payment but cannot be read
 *    confidently, the result is [Unparsed] — never a guessed amount.
 *
 * v2 adds the "Express Send Notification" wording and reads the GCash
 * reference number as a first-class field so the backend can identify the
 * exact payment even when no Cash In request exists yet.
 *
 * The parser NEVER decides anything financial; WaveWallet does the matching.
 */
object GcashParser {

    /** Bump when patterns change; sent to the server as `parser_version`. */
    const val VERSION: String = "gcash-ph-v2"

    /** Phrases that positively identify an incoming payment. */
    private val INCOMING_MARKERS = listOf(
        Regex("""you\s+have\s+received\s+money\s+in\s+gcash""", RegexOption.IGNORE_CASE),
        Regex("""you\s+have\s+received\s+php\s*[\d,]+(?:\.\d{1,2})?""", RegexOption.IGNORE_CASE),
        Regex("""received\s+php\s*[\d,]+(?:\.\d{1,2})?\s+from""", RegexOption.IGNORE_CASE),
        Regex("""express\s+send""", RegexOption.IGNORE_CASE),
    )

    /** Phrases that mean this is NOT an incoming payment. Checked first. */
    private val REJECT_MARKERS = listOf(
        Regex("""you\s+have\s+sent""", RegexOption.IGNORE_CASE),
        Regex("""you\s+sent""", RegexOption.IGNORE_CASE),
        Regex("""sent\s+php""", RegexOption.IGNORE_CASE),
        Regex("""payment\s+sent""", RegexOption.IGNORE_CASE),
        Regex("""cash\s*out""", RegexOption.IGNORE_CASE),
        Regex("""cash\s*-?in\s+to""", RegexOption.IGNORE_CASE),
        Regex("""has\s+been\s+debited""", RegexOption.IGNORE_CASE),
        Regex("""paid\s+php""", RegexOption.IGNORE_CASE),
        Regex("""refund""", RegexOption.IGNORE_CASE),
        Regex("""bills?\s+payment""", RegexOption.IGNORE_CASE),
        Regex("""gcredit""", RegexOption.IGNORE_CASE),
        Regex("""ginvest""", RegexOption.IGNORE_CASE),
        Regex("""promo|voucher|discount|win\s+up\s+to|limited\s+time""", RegexOption.IGNORE_CASE),
        Regex("""reminder|verify\s+your""", RegexOption.IGNORE_CASE),
    )

    private val AMOUNT = Regex("""received\s+PHP\s*([\d,]+(?:\.\d{1,2})?)""", RegexOption.IGNORE_CASE)
    private val PH_NUMBER = Regex("""(?<!\d)(09\d{9}|639\d{9}|\+639\d{9})(?!\d)""")
    private val REFERENCE = Regex(
        """\bref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([A-Za-z0-9-]{6,32})""",
        RegexOption.IGNORE_CASE,
    )

    /** Sender text between "from" and the message / balance / reference tail. */
    private val SENDER_SEGMENT = Regex(
        """\bfrom\s+(.+?)(?:\s*(?:w/\s*msg|with\s+msg|your\s+new\s+balance|ref\b|reference\b)|\.?\s*$)""",
        RegexOption.IGNORE_CASE,
    )

    sealed interface Result {
        /** Not a GCash incoming-payment notification at all — drop it silently. */
        data object Ignored : Result

        /** Looks like an incoming payment but unreadable — log, never auto-approve. */
        data class Unparsed(val reason: String) : Result

        data class Payment(
            val amountPhp: Double,
            val senderNumber: String?,
            val senderName: String?,
            val reference: String?,
        ) : Result
    }

    fun parse(title: String?, text: String?): Result {
        val body = listOfNotNull(title?.trim(), text?.trim())
            .filter { it.isNotEmpty() }
            .joinToString(" ")
            .replace(Regex("""\s+"""), " ")
            .trim()
        if (body.isEmpty()) return Result.Ignored

        if (REJECT_MARKERS.any { it.containsMatchIn(body) }) return Result.Ignored
        if (INCOMING_MARKERS.none { it.containsMatchIn(body) }) return Result.Ignored

        val reference = REFERENCE.find(body)?.groupValues?.get(1)

        val amountRaw = AMOUNT.find(body)?.groupValues?.get(1)
            ?: return Result.Unparsed("no amount found in an incoming-payment notification")
        val amount = amountRaw.replace(",", "").toDoubleOrNull()
            ?: return Result.Unparsed("amount \"$amountRaw\" is not a number")
        if (amount <= 0.0) return Result.Unparsed("non-positive amount")

        val segment = SENDER_SEGMENT.find(body)?.groupValues?.get(1)?.trim()?.trimEnd('.')
        val number = segment?.let { PH_NUMBER.find(it)?.value } ?: PH_NUMBER.find(body)?.value
        val name = segment
            ?.let { if (number != null) it.replace(number, "") else it }
            ?.replace(Regex("""\s+"""), " ")
            ?.trim()
            ?.trim(',', '.', '-', ' ')
            ?.takeIf { it.isNotEmpty() && it.length <= 160 }

        return Result.Payment(
            amountPhp = amount,
            senderNumber = number?.let(::normalizePhMobile),
            senderName = name,
            reference = reference,
        )
    }

    /** 09XXXXXXXXX / +639XXXXXXXXX / 639XXXXXXXXX -> 09XXXXXXXXX. */
    fun normalizePhMobile(raw: String): String {
        val digits = raw.filter { it.isDigit() }
        return when {
            digits.length == 12 && digits.startsWith("639") -> "0" + digits.substring(2)
            digits.length == 11 && digits.startsWith("09") -> digits
            digits.length == 10 && digits.startsWith("9") -> "0$digits"
            else -> digits
        }
    }
}
