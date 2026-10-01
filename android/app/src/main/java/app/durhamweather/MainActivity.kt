package app.durhamweather

import android.Manifest
import android.annotation.SuppressLint
import android.appwidget.AppWidgetManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.util.Log
import android.view.ViewGroup
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
private const val SITE_HOST = "durham-weather.pages.dev"

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
    private var askingLocation = false
    private var locationListener: LocationListener? = null
    private var locationCancel: CancellationSignal? = null
    // Survives a resume replacing the location request, so the first-grant reload isn't lost.
    private var reloadOnFix = false
    private var showingOffline = false

    private val askLocation = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        askingLocation = false
        val granted = hasLocation()
        pendingGeo?.let { (origin, cb) -> cb.invoke(origin, granted, false) }
        pendingGeo = null
        if (granted) saveLocation(reloadPage = true)
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
                    val url = request.url
                    if (url.scheme == "https" && url.host == SITE_HOST) return false
                    if (url.scheme == "http" || url.scheme == "https") {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, url))
                        } catch (e: ActivityNotFoundException) {
                            // No browser installed; stay on the page.
                        }
                    }
                    return true
                }

                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    if (url.startsWith("$SITE/")) showingOffline = false
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (!request.isForMainFrame) return
                    Log.w("DurhamWeather", "Page load failed: ${error.errorCode} ${error.description} ${request.url}")
                    showingOffline = true
                    view.loadDataWithBaseURL(null, offlinePage(request.url.toString()), "text/html", "utf-8", null)
                }
            }
            addJavascriptInterface(object {
                @JavascriptInterface
                fun location(): String {
                    if (!hasLocation()) return ""
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
                    // Only park the callback while the permission dialog is up; otherwise the page
                    // would wait out its own timeout on every refresh.
                    when {
                        hasLocation() -> callback.invoke(origin, true, false)
                        askingLocation -> pendingGeo = origin to callback
                        else -> callback.invoke(origin, false, false)
                    }
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

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl("$SITE/today")
        if (!hasLocation()) {
            askingLocation = true
            askLocation.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
        }
        handlePin(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handlePin(intent)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        if (showingOffline) reloadPage()
        if (hasLocation()) saveLocation()
        RefreshWorker.enqueue(this)
    }

    // The offline notice is a data page, so reloading it would just show the notice again.
    private fun reloadPage() {
        if (showingOffline) web.loadUrl("$SITE/today") else web.reload()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        cancelLocationRequest()
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    private fun cancelLocationRequest() {
        locationCancel?.cancel()
        locationCancel = null
        locationListener?.let { getSystemService(LocationManager::class.java).removeUpdates(it) }
        locationListener = null
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
    // On first launch the page asks for a position while the permission dialog is still up and
    // settles on the home forecast, so it reloads once the app has a fix to hand it.
    private fun saveLocation(reloadPage: Boolean = false) {
        val lm = getSystemService(LocationManager::class.java)
        if (reloadPage) reloadOnFix = true
        val save = { loc: Location? ->
            if (loc != null && !isDestroyed) {
                if (Weather.saveLocation(this, loc.latitude, loc.longitude)) RefreshWorker.enqueue(this)
                // A cached fix can be hours old; wait for one inside the page's own 10-minute maximumAge.
                if (reloadOnFix && System.currentTimeMillis() - loc.time < 10 * 60_000) {
                    reloadPage()
                    reloadOnFix = false
                }
            }
        }
        val providers = lm.getProviders(true)
        // Some providers need fine location below API 31; with only coarse granted they throw.
        providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }?.let(save)
        val provider = listOf(LocationManager.FUSED_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            .firstOrNull { it in providers } ?: return
        cancelLocationRequest()
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val signal = CancellationSignal().also { locationCancel = it }
                lm.getCurrentLocation(provider, signal, mainExecutor) { save(it) }
            } else {
                // LocationListener's other methods only gained default bodies in API 30.
                val listener = object : LocationListener {
                    override fun onLocationChanged(location: Location) {
                        if (locationListener === this) locationListener = null
                        save(location)
                    }
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                    @Deprecated("Deprecated in Java")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                }
                locationListener = listener
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, listener, mainLooper)
            }
        }.onFailure { Log.w("DurhamWeather", "Location request on $provider failed", it) }
    }
}
