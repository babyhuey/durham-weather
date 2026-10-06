package app.durhamweather

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.text.format.DateFormat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.time.OffsetDateTime
import java.util.Date

private const val ALERTS_CHANNEL = "alerts"
private const val RAIN_CHANNEL = "rain"
private const val ALERTS_GROUP = "alerts"
private const val RAIN_MM = 0.1
private const val QUARTER_MS = 15 * 60_000L
// One rain notice per shower: the 30-minute checks would otherwise repeat it until the rain arrives.
private const val RAIN_QUIET_MS = 3 * 3_600_000L

data class NwsAlert(val id: String, val event: String, val headline: String, val description: String, val expires: Long)

data class Quarter(val start: Long, val mm: Double)

// Alerts not yet notified. An Update to an alert already sent is recorded but not re-sent.
fun newAlerts(features: JSONArray, seen: Set<String>): Pair<List<NwsAlert>, List<NwsAlert>> {
    val fresh = mutableListOf<NwsAlert>()
    val updates = mutableListOf<NwsAlert>()
    for (i in 0 until features.length()) {
        val p = features.getJSONObject(i).getJSONObject("properties")
        if (p.optString("status") != "Actual" || p.optString("messageType") == "Cancel") continue
        val id = p.getString("id")
        if (id in seen) continue
        val refs = p.optJSONArray("references") ?: JSONArray()
        val alert = NwsAlert(
            id = id,
            event = p.optString("event"),
            headline = p.optString("headline").takeUnless { p.isNull("headline") } ?: p.optString("event"),
            description = p.optString("description").takeUnless { p.isNull("description") }.orEmpty(),
            expires = p.optString("expires").takeIf { it.isNotEmpty() && !p.isNull("expires") }
                ?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() } ?: (System.currentTimeMillis() + 24 * 3_600_000L),
        )
        val known = (0 until refs.length()).any { refs.getJSONObject(it).optString("identifier") in seen }
        if (known) updates += alert else fresh += alert
    }
    return fresh to updates
}

// Mirrors quarterHours() in public/weather.js: Open-Meteo minutely_15 (unixtime) from the current quarter on.
fun quarters(openMeteo: JSONObject, now: Long): List<Quarter> {
    val m = openMeteo.getJSONObject("minutely_15")
    val times = m.getJSONArray("time")
    val mm = m.getJSONArray("precipitation")
    return (0 until times.length())
        .map { Quarter(times.getLong(it) * 1000, if (mm.isNull(it)) 0.0 else mm.getDouble(it)) }
        .filter { it.start + QUARTER_MS > now }
}

// Start of the first wet quarter in the next hour, only while the current quarter is still dry.
fun rainStart(quarters: List<Quarter>): Long? {
    val now = quarters.firstOrNull() ?: return null
    if (now.mm >= RAIN_MM) return null
    return quarters.drop(1).take(4).firstOrNull { it.mm >= RAIN_MM }?.start
}

