package ru.eazia.imax;
import java.io.IOException;
import java.security.MessageDigest;
public final class UpdatePolicyTest {
    interface Action { void run() throws Exception; }
    static void rejected(Action action) throws Exception {try{action.run();throw new AssertionError("Unsafe release accepted");}catch(IOException expected){}}
    public static void main(String[] args) throws Exception {
        String hash="a".repeat(64),commit="b".repeat(40);
        UpdatePolicy.validate("2.9.0",2900,"I-MAX-2.9.0.apk",1024,hash,hash,commit,"ru.eazia.imax",24);
        if(!UpdatePolicy.endpoint("latest.json").toString().equals(UpdatePolicy.BASE+"latest.json"))throw new AssertionError();
        for(String file:new String[]{"https://evil.test/a.apk","../a.apk","I-MAX-2.9.0.apk?redirect=1","I-MAX-2.9.0.apk/../a","latest.json#test","I-MAX-2.9.0.apk%00"})rejected(()->UpdatePolicy.endpoint(file));
        rejected(()->UpdatePolicy.validate("2.9.0",2900,"../private.apk",1024,hash,hash,commit,"ru.eazia.imax",24));
        rejected(()->UpdatePolicy.validate("2.9.0",2900,"I-MAX-2.9.0.apk",UpdatePolicy.MAX_BYTES+1,hash,hash,commit,"ru.eazia.imax",24));
        rejected(()->UpdatePolicy.validate("2.9.0",2900,"I-MAX-2.9.0.apk",1024,hash,hash,commit,"other.app",24));
        rejected(()->UpdatePolicy.validate("2.9.0",2900,"I-MAX-2.9.0.apk",1024,"broken",hash,commit,"ru.eazia.imax",24));
        rejected(()->UpdatePolicy.validate("2.9.0",0,"I-MAX-2.9.0.apk",1024,hash,hash,commit,"ru.eazia.imax",24));
        byte[] digest=MessageDigest.getInstance("SHA-256").digest("original apk".getBytes());
        if(!UpdatePolicy.matches(UpdatePolicy.hex(digest),digest)||UpdatePolicy.matches(hash,digest))throw new AssertionError("Digest check");
        System.out.println("Native update policy: fixed HTTPS origin, paths, package, version, size, hash and signer format passed");
    }
}
