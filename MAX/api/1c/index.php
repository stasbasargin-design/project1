<?php
require __DIR__ . '/config.php';
$target = rtrim(getenv('ONE_C_TARGET') ?: ITUS_ONE_C_TARGET, '/');
$token  = getenv('ONE_C_TOKEN') ?: ITUS_ONE_C_TOKEN;
function itus_json($code, $body) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($body, JSON_UNESCAPED_UNICODE);
  exit;
}
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$suffix = substr($path, strlen('/api/1c'));
if ($suffix === false || $suffix === '') itus_json(400, ['success'=>false,'error'=>['code'=>'BAD_API_PATH','message'=>'Не указан метод 1С']]);
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { header('Allow: POST, OPTIONS'); http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') itus_json(405, ['success'=>false,'error'=>['code'=>'METHOD_NOT_ALLOWED','message'=>'Используйте POST']]);
$body = file_get_contents('php://input');
if (strlen($body) > 31457280) itus_json(413, ['success'=>false,'error'=>['code'=>'PAYLOAD_TOO_LARGE','message'=>'Тело запроса превышает 30 МБ']]);
if (!function_exists('curl_init')) itus_json(500, ['success'=>false,'error'=>['code'=>'NO_CURL','message'=>'На хостинге не включён PHP curl']]);
$headers = ['Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? 'application/json; charset=utf-8')];
$reqToken = $_SERVER['HTTP_X_ITUS_TOKEN'] ?? '';
if ($token || $reqToken) $headers[] = 'X-ITUS-Token: ' . ($token ?: $reqToken);
if (isset($_SERVER['HTTP_X_ITUS_REQUEST_ID'])) $headers[] = 'X-ITUS-Request-Id: ' . $_SERVER['HTTP_X_ITUS_REQUEST_ID'];
$ch = curl_init($target . $suffix);
curl_setopt_array($ch, [
  CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 35, CURLOPT_HTTPHEADER => $headers,
]);
$res = curl_exec($ch);
if ($res === false) {
  $errno = curl_errno($ch); $err = curl_error($ch); curl_close($ch);
  itus_json($errno === 28 ? 504 : 502, ['success'=>false,'error'=>['code'=>$errno === 28 ? 'ONE_C_TIMEOUT' : 'ONE_C_PROXY_ERROR','message'=>$errno === 28 ? 'Истекло время ожидания ответа 1С' : $err]]);
}
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);
http_response_code($code ?: 200);
header('Content-Type: ' . ($ctype ?: 'application/json; charset=utf-8'));
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo $res;
