package com.wavewallet.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import java.io.File
import java.io.FileOutputStream

/**
 * Lets the WaveWallet web app save a generated voucher image inside the shell.
 *
 * Android WebView hands `a[download]` on a `blob:` URL to the DownloadListener,
 * which cannot resolve it, so the tap silently does nothing. The web app calls
 * `WaveWalletNative.saveImage(base64, fileName)` instead when this bridge is
 * present. It only writes image bytes the page already generated locally — no
 * network access, no credentials, no business logic.
 */
class ImageSaver(private val activity: Activity) {

    @JavascriptInterface
    fun saveImage(base64: String, fileName: String): Boolean {
        return runCatching {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "-").ifBlank { "voucher.png" }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                    put(MediaStore.Downloads.MIME_TYPE, "image/png")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = activity.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return@runCatching false
                resolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                FileOutputStream(File(dir, safeName)).use { it.write(bytes) }
                @Suppress("DEPRECATION")
                activity.sendBroadcast(
                    Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, android.net.Uri.fromFile(File(dir, safeName)))
                )
            }
            activity.runOnUiThread {
                Toast.makeText(activity, "Saved to Downloads: $safeName", Toast.LENGTH_SHORT).show()
            }
            true
        }.getOrElse {
            activity.runOnUiThread {
                Toast.makeText(activity, "Could not save the voucher image", Toast.LENGTH_SHORT).show()
            }
            false
        }
    }
}
