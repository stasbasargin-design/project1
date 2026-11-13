package ru.eazia.imax;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean working = new AtomicBoolean(), cancelled = new AtomicBoolean();
    private volatile HttpURLConnection connection;
    private volatile JSONObject release;
    private volatile File ready;
    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
    }
    private int signatureFlags() { return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES; }
    private long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode; }
    private String signer(PackageInfo info) throws Exception {
        if (info == null) throw new IOException("UPDATE_INVALID_SIGNATURE");
        Signature[] signatures = Build.VERSION.SDK_INT>=28&&info.signingInfo!=null?info.signingInfo.getApkContentsSigners():info.signatures;
        if (signatures == null || signatures.length != 1) throw new IOException("UPDATE_INVALID_SIGNATURE");
        return UpdatePolicy.hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }
    private HttpURLConnection open(String file) throws Exception {
        HttpURLConnection c = (HttpURLConnection) UpdatePolicy.endpoint(file).toURL().openConnection();
        connection=c;c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(20000);
        c.setRequestMethod("GET");c.setUseCaches(false);c.setRequestProperty("Accept",file.endsWith(".json")?"application/json":"application/vnd.android.package-archive");
        c.setRequestProperty("Accept-Encoding","identity");
        if (c.getResponseCode() != 200) throw new IOException("UPDATE_DOWNLOAD_FAILED");
        return c;
    }
    private void closeConnection() { HttpURLConnection c=connection;connection=null;if(c!=null)c.disconnect(); }
    private void failure(PluginCall call, Exception error) {
        String code = cancelled.get() ? "UPDATE_CANCELLED" : error.getMessage();
        if (code == null || !code.matches("UPDATE_[A-Z_]+")) code="UPDATE_NETWORK_ERROR";
        call.reject(code,code);
    }
    private void validate(JSONObject value, PackageInfo current) throws Exception {
        if(value.getInt("schema")!=1)throw new IOException("UPDATE_INVALID_MANIFEST");
        UpdatePolicy.validate(value.getString("version"),value.getLong("versionCode"),value.getString("fileName"),value.getLong("bytes"),
            value.getString("sha256"),value.getString("signerSha256"),value.getString("commit"),value.getString("packageName"),value.getInt("minSdk"));
        if(!signer(current).equals(value.getString("signerSha256")))throw new IOException("UPDATE_INCOMPATIBLE_SIGNATURE");
        if(Build.VERSION.SDK_INT<value.getInt("minSdk"))throw new IOException("UPDATE_INCOMPATIBLE_ANDROID");
    }
    @PluginMethod public void check(PluginCall call) {
        if(!working.compareAndSet(false,true)){call.reject("UPDATE_BUSY","UPDATE_BUSY");return;}
        cancelled.set(false);
        executor.execute(() -> {
            try {
                PackageInfo current=installed();HttpURLConnection c=open("latest.json");
                ByteArrayOutputStream buffer=new ByteArrayOutputStream();
                try(InputStream in=c.getInputStream()){byte[] bytes=new byte[4096];int n;while((n=in.read(bytes))!=-1){if(buffer.size()+n>32768)throw new IOException("UPDATE_INVALID_MANIFEST");buffer.write(bytes,0,n);}}
                JSONObject value=new JSONObject(buffer.toString("UTF-8"));JSObject result=new JSObject();
                result.put("installedVersion",current.versionName);result.put("installedCode",versionCode(current));
                if(!value.optBoolean("enabled",false)){release=null;result.put("available",false);call.resolve(result);return;}
                validate(value,current);boolean available=value.getLong("versionCode")>versionCode(current);
                release=available?value:null;result.put("available",available);
                if(available){result.put("version",value.getString("version"));result.put("versionCode",value.getLong("versionCode"));result.put("bytes",value.getLong("bytes"));result.put("notes",value.optJSONArray("notes"));}
                call.resolve(result);
            } catch(Exception error){failure(call,error);}finally{closeConnection();working.set(false);}
        });
    }
    @PluginMethod public void download(PluginCall call) {
        JSONObject value=release;
        if(value==null){call.reject("UPDATE_NOT_CHECKED","UPDATE_NOT_CHECKED");return;}
        if(!working.compareAndSet(false,true)){call.reject("UPDATE_BUSY","UPDATE_BUSY");return;}
        cancelled.set(false);ready=null;
        executor.execute(() -> {
            File partial=null;
            try {
                validate(value,installed());File directory=new File(getContext().getCacheDir(),"updates");
                if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("UPDATE_STORAGE_ERROR");
                File file=new File(directory,"I-MAX-update.apk");partial=new File(directory,"I-MAX-update.part");
                if(file.exists()&&!file.delete())throw new IOException("UPDATE_STORAGE_ERROR");
                long expected=value.getLong("bytes");if(directory.getUsableSpace()<expected+16*1024*1024)throw new IOException("UPDATE_STORAGE_FULL");
                HttpURLConnection c=open(value.getString("fileName"));
                if(c.getContentLengthLong()!=expected)throw new IOException("UPDATE_SIZE_MISMATCH");
                MessageDigest hash=MessageDigest.getInstance("SHA-256");long received=0,started=System.currentTimeMillis(),last=0;
                try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(partial)){
                    byte[] bytes=new byte[65536];int n;
                    while((n=in.read(bytes))!=-1){
                        if(cancelled.get())throw new IOException("UPDATE_CANCELLED");
                        if(System.currentTimeMillis()-started>5*60*1000)throw new IOException("UPDATE_DOWNLOAD_TIMEOUT");
                        received+=n;if(received>expected)throw new IOException("UPDATE_SIZE_MISMATCH");
                        hash.update(bytes,0,n);out.write(bytes,0,n);
                        if(System.currentTimeMillis()-last>250){JSObject progress=new JSObject();progress.put("received",received);progress.put("total",expected);notifyListeners("progress",progress);last=System.currentTimeMillis();}
                    }
                    out.getFD().sync();
                }
                if(received!=expected||!UpdatePolicy.matches(value.getString("sha256"),hash.digest()))throw new IOException("UPDATE_HASH_MISMATCH");
                verifyArchive(partial,value);
                if(cancelled.get())throw new IOException("UPDATE_CANCELLED");
                if(!partial.renameTo(file))throw new IOException("UPDATE_STORAGE_ERROR");
                ready=file;JSObject result=new JSObject();result.put("ready",true);call.resolve(result);
            }catch(Exception error){if(partial!=null)partial.delete();failure(call,error);}finally{closeConnection();working.set(false);}
        });
    }
    private void verifyArchive(File file, JSONObject value) throws Exception {
        PackageInfo archive=getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),signatureFlags());
        PackageInfo current=installed();
        if(archive==null||!archive.packageName.equals(current.packageName)||versionCode(archive)!=value.getLong("versionCode")
            ||versionCode(archive)<=versionCode(current)||!value.getString("version").equals(archive.versionName))throw new IOException("UPDATE_INVALID_APK");
        if(!signer(current).equals(signer(archive)))throw new IOException("UPDATE_INCOMPATIBLE_SIGNATURE");
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new java.io.FileInputStream(file)){byte[] bytes=new byte[65536];int n;while((n=in.read(bytes))!=-1)hash.update(bytes,0,n);}
        if(file.length()!=value.getLong("bytes")||!UpdatePolicy.matches(value.getString("sha256"),hash.digest()))throw new IOException("UPDATE_HASH_MISMATCH");
    }
    @PluginMethod public void install(PluginCall call) {
        if(ready==null||release==null){call.reject("UPDATE_NOT_READY","UPDATE_NOT_READY");return;}
        if(!working.compareAndSet(false,true)){call.reject("UPDATE_BUSY","UPDATE_BUSY");return;}
        executor.execute(() -> {
            try {
                verifyArchive(ready,release);
                getActivity().runOnUiThread(() -> {
                    try {
                        JSObject result=new JSObject();
                        if(Build.VERSION.SDK_INT>=26&&!getContext().getPackageManager().canRequestPackageInstalls()){
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())));
                            result.put("status","permission_required");
                        }else{
                            Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",ready);
                            Intent intent=new Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(intent);result.put("status","installer_opened");
                        }
                        call.resolve(result);
                    }catch(Exception error){failure(call,error);}finally{working.set(false);}
                });
            }catch(Exception error){failure(call,error);working.set(false);}
        });
    }
    @PluginMethod public void cancel(PluginCall call) { cancelled.set(true);closeConnection();call.resolve(); }
    @Override protected void handleOnDestroy(){cancelled.set(true);closeConnection();executor.shutdownNow();}
}
