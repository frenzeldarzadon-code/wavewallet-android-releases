package com.wavewallet.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

/**
 * WaveWallet Android shell.
 *
 * This activity renders the already-published WaveWallet web application in a
 * full-screen WebView. It contains no business logic, no ledger, no credential
 * and no second backend: every Coin, voucher, cash in, cash out, subscription
 * and permission decision is made server-side by the same backend the website
 * uses, with the same session cookies and the same login.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var offlineBanner: TextView
    private lateinit var offlineScreen: View
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var filePicker: ActivityResultLauncher<Intent>

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.Theme_WaveWallet)

        filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = fileCallback
            fileCallback = null
            cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        }

        val root = FrameLayout(this)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        offlineBanner = TextView(this).apply {
            text = getString(R.string.offline_banner)
            setBackgroundColor(Color.parseColor("#DC2626"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setPadding(24, 18, 24, 18)
            visibility = View.GONE
        }
        webView = WebView(this)
        column.addView(
            offlineBanner,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
        column.addView(
            webView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
        )

        offlineScreen = buildOfflineScreen()
        root.addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(offlineScreen, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        configureWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.APP_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun buildOfflineScreen(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setBackgroundColor(if (isNightMode()) Color.parseColor("#0B1220") else Color.WHITE)
            visibility = View.GONE
        }
        box.addView(TextView(this).apply {
            text = getString(R.string.offline_title)
            textSize = 20f
            setTextColor(if (isNightMode()) Color.parseColor("#E2E8F0") else Color.parseColor("#0F172A"))
            gravity = Gravity.CENTER
        })
        box.addView(TextView(this).apply {
            text = getString(R.string.offline_body)
            textSize = 14f
            setPadding(0, 24, 0, 32)
            setTextColor(Color.parseColor("#64748B"))
            gravity = Gravity.CENTER
        })
        box.addView(Button(this).apply {
            text = getString(R.string.retry)
            setOnClickListener {
                offlineScreen.visibility = View.GONE
                webView.loadUrl(BuildConfig.APP_URL)
            }
        })
        return box
    }

    private fun isNightMode(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // Hardened defaults: no local file or content access from web pages.
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString WaveWalletAndroid/${BuildConfig.VERSION_NAME}"
        }
        WebView.setWebContentsDebuggingEnabled(false)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                return if (isAppUrl(url)) {
                    false
                } else {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    true
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) offlineScreen.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (offlineScreen.visibility != View.VISIBLE) offlineScreen.visibility = View.GONE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return runCatching {
                    filePicker.launch(params.createIntent())
                    true
                }.getOrElse {
                    fileCallback = null
                    false
                }
            }
        }

        webView.setDownloadListener(DownloadListener { url, _, _, _, _ ->
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        })
    }

    private fun isAppUrl(url: Uri): Boolean {
        val host = url.host ?: return false
        return url.scheme == "https" && (host == BuildConfig.APP_HOST || host == BuildConfig.ALT_HOST)
    }

    override fun onResume() {
        super.onResume()
        val online = NetworkStatus.isOnline(this)
        offlineBanner.visibility = if (online) View.GONE else View.VISIBLE
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }
}
