package app.durhamweather

import android.Manifest
import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

private const val SITE = "https://durham-weather.pages.dev"

// The WebView's own geolocation can take longer than the page's 5 s timeout, so the page
// gets the fix the app already has and only falls back to navigator.geolocation without one.
private val GEO_SHIM = """
    (() => {
      const geo = navigator.geolocation;
      if (!geo || !window.DurhamApp) return;
      const original = geo.getCurrentPosition.bind(geo);
      geo.getCurrentPosition = (ok, fail, opts) => {
        const fix = DurhamApp.location();
        if (!fix) return original(ok, fail, opts);
        const [latitude, longitude] = fix.split(',').map(Number);
        ok({ coords: { latitude, longitude, accuracy: 100 }, timestamp: Date.now() });
      };
    })();
""".trimIndent()

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null

    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val granted = hasLocation()
        pendingGeo?.let { (origin, cb) -> cb.invoke(origin, granted, false) }
        pendingGeo = null
        if (granted) saveLocation()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(0xFF0B111C.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.setGeolocationEnabled(true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.toString().startsWith(SITE)) return false
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (!request.isForMainFrame) return
                    view.loadDataWithBaseURL(null, offlinePage(request.url.toString()), "text/html", "utf-8", null)
                }
            }
            addJavascriptInterface(object {
                @JavascriptInterface
                fun location(): String {
                    val p = Weather.prefs(this@MainActivity)
                    val lat = p.getString("lat", null) ?: return ""
                    return "$lat,${p.getString("lon", null)}"
                }
            }, "DurhamApp")
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(this, GEO_SHIM, setOf(SITE))
            }
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                    if (hasLocation()) callback.invoke(origin, true, false)
                    else pendingGeo = origin to callback
                }
            }
        }
        // WebView ignores its own padding, so the system-bar insets go on a wrapper.
        val frame = FrameLayout(this).apply { addView(web) }
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(frame)
        window.decorView.setBackgroundColor(0xFF0B111C.toInt())

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl("$SITE/today") else web.restoreState(savedInstanceState)
        if (hasLocation()) saveLocation()
        else askLocation.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
        handlePin(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handlePin(intent)
    }

    override fun onResume() {
        super.onResume()
        RefreshWorker.enqueue(this)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    // `adb shell am start -n app.durhamweather/.MainActivity --ez pin_widget true` asks the launcher to add the widget.
    private fun handlePin(intent: Intent?) {
        if (intent?.getBooleanExtra("pin_widget", false) != true) return
        val manager = getSystemService(AppWidgetManager::class.java)
        if (manager.isRequestPinAppWidgetSupported) {
            manager.requestPinAppWidget(ComponentName(this, ForecastWidget::class.java), null, null)
        }
    }

    private fun offlinePage(url: String) = """
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
          background:#0b111c;color:#e8edf5;font:16px system-ui,sans-serif;text-align:center">
          <p style="font-size:20px;margin:0 0 8px">The forecast didn't load.</p>
          <p style="opacity:.7;margin:0 24px 20px">Check your connection and try again.</p>
          <a href="$url" style="color:#e8edf5;border:1px solid #ffffff55;border-radius:999px;padding:10px 22px;text-decoration:none">Try again</a>
        </body>
    """.trimIndent()

    private fun hasLocation() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    private fun saveLocation() {
        val lm = getSystemService(LocationManager::class.java)
        val save = { loc: Location? ->
            if (loc != null) {
                Weather.saveLocation(this, loc.latitude, loc.longitude)
                RefreshWorker.enqueue(this)
            }
        }
        val providers = lm.getProviders(true)
        providers.mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }?.let(save)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val provider = listOf(LocationManager.FUSED_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
                .firstOrNull { it in providers } ?: return
            lm.getCurrentLocation(provider, null, mainExecutor) { save(it) }
        }
    }
}
