package ru.eazia.imax;

import java.io.IOException;
import java.net.URI;
import java.security.MessageDigest;

/** Pure policy shared by the Android updater and executable JVM tests. */
public final class UpdatePolicy {
    public static final String BASE = "https://ea-itus.ru/p/max-service/updates/android/";
    public static final long MAX_BYTES = 256L * 1024 * 1024;
    public static void validate(String version, long code, String file, long size, String hash,
                                String signer, String commit, String packageName, int minSdk) throws IOException {
        if (!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") || code < 1 || code > 2100000000L
            || !file.equals("I-MAX-" + version + ".apk") || size < 1 || size > MAX_BYTES
            || !hash.matches("[a-f0-9]{64}") || !signer.matches("[a-f0-9]{64}")
            || !commit.matches("[a-f0-9]{40}") || !packageName.equals("ru.eazia.imax") || minSdk != 24)
            throw new IOException("UPDATE_INVALID_MANIFEST");
    }
    public static URI endpoint(String file) throws IOException {
        if (!file.equals("latest.json") && !file.matches("I-MAX-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk"))
            throw new IOException("UPDATE_INVALID_URL");
        return URI.create(BASE + file);
    }
    public static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();for (byte b : bytes) out.append(String.format("%02x", b & 255));return out.toString();
    }
    public static boolean matches(String expected, byte[] actual) {
        return MessageDigest.isEqual(expected.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
            hex(actual).getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    }
    private UpdatePolicy() {}
}
