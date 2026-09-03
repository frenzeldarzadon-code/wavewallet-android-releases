package com.wavewallet.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** In-app About / version screen. */
class AboutActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(56, 56, 56, 56)
        }
        fun line(text: String, size: Float = 14f, color: String = "#0F172A") {
            column.addView(TextView(this).apply {
                this.text = text
                textSize = size
                setTextColor(Color.parseColor(color))
                setPadding(0, 8, 0, 8)
            })
        }
        line("ONE WAVE", 22f, "#1D4ED8")
        line("Version ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})")
        line("Application ID: ${BuildConfig.APPLICATION_ID}")
        line("Build type: ${BuildConfig.BUILD_TYPE}")
        line("Connects to: ${BuildConfig.APP_URL}")
        line(
            "This app is the official ONE WAVE client. WaveWallet is its wallet product.  It uses the same accounts, " +
                "the same wallets and the same backend as the website. No Coin, voucher, " +
                "cash in, cash out or subscription action is stored on this device.",
            13f,
            "#64748B",
        )
        // The WaveWallet Payment Listener screen is deliberately NOT reachable
        // from here. It is opened only from the authorised settings pages in the
        // web app, which is where the role check lives.

        val scroll = ScrollView(this)
        scroll.addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
    }
}
