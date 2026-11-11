package ru.eazia.imax;

import android.app.NotificationManager;
import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Environment")
public class EnvironmentPlugin extends Plugin {
    static final Object PUSH_LOCK = new Object();
    @PluginMethod
    public void setPushContext(PluginCall call) {
        synchronized (PUSH_LOCK) {
        String environment = call.getString("environment", "test");
        String activation = call.getString("activationId", "");
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!environment.equals("test") && !environment.equals("production")) {
            call.reject("Invalid environment");
            return;
        }
        boolean saved = getContext().getSharedPreferences("itus.push.environment", Context.MODE_PRIVATE).edit()
            .putString("environment", environment).putString("activationId", activation).putBoolean("enabled", enabled).commit();
        if (!saved) {
            call.reject("Cannot save notification context");
            return;
        }
        ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).cancelAll();
        call.resolve();
        }
    }
}
