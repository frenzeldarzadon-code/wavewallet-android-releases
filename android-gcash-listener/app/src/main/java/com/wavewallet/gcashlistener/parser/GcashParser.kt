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
 * v2 added the "Express Send Notification" wording and the reference number.
 * v3 adds bank-to-GCash credits (InstaPay / PESONet / "credited to your GCash
 * account"), bank reference numbers, and a bank account number as the sending
 * account when the payer is not a mobile wallet.
 *
 * The parser NEVER decides anything financial; WaveWallet does the matching.
 */
object GcashParser {

    /** Bump when patterns change; sent to the server as `parser_version`. */
    const val VERSION: String = "gcash-ph-v3"

    /** Phrases that positively identify an incoming payment. */
    private val INCOMING_MARKERS = listOf(
        Regex("""you\s+have\s+received\s+money\s+in\s+gcash""", RegexOption.IGNORE_CASE),
        Regex("""you\s+(?:have\s+)?received\s+php\s*[\d,]+(?:\.\d{1,2})?""", RegexOption.IGNORE_CASE),
        Regex("""received\s+php\s*[\d,]+(?:\.\d{1,2})?\s+(?:from|via|through)""", RegexOption.IGNORE_CASE),
        Regex("""express\s+send""", RegexOption.IGNORE_CASE),
        Regex("""credited\s+to\s+your\s+gcash""", RegexOption.IGNORE_CASE),
        Regex("""has\s+been\s+credited""", RegexOption.IGNORE_CASE),
        Regex("""credited\s+with\s+php""", RegexOption.IGNORE_CASE),
        Regex("""(?:instapay|pesonet)\b""", RegexOption.IGNORE_CASE),
        Regex("""(?:bank\s+transfer|fund\s+transfer)\s+(?:received|credit)""", RegexOption.IGNORE_CASE),
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
        Regex("""debited\s+from""", RegexOption.IGNORE_CASE),
        Regex("""your\s+(?:instapay|pesonet|fund)\s+transfer""", RegexOption.IGNORE_CASE),
        Regex("""transfer(?:red)?\s+to\s+(?:account|[A-Z*]{2,})"""),
        Regex("""paid\s+php""", RegexOption.IGNORE_CASE),
        Regex("""refund""", RegexOption.IGNORE_CASE),
        Regex("""bills?\s+payment""", RegexOption.IGNORE_CASE),
        Regex("""gcredit""", RegexOption.IGNORE_CASE),
        Regex("""ginvest""", RegexOption.IGNORE_CASE),
        Regex("""promo|voucher|discount|win\s+up\s+to|limited\s+time""", RegexOption.IGNORE_CASE),
        Regex("""reminder|verify\s+your""", RegexOption.IGNORE_CASE),
    )

    /** Amount candidates, most specific first. Balances are never read as amounts. */
    private val AMOUNTS = listOf(
        Regex("""(?:received|credited\s+with|credit\s+of)\s*(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)""", RegexOption.IGNORE_CASE),
        Regex("""(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)\s+(?:has\s+been\s+|was\s+)?(?:credited|received)""", RegexOption.IGNORE_CASE),
        Regex("""(?:amount|amt)\s*[:\-]?\s*(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)""", RegexOption.IGNORE_CASE),
    )
    private val PH_NUMBER = Regex("""(?<!\d)(09\d{9}|639\d{9}|\+639\d{9})(?!\d)""")
    private val ACCOUNT_NUMBER = Regex("""(?<!\d)(\d{8,19})(?!\d)""")
    private val REFERENCE = Regex(
        """\b(?:ref(?:erence)?|transaction|trace|txn)\.?\s*(?:no\.?|number|id|#)?\s*[:.\-]?\s*([A-Za-z0-9-]{6,32})""",
        RegexOption.IGNORE_CASE,
    )

    /** Sender text between "from" and the message / balance / reference tail. */
    private val SENDER_SEGMENT = Regex(
        """\bfrom\s+(.+?)(?:\s*(?:w/\s*msg|with\s+msg|your\s+new\s+balance|new\s+balance|via\b|ref\b|reference\b|transaction\b|trace\b)|\.?\s*$)""",
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

        val amountRaw = AMOUNTS.firstNotNullOfOrNull { it.find(body)?.groupValues?.get(1) }
            ?: return Result.Unparsed("no amount found in an incoming-payment notification")
        val amount = amountRaw.replace(",", "").toDoubleOrNull()
            ?: return Result.Unparsed("amount \"$amountRaw\" is not a number")
        if (amount <= 0.0) return Result.Unparsed("non-positive amount")

        val segment = SENDER_SEGMENT.find(body)?.groupValues?.get(1)?.trim()?.trimEnd('.')
        val mobile = segment?.let { PH_NUMBER.find(it)?.value } ?: PH_NUMBER.find(body)?.value
        // A bank payer has an account number, not a mobile number. Only the
        // "from" segment is trusted, and never the reference number itself.
        val account = if (mobile == null && segment != null) {
            ACCOUNT_NUMBER.find(segment)?.value?.takeIf { it != reference }
        } else {
            null
        }
        val payer = mobile ?: account
        val name = segment
            ?.let { if (payer != null) it.replace(payer, "") else it }
            ?.replace(Regex("""\s+"""), " ")
            ?.trim()
            ?.trim(',', '.', '-', ' ')
            ?.takeIf { it.isNotEmpty() && it.length <= 160 }

        return Result.Payment(
            amountPhp = amount,
            senderNumber = mobile?.let(::normalizePhMobile) ?: account,
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
