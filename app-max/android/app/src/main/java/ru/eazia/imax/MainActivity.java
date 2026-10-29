package ru.eazia.imax;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // AndroidX connects this lifecycle-aware callback to predictive Back on API 33+.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean dispatching;

            @Override
            public void handleOnBackPressed() {
                if (dispatching) return;
                if (getBridge() == null || getBridge().getWebView() == null) {
                    forwardToSystem();
                    return;
                }
                dispatching = true;
                getBridge().getWebView().evaluateJavascript(
                    "(() => { try { return window.ITUS_BACK?.() === true; } catch (_) { return false; } })()",
                    handled -> {
                        dispatching = false;
                        if (!isFinishing() && !isDestroyed() && !"true".equals(handled)) forwardToSystem();
                    }
                );
            }

            private void forwardToSystem() {
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }
        });
    }
}
