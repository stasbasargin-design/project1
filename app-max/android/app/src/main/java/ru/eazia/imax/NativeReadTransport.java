package ru.eazia.imax;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Metadata reads and write-only diagnostic reports; never business writes or files. */
public final class NativeReadTransport {
    public static final Set<String> ROUTES = new HashSet<>(Arrays.asList(
        "/auth/max", "/ping", "/orders/list", "/orders/get", "/orders/search",
        "/notifications/poll", "/internal-chat/groups/list", "/internal-chat/contacts/list",
        "/internal-chat/messages/list", "/clients/topics/list", "/clients/messages/list"
    ));
    public interface Opener { HttpURLConnection open(URL url) throws Exception; }
    public static final class Job {
        private volatile HttpURLConnection connection;
        private volatile String cancellation;
        public synchronized void attach(HttpURLConnection value) throws IOException {
            connection = value;
            check();
        }
        public synchronized void cancel(String code) {
            cancellation = "NETWORK_CHANGED".equals(code) ? code : "REQUEST_ABORTED";
            HttpURLConnection current=connection;
            if (current != null) java.util.concurrent.CompletableFuture.runAsync(current::disconnect);
        }
        public void check() throws IOException { if (cancellation != null) throw new IOException(cancellation); }
        public String cancellation() { return cancellation; }
    }
    public static final class Result {
        public int status;
        public String body;
        public Map<String,String> headers = new HashMap<>();
    }
    public static URL validate(String value) throws Exception {
        URI uri = new URI(value);
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || (uri.getPort() != -1 && uri.getPort() != 443)) throw new IOException("NATIVE_URL_REJECTED");
        String host = uri.getHost(), path = uri.getRawPath(), prefix;
        if ("ea-itus.ru".equals(host)) prefix = "/p/max-service/";
        else if ("max-test.ea-itus.ru".equals(host)) prefix = "/";
        else throw new IOException("NATIVE_URL_REJECTED");
        if (!path.startsWith(prefix)) throw new IOException("NATIVE_URL_REJECTED");
        String suffix = path.substring(prefix.length());
        if (suffix.startsWith("contours/production/")) suffix = suffix.substring("contours/production/".length());
        if (suffix.equals("api/environments/config") || suffix.equals("api/diagnostics/events")) return uri.toURL();
        if (!suffix.startsWith("api/1c/") || !ROUTES.contains(suffix.substring("api/1c".length()))) throw new IOException("NATIVE_ROUTE_REJECTED");
        return uri.toURL();
    }
    public static Result read(String url, String body, Map<String,String> headers, int limit, Job job, Opener opener) throws Exception {
        URL target = validate(url);
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 262144) throw new IOException("NATIVE_BODY_REJECTED");
        HttpURLConnection connection = null;
        try {
            job.check(); connection = opener.open(target); job.attach(connection);
            connection.setConnectTimeout(10000); connection.setReadTimeout(20000);
            connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            boolean get=target.getPath().endsWith("/api/environments/config");
            connection.setRequestMethod(get?"GET":"POST"); connection.setDoOutput(!get);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Connection", "close");
            for (Map.Entry<String,String> header : headers.entrySet()) {
                String key = header.getKey().toLowerCase(Locale.ROOT);
                if (key.equals("x-itus-request-id") || key.equals("x-itus-token") || (key.equals("x-itus-diagnostics-token")&&target.getPath().endsWith("/api/diagnostics/events"))) connection.setRequestProperty(header.getKey(), header.getValue());
            }
            if(!get){
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream stream = connection.getOutputStream()) { job.check(); stream.write(bytes); }
            }
            job.check(); Result result = new Result(); result.status = connection.getResponseCode();
            for (String name : Arrays.asList("Content-Type", "Cache-Control", "X-ITUS-Diagnostics-Token")) {
                String value = connection.getHeaderField(name); if (value != null) result.headers.put(name,value);
            }
            InputStream input = result.status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (stream != null) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = stream.read(buffer)) != -1) {
                        job.check(); if (output.size()+count > limit) throw new IOException("ONE_C_RESPONSE_TOO_LARGE");
                        output.write(buffer,0,count);
                    }
                }
                result.body = output.toString("UTF-8");
            }
            job.check(); return result;
        } finally { if (connection != null) connection.disconnect(); }
    }
    public static String errorCode(Exception error, Job job) {
        if (job.cancellation() != null) return job.cancellation();
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof javax.net.ssl.SSLException) return "NETWORK_TLS";
            if (cause instanceof java.net.UnknownHostException) return "NETWORK_DNS";
            if (cause instanceof java.net.SocketTimeoutException) return "NETWORK_TIMEOUT";
            if (cause instanceof java.net.NoRouteToHostException || cause instanceof java.net.ConnectException) return "NETWORK_CONNECT";
        }
        String message=error.getMessage();
        if (Arrays.asList("NATIVE_URL_REJECTED","NATIVE_ROUTE_REJECTED","NATIVE_BODY_REJECTED","ONE_C_RESPONSE_TOO_LARGE","NETWORK_OFFLINE").contains(message)) return message;
        return "NETWORK_IO";
    }
}
