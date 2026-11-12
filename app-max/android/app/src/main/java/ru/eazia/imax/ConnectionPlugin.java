package ru.eazia.imax;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "Connection")
public class ConnectionPlugin extends Plugin {
    private ConnectivityManager manager;
    private ConnectivityManager.NetworkCallback callback;
    private final Map<String,NativeReadTransport.Job> jobs = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(3,3,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(12));
    private String networkKey = "";
    private long generation;
    @Override public void load() {
        manager = (ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        snapshot();
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { publish("network"); }
            @Override public void onLost(Network network) { publish("network"); }
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { publish("network"); }
        };
        try { manager.registerDefaultNetworkCallback(callback); } catch (RuntimeException ignored) { callback=null; }
    }
    private synchronized JSObject snapshot() {
        JSObject state = new JSObject();
        try {
            Network network = manager.getActiveNetwork();
            NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
            String key = network == null ? "none" : network.toString();
            if (!key.equals(networkKey)) {
                networkKey=key;generation++;
                for (NativeReadTransport.Job job : jobs.values()) job.cancel("NETWORK_CHANGED");
            }
            boolean connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            String type = caps == null ? "none" : caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi" :
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "cellular" : caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? "ethernet" : "unknown";
            state.put("type",type);state.put("connected",connected);
            state.put("validated",caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
            state.put("metered",caps != null && !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED));
            state.put("vpn",caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN));
        } catch (RuntimeException ignored) { state.put("type","unknown"); }
        state.put("generation",generation);state.put("at",System.currentTimeMillis());return state;
    }
    private void publish(String reason) { JSObject state=snapshot();state.put("reason",reason);notifyListeners("connectionChanged",state); }
    @Override protected void handleOnResume() { if (manager != null) publish("resume"); }
    @Override protected void handleOnDestroy() {
        if (callback != null) { try { manager.unregisterNetworkCallback(callback); } catch (RuntimeException ignored) {} }
        for (NativeReadTransport.Job job : jobs.values()) job.cancel("REQUEST_ABORTED");
        jobs.clear();executor.shutdownNow();
    }
    @PluginMethod public void status(PluginCall call) { call.resolve(snapshot()); }
    @PluginMethod public void cancel(PluginCall call) {
        NativeReadTransport.Job job=jobs.get(call.getString("id",""));
        if (job != null) job.cancel(call.getString("reason","REQUEST_ABORTED"));call.resolve();
    }
    @PluginMethod public void read(PluginCall call) {
        snapshot();
        String id=call.getString("id","");
        if (!id.matches("[A-Za-z0-9-]{16,80}")) { call.reject("NATIVE_REQUEST_REJECTED","NATIVE_REQUEST_REJECTED");return; }
        NativeReadTransport.Job job=new NativeReadTransport.Job();
        if (jobs.putIfAbsent(id,job) != null) { call.reject("NATIVE_REQUEST_BUSY","NATIVE_REQUEST_BUSY");return; }
        try {
            executor.execute(() -> {
                try {
                    snapshot(); Network network=manager.getActiveNetwork();
                    if (network == null) throw new IOException("NETWORK_OFFLINE");
                    JSObject source=call.getObject("headers",new JSObject());Map<String,String> headers=new HashMap<>();
                    for (Iterator<String> keys=source.keys();keys.hasNext();) { String key=keys.next();headers.put(key,source.optString(key)); }
                    int limit=Math.max(1024,Math.min(16*1024*1024,call.getInt("maxBytes",4*1024*1024)));
                    NativeReadTransport.Result result=NativeReadTransport.read(call.getString("url",""),call.getString("body","{}"),headers,limit,job,
                        url -> (HttpURLConnection)network.openConnection(url));
                    JSObject reply=new JSObject(),responseHeaders=new JSObject();
                    for (Map.Entry<String,String> header : result.headers.entrySet()) responseHeaders.put(header.getKey(),header.getValue());
                    reply.put("id",id);reply.put("status",result.status);reply.put("body",result.body);reply.put("headers",responseHeaders);reply.put("network",snapshot());call.resolve(reply);
                } catch (Exception error) {
                    String code=NativeReadTransport.errorCode(error,job);JSObject detail=new JSObject();detail.put("network",snapshot());
                    call.reject(code,code,null,detail);
                } finally { jobs.remove(id,job); }
            });
        } catch (RuntimeException error) { jobs.remove(id,job);call.reject("NETWORK_BUSY","NETWORK_BUSY"); }
    }
}
