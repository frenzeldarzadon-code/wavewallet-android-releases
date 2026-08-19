package com.wavewallet.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * The read/write-limited native bridge exposed to the WaveWallet web app as
 * `WaveWalletNative`.
 *
 * It does three things and nothing else:
 *  - saveImage(): writes voucher PNG bytes the page already generated locally
 *    into Downloads, returning a REAL success/failure result to JavaScript.
 *  - getAppVersion(): read-only version information so the web layer can tell
 *    whether the installed APK is current.
 *  - openUpdatePage(): opens the one official update destination. Arbitrary
 *    URLs are impossible: the destination is compiled in.
 *
 * No credentials, no wallet data, no business logic, no silent installs.
 */
class ImageSaver(private val activity: Activity) {

    @JavascriptInterface
    fun saveImage(base64: String, fileName: String): Boolean {
        val ok = runCatching {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            if (bytes.isEmpty()) return@runCatching false
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
                val wrote = runCatching {
                    resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@runCatching false
                    true
                }.getOrDefault(false)
                if (!wrote) {
                    // Never leave a half-written pending entry behind.
                    runCatching { resolver.delete(uri, null, null) }
                    return@runCatching false
                }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                val out = File(dir, safeName)
                FileOutputStream(out).use { it.write(bytes) }
                if (!out.exists() || out.length() <= 0L) return@runCatching false
                @Suppress("DEPRECATION")
                activity.sendBroadcast(Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(out)))
            }
            true
        }.getOrDefault(false)

        activity.runOnUiThread {
            val message = if (ok) "Saved to Downloads" else "Could not save the voucher image"
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
        return ok
    }

    /**
     * Shares one voucher PNG through the Android share sheet.
     *
     * Android WebView does not implement the Web Share API, so the page routes
     * sharing here. The bytes are the same locally generated voucher image the
     * page already holds; they are written to a private cache folder and handed
     * out as a single read-only FileProvider URI.
     */
    @JavascriptInterface
    fun shareImage(base64: String, fileName: String, title: String): Boolean =
        runCatching {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            if (bytes.isEmpty()) return@runCatching false
            val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "-").ifBlank { "voucher.png" }

            val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
            // Keep the cache small: this folder only ever holds share hand-offs.
            dir.listFiles()?.forEach { runCatching { it.delete() } }
            val out = File(dir, safeName)
            FileOutputStream(out).use { it.write(bytes) }

            val uri = FileProvider.getUriForFile(
                activity,
                "${'$'}{activity.packageName}.fileprovider",
                out,
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, title)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, title).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(chooser)
            true
        }.getOrDefault(false)

    /** Read-only installed app version, as JSON, for the web update centre. */
    @JavascriptInterface
    fun getAppVersion(): String =
        JSONObject()
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("versionName", BuildConfig.VERSION_NAME)
            .put("packageName", BuildConfig.APPLICATION_ID)
            .toString()

    /**
     * Opens the official WaveWallet download page in the system browser, where
     * Android's own package installer asks the user for permission. The app
     * never installs an APK by itself and never accepts a URL from the page.
     */
    @JavascriptInterface
    fun openUpdatePage(): Boolean =
        runCatching {
            activity.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.UPDATE_URL))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        }.getOrDefault(false)
}