object Alerts {
    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(ALERTS_CHANNEL, "Weather alerts", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "Watches, warnings, and advisories from the National Weather Service" })
        nm.createNotificationChannel(NotificationChannel(RAIN_CHANNEL, "Rain starting soon", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "When the HRRR model shows rain starting within the hour" })
    }

    fun check(ctx: Context) {
        if (!canNotify(ctx)) return
        createChannels(ctx)
        val p = Weather.prefs(ctx)
        val lat = p.getString("lat", null)?.toDouble() ?: HOME.first
        val lon = p.getString("lon", null)?.toDouble() ?: HOME.second
        // Outside NWS coverage the forecast falls back to home; home's alerts would be wrong here.
        val outside = p.getString("outside", null) == "$lat,$lon"
        val failures = listOfNotNull(
            if (outside) null else runCatching { checkNws(ctx, lat, lon) }.exceptionOrNull(),
            runCatching { checkRain(ctx, lat, lon, outside) }.exceptionOrNull(),
        )
        failures.firstOrNull()?.let { throw it }
    }

    fun canNotify(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    }

    private fun checkNws(ctx: Context, lat: Double, lon: Double) {
        val p = Weather.prefs(ctx)
        val now = System.currentTimeMillis()
        val stored = JSONObject(p.getString("alertsSeen", null) ?: "{}")
        val seen = stored.keys().asSequence().filter { stored.getLong(it) > now }.toSet()
        val features = Weather.get("$API/alerts/active?point=$lat,$lon").getJSONArray("features")
        val (fresh, updates) = newAlerts(features, seen)
        val kept = JSONObject()
        seen.forEach { kept.put(it, stored.getLong(it)) }
        (fresh + updates).forEach { kept.put(it.id, it.expires) }
        p.edit().putString("alertsSeen", kept.toString()).apply()
        fresh.forEach { notifyAlert(ctx, it) }
        if (fresh.isNotEmpty()) notifySummary(ctx, fresh, kept.keys().asSequence().maxOf { kept.getLong(it) })
    }

    private fun checkRain(ctx: Context, lat: Double, lon: Double, outside: Boolean) {
        val p = Weather.prefs(ctx)
        val now = System.currentTimeMillis()
        if (now - p.getLong("rainNotifiedAt", 0) < RAIN_QUIET_MS) return
        // HRRR can miss rain that's already falling; the station report the worker just fetched won't.
        if (!outside && Weather.cached(ctx)?.kind in setOf("rain", "storm")) return
        val url = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
            "&minutely_15=precipitation&forecast_minutely_15=6&past_minutely_15=1&timeformat=unixtime&timezone=GMT"
        val start = rainStart(quarters(Weather.get(url), now)) ?: return
        p.edit().putLong("rainNotifiedAt", now).apply()
        val clock = DateFormat.getTimeFormat(ctx).format(Date(start))
        val n = NotificationCompat.Builder(ctx, RAIN_CHANNEL)
            .setSmallIcon(R.drawable.wx_rain)
            .setContentTitle("Rain starting around $clock")
            .setContentText("Dry for now, but the HRRR model shows rain within the hour.")
            .setContentIntent(open(ctx, 2, "/radar"))
            .setAutoCancel(true)
            .build()
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(ctx).notify("rain", 0, n)
    }

    private fun notifyAlert(ctx: Context, a: NwsAlert) {
        val n = NotificationCompat.Builder(ctx, ALERTS_CHANNEL)
            .setSmallIcon(R.drawable.wx_storm)
            .setContentTitle(a.event)
            .setContentText(a.headline)
            .setStyle(NotificationCompat.BigTextStyle().bigText(listOf(a.headline, a.description).filter { it.isNotBlank() }.joinToString("\n\n")))
            .setContentIntent(open(ctx, 1, "/today"))
            .setTimeoutAfter((a.expires - System.currentTimeMillis()).coerceAtLeast(60_000))
            .setGroup(ALERTS_GROUP)
            .setAutoCancel(true)
            .build()
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(ctx).notify(a.id, 0, n)
    }

    // Without our own summary, Android bundles several alerts under one whose tap opens nothing
    // and clears them all.
    private fun notifySummary(ctx: Context, latest: List<NwsAlert>, expires: Long) {
        val n = NotificationCompat.Builder(ctx, ALERTS_CHANNEL)
            .setSmallIcon(R.drawable.wx_storm)
            .setContentTitle("Weather alerts")
            .setContentText(latest.joinToString(", ") { it.event })
            .setContentIntent(open(ctx, 1, "/today"))
            .setTimeoutAfter((expires - System.currentTimeMillis()).coerceAtLeast(60_000))
            .setGroup(ALERTS_GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .build()
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(ctx).notify(ALERTS_GROUP, 0, n)
    }

    // Request codes differ from the widget's 0 so these PendingIntents don't replace its tap target.
    private fun open(ctx: Context, code: Int, path: String) = PendingIntent.getActivity(
        ctx, code,
        Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_PATH, path).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
