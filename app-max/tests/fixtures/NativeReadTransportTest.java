package ru.eazia.imax;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.*;

public final class NativeReadTransportTest {
 public static void main(String[] args) throws Exception {
  String base="https://ea-itus.ru/p/max-service/contours/production/api/1c";
  for(String route:NativeReadTransport.ROUTES) NativeReadTransport.validate(base+route);
  for(String url:Arrays.asList(base+"/defects/entries/add",base+"/acceptance/complete",base+"/defects/complete",base+"/clients/messages/send",base+"/internal-chat/messages/read",base+"/orders/get?x=1",base+"/orders/get#fragment",base+"/%6frders/get","http://ea-itus.ru/p/max-service/api/1c/orders/list","https://ea-itus.ru.evil.test/p/max-service/api/1c/orders/list","https://user:pass@ea-itus.ru/p/max-service/api/1c/orders/list")) {
   boolean denied=false;try{NativeReadTransport.validate(url);}catch(Exception expected){denied=true;}if(!denied)throw new AssertionError("Unsafe URL accepted");
  }
  AtomicInteger count=new AtomicInteger(),status=new AtomicInteger(200);
  AtomicReference<String> method=new AtomicReference<>(),body=new AtomicReference<>(),id=new AtomicReference<>(),output=new AtomicReference<>("{\"success\":true}");
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/",exchange->{count.incrementAndGet();method.set(exchange.getRequestMethod());body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));id.set(exchange.getRequestHeaders().getFirst("X-ITUS-Request-Id"));byte[] bytes=output.get().getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("X-ITUS-Diagnostics-Token","fixture-write-only");exchange.getResponseHeaders().set("Location","http://127.0.0.1:"+server.getAddress().getPort()+"/redirect");exchange.sendResponseHeaders(status.get(),bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});server.start();
  NativeReadTransport.Opener opener=ignored->(HttpURLConnection)new URL("http://127.0.0.1:"+server.getAddress().getPort()+"/").openConnection();
  try {
   Map<String,String> headers=new HashMap<>();headers.put("X-ITUS-Request-Id","same-read-request");headers.put("Authorization","NEVER_FORWARD");
   String raw="{\"requestId\":\"same-read-request\",\"userId\":\"synthetic\"}";
   NativeReadTransport.Result result=NativeReadTransport.read(base+"/orders/list",raw,headers,4096,new NativeReadTransport.Job(),opener);
   if(result.status!=200||!result.body.equals(output.get())||!body.get().equals(raw)||!id.get().equals("same-read-request")||!method.get().equals("POST"))throw new AssertionError("Native request changed");
   if(!result.headers.get("X-ITUS-Diagnostics-Token").equals("fixture-write-only"))throw new AssertionError("Auth header missing");
   NativeReadTransport.read("https://max-test.ea-itus.ru/api/environments/config","{}",headers,4096,new NativeReadTransport.Job(),opener);
   if(!method.get().equals("GET")||!body.get().isEmpty())throw new AssertionError("Configuration is not a GET");
   int before=count.get();status.set(422);result=NativeReadTransport.read(base+"/orders/list",raw,headers,4096,new NativeReadTransport.Job(),opener);
   if(result.status!=422||count.get()!=before+1)throw new AssertionError("Business validation retried");
   status.set(302);before=count.get();result=NativeReadTransport.read(base+"/orders/list",raw,headers,4096,new NativeReadTransport.Job(),opener);
   if(result.status!=302||count.get()!=before+1)throw new AssertionError("Redirect followed");
   status.set(200);output.set("x".repeat(20000));boolean limited=false;
   try{NativeReadTransport.read(base+"/orders/list",raw,headers,4096,new NativeReadTransport.Job(),opener);}catch(IOException error){limited=error.getMessage().equals("ONE_C_RESPONSE_TOO_LARGE");}
   if(!limited)throw new AssertionError("Response not bounded");
   NativeReadTransport.Job canceled=new NativeReadTransport.Job();canceled.cancel("NETWORK_CHANGED");before=count.get();
   try{NativeReadTransport.read(base+"/orders/list",raw,headers,4096,canceled,opener);throw new AssertionError("Cancelled read accepted");}catch(IOException expected){}
   if(count.get()!=before)throw new AssertionError("Cancelled request sent");
   if(!NativeReadTransport.errorCode(new UnknownHostException("PRIVATE_DNS"),new NativeReadTransport.Job()).equals("NETWORK_DNS"))throw new AssertionError();
   if(!NativeReadTransport.errorCode(new javax.net.ssl.SSLHandshakeException("PRIVATE_TLS"),new NativeReadTransport.Job()).equals("NETWORK_TLS"))throw new AssertionError();
   if(!NativeReadTransport.errorCode(new SocketTimeoutException("PRIVATE_TIMEOUT"),new NativeReadTransport.Job()).equals("NETWORK_TIMEOUT"))throw new AssertionError();
   System.out.println("Native HTTPS reader: URL/write allowlist, exact request identity/body, GET config, HTTP422 without retry, redirects blocked, size bound, cancellation and safe DNS/TLS/timeout codes passed");
  } finally {server.stop(0);}
 }
}
