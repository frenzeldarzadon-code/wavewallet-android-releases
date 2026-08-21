package com.wavewallet.app.listener.crypto

/**
 * One-paste pairing value produced by WaveWallet's "Copy both" action.
 *
 * Format: `WWL1:<deviceId>:<pairingSecret>`
 *
 * Parsing is purely local convenience — it grants nothing on its own; the
 * secret still has to be accepted by the server on the next signed request.
 */
object PairingCode {

    const val PREFIX = "WWL1"

    data class Parsed(val deviceId: String, val secret: String)

    /** Returns the pair when [value] is a combined code, otherwise null. */
    fun parse(value: String?): Parsed? {
        val parts = value?.trim()?.split(":") ?: return null
        if (parts.size != 3) return null
        val (prefix, deviceId, secret) = parts
        if (!prefix.trim().equals(PREFIX, ignoreCase = true)) return null
        if (deviceId.isBlank() || secret.isBlank()) return null
        return Parsed(deviceId.trim(), secret.trim())
    }

    /** The secret alone: a combined code contributes only its secret part. */
    fun secretOf(value: String): String = parse(value)?.secret ?: value.trim()

    fun format(deviceId: String, secret: String): String =
        "$PREFIX:${deviceId.trim()}:${secret.trim()}"
}
