package ru.eazia.imax;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript("window.ITUS_BACK?.()", null);
    }
}
