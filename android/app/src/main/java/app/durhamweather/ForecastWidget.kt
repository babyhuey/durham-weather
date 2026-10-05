package app.durhamweather

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.format.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.Constraints

class ForecastWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
        render(ctx)
        RefreshWorker.enqueue(ctx)
        RefreshWorker.schedule(ctx)
    }

    override fun onAppWidgetOptionsChanged(ctx: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
        render(ctx)
    }

    companion object {
        private val DAY_IDS = listOf(
            Triple(R.id.day0_name, R.id.day0_icon, R.id.day0_temps),
            Triple(R.id.day1_name, R.id.day1_icon, R.id.day1_temps),
            Triple(R.id.day2_name, R.id.day2_icon, R.id.day2_temps),
            Triple(R.id.day3_name, R.id.day3_icon, R.id.day3_temps),
            Triple(R.id.day4_name, R.id.day4_icon, R.id.day4_temps),
            Triple(R.id.day5_name, R.id.day5_icon, R.id.day5_temps),
        )
        private val COLUMN_IDS = listOf(R.id.day0, R.id.day1, R.id.day2, R.id.day3, R.id.day4, R.id.day5)
        private val DIVIDER_IDS = listOf(R.id.div0, R.id.div1, R.id.div2, R.id.div3, R.id.div4, R.id.div5)

        fun render(ctx: Context) {
            val manager = AppWidgetManager.getInstance(ctx)
            val ids = manager.getAppWidgetIds(ComponentName(ctx, ForecastWidget::class.java))
            val snap = Weather.cached(ctx)
            for (id in ids) {
                val views = RemoteViews(ctx.packageName, R.layout.widget)
                val open = PendingIntent.getActivity(
                    ctx, 0, Intent(ctx, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                views.setOnClickPendingIntent(R.id.root, open)
                if (snap != null) fill(ctx, views, snap, columnsFor(manager.getAppWidgetOptions(id)))
                manager.updateAppWidget(id, views)
            }
        }

        // The current-conditions block takes about 104dp; each day needs about 42dp for "66°/80°".
        private fun columnsFor(options: Bundle): Int {
            val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
            if (width == 0) return 6
            return ((width - 104) / 42).coerceIn(1, 6)
        }

        fun fill(ctx: Context, views: RemoteViews, snap: Snapshot, columns: Int) {
            views.setImageViewResource(R.id.now_icon, icon(snap.kind))
            // Shows when the data was fetched, so a refresh held back by battery saver is visible.
            val clock = if (DateFormat.is24HourFormat(ctx)) "H:mm" else "h:mm"
            views.setTextViewText(R.id.now_updated, SimpleDateFormat(clock, Locale.getDefault()).format(Date(snap.savedAt)))
            views.setTextViewText(R.id.now_temp, deg(snap.tempF))
            views.setTextViewText(R.id.now_low, deg(snap.lowF))
            DAY_IDS.forEachIndexed { i, (name, img, temps) ->
                val day = snap.days.getOrNull(i)
                val visible = day != null && i < columns
                views.setViewVisibility(COLUMN_IDS[i], if (visible) View.VISIBLE else View.GONE)
                views.setViewVisibility(DIVIDER_IDS[i], if (visible) View.VISIBLE else View.GONE)
                if (day == null) return@forEachIndexed
                views.setTextViewText(name, day.label)
                views.setImageViewResource(img, icon(day.kind))
                views.setTextViewText(temps, lowHigh(day.low, day.high))
            }
        }

        private fun deg(v: Int?) = if (v == null) "--°" else "$v°"

        private fun lowHigh(low: Int?, high: Int?): CharSequence {
            val s = SpannableStringBuilder("${deg(low)}/")
            val start = s.length
            s.append(deg(high))
            s.setSpan(StyleSpan(Typeface.BOLD), start, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            s.setSpan(ForegroundColorSpan(Color.WHITE), start, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            return s
        }

        fun icon(kind: String) = when (kind) {
            "clear-night" -> R.drawable.wx_moon
            "partly-day" -> R.drawable.wx_partly_day
            "partly-night" -> R.drawable.wx_partly_night
            "cloudy" -> R.drawable.wx_cloudy
            "rain" -> R.drawable.wx_rain
            "partly-rain" -> R.drawable.wx_partly_rain
            "storm" -> R.drawable.wx_storm
            "snow" -> R.drawable.wx_snow
            "fog" -> R.drawable.wx_fog
            else -> R.drawable.wx_sun
        }
    }
}

class RefreshWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val failure = listOfNotNull(
            runCatching { if (Weather.refresh(applicationContext) != null) ForecastWidget.render(applicationContext) }.exceptionOrNull(),
            runCatching { Alerts.check(applicationContext) }.exceptionOrNull(),
        ).firstOrNull() ?: return Result.success()
        Log.w("DurhamWeather", "Refresh failed (attempt ${runAttemptCount + 1})", failure)
        return if (runAttemptCount < 3) Result.retry() else Result.failure()
    }

    companion object {
        fun enqueue(ctx: Context) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork("refresh", ExistingWorkPolicy.REPLACE, request)
        }

        // Runs the notification checks even when no widget is on the home screen.
        fun schedule(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("periodic", ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}
