package app.durhamweather

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray

private const val UPDATES_CHANNEL = "updates"
private const val RELEASES = "https://api.github.com/repos/babyhuey/durham-weather/releases?per_page=10"

data class Release(val version: String, val name: String, val url: String)

// "v0.1.10" -> [0, 1, 10]; anything that isn't a plain dotted version is ignored.
fun parseVersion(s: String): List<Int>? =
    s.removePrefix("v").split(".").map { it.toIntOrNull() ?: return null }.takeIf { it.isNotEmpty() }

fun newer(a: List<Int>, b: List<Int>): Boolean {
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

// Newest published release above the installed version. Tapping it downloads the APK when the release has one.
fun newerRelease(releases: JSONArray, installed: String): Release? {
    val current = parseVersion(installed) ?: return null
    return (0 until releases.length())
        .map { releases.getJSONObject(it) }
        .filter { !it.optBoolean("draft") }
        .mapNotNull { r -> parseVersion(r.getString("tag_name"))?.let { v -> v to r } }
        .filter { (v, _) -> newer(v, current) }
        .maxWithOrNull { (a, _), (b, _) -> if (newer(a, b)) 1 else if (newer(b, a)) -1 else 0 }
        ?.let { (_, r) ->
            val assets = r.optJSONArray("assets") ?: JSONArray()
            val apk = (0 until assets.length()).map { assets.getJSONObject(it) }
                .firstOrNull { it.getString("name").endsWith(".apk") }
            Release(
                version = r.getString("tag_name").removePrefix("v"),
                name = r.optString("name").ifBlank { r.getString("tag_name") },
                url = apk?.getString("browser_download_url") ?: r.getString("html_url"),
            )
        }
}

object Updates {
    fun check(ctx: Context) {
        if (!Alerts.canNotify(ctx)) return
        val installed = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: return
        val release = newerRelease(JSONArray(Weather.text(RELEASES, "application/vnd.github+json")), installed) ?: return
        val p = Weather.prefs(ctx)
        if (p.getString("updateNotified", null) == release.version) return
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(UPDATES_CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "When a new version of the app is released" }
        )
        val tap = PendingIntent.getActivity(
            ctx, 3, Intent(Intent.ACTION_VIEW, Uri.parse(release.url)),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, UPDATES_CHANNEL)
            .setSmallIcon(R.drawable.wx_sun)
            .setContentTitle("Update available: ${release.version}")
            .setContentText("You have $installed. Tap to download ${release.name}.")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(ctx).notify("update", 0, n)
        p.edit().putString("updateNotified", release.version).apply()
    }
}
