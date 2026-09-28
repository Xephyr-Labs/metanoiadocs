package com.xephyrlabs.metanoia;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import java.net.URI;

/**
 * Which MetanoiaDocs server this install talks to. Called from the picker
 * (set), from the server's sign-in page and the offline page (clear), and
 * from the offline page's Try again (reload).
 */
@CapacitorPlugin(name = "Server")
public class ServerPlugin extends Plugin {

    private static final String PREFS = "metanoia";
    private static final String KEY = "server";

    static String saved(Context context) {
        return prefs(context).getString(KEY, null);
    }

    static void forget(Context context) {
        prefs(context).edit().remove(KEY).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("url", saved(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String url = call.getString("url", "");
        URI uri;
        try {
            uri = new URI(url);
        } catch (Exception e) {
            call.reject("Not a server address");
            return;
        }
        // Origins only, and only over TLS: the page loaded here is handed the
        // native bridge, so it must be exactly the server the person checked.
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null) {
            call.reject("Use an https:// address");
            return;
        }
        String origin = "https://" + uri.getHost() + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
        prefs(getContext()).edit().putString(KEY, origin).commit();
        call.resolve();
        restart();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        forget(getContext());
        call.resolve();
        restart();
    }

    /**
     * Whether this build can receive push at all. A build without
     * google-services.json has no Firebase app, and registering for push
     * there throws inside the plugin and takes the whole app down.
     */
    @PluginMethod
    public void pushAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", !FirebaseApp.getApps(getContext()).isEmpty());
        call.resolve(ret);
    }

    @PluginMethod
    public void reload(PluginCall call) {
        call.resolve();
        restart();
    }

    private void restart() {
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }
}
