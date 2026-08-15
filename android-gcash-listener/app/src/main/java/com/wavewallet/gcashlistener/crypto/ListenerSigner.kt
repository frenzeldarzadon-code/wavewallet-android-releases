package com.wavewallet.gcashlistener.crypto

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Phase 1 signing scheme, byte-for-byte:
 *   hmacKey   = hex(SHA-256(pairing secret))
 *   payload   = "${deviceId}.${timestamp}.${nonce}.${rawJsonBody}"
 *   signature = hex(HMAC-SHA256(hmacKey, payload))
 *
 * The HMAC key is the *hex string* of the digest, matching the server's
 * `hmacHex(device.secret_key_hash, ...)` which keys with that same text.
 */
object ListenerSigner {

    fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .toHex()

    fun hmacHex(key: String, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(message.toByteArray(Charsets.UTF_8)).toHex()
    }

    fun signingPayload(deviceId: String, timestamp: String, nonce: String, body: String): String =
        "$deviceId.$timestamp.$nonce.$body"

    /** Derives the HMAC key from the one-time pairing secret. */
    fun deriveHmacKey(pairingSecret: String): String = sha256Hex(pairingSecret)

    private fun ByteArray.toHex(): String =
        joinToString("") { "%02x".format(it) }
}
