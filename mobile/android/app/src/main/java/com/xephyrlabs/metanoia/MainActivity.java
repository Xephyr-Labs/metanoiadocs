package com.xephyrlabs.metanoia;

import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * The app is a window onto one MetanoiaDocs server, chosen on first launch.
 *
 * With no server saved it shows the bundled picker (www/index.html). Once one
 * is saved, the WebView opens that server as the app's own origin: the site's
 * pages get the native plugins (push, back button, status bar) exactly as if
 * the server were baked into the build, and www/error.html stands in when it
 * cannot be reached.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerPlugin.class);
        String server = ServerPlugin.saved(this);
        if (server != null) {
            try {
                JSONObject json = new JSONObject(readAsset("capacitor.config.json"));
                JSONObject serverConfig = json.optJSONObject("server");
                if (serverConfig == null) {
                    serverConfig = new JSONObject();
                    json.put("server", serverConfig);
                }
                serverConfig.put("url", server);
                serverConfig.put("errorPath", "error.html");
                config = new CapConfig(getAssets(), json);
            } catch (Exception e) {
                // A config we cannot read is not a reason to strand the person:
                // fall back to the picker, which can save the server again.
                ServerPlugin.forget(this);
            }
        }
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // The WebView writes cookies to disk on its own schedule, and Android
        // kills a backgrounded app without warning — which signed people out
        // whenever it happened between the two. Save the session on the way out.
        CookieManager.getInstance().flush();
    }

    private String readAsset(String name) throws Exception {
        try (InputStream in = getAssets().open(name)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
