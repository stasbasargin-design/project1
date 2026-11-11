package ru.eazia.imax;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class EnvironmentMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        synchronized (EnvironmentPlugin.PUSH_LOCK) {
            receiveForCurrentEnvironment(message);
        }
    }

    private void receiveForCurrentEnvironment(RemoteMessage message) {
        Map<String, String> data = message.getData();
        SharedPreferences preferences = getSharedPreferences("itus.push.environment", Context.MODE_PRIVATE);
        if (!data.containsKey("activationId")) {
            // Existing installations retain their notification behavior until upgraded and registered.
            if (!preferences.contains("environment")) super.onMessageReceived(message);
            return;
        }
        if (!preferences.getBoolean("enabled", false)
            || !preferences.getString("environment", "").equals(data.get("environment"))
            || !preferences.getString("activationId", "").equals(data.get("activationId"))) return;
        super.onMessageReceived(message);
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("i-max-events", "I-MAX", NotificationManager.IMPORTANCE_HIGH));
        Intent intent = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (Map.Entry<String, String> entry : data.entrySet()) intent.putExtra(entry.getKey(), entry.getValue());
        String id = message.getMessageId() == null ? data.getOrDefault("eventId", "imax") : message.getMessageId();
        intent.putExtra("google.message_id", id);
        PendingIntent tap = PendingIntent.getActivity(this, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(this, "i-max-events")
            .setSmallIcon(R.drawable.ic_stat_imax).setContentTitle(data.getOrDefault("itusTitle", "I-MAX"))
            .setContentText(data.getOrDefault("itusBody", "Новое уведомление"))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(data.getOrDefault("itusBody", "")))
            .setContentIntent(tap).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH);
        NotificationManagerCompat.from(this).notify(id.hashCode(), notification.build());
    }
}
