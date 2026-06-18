<?php
// Relay front-controller (Cloudways PHP stack — no Nginx /api proxy available).
// Reverse-proxies /api/* to the local Node API on 127.0.0.1:8787, and serves the
// static SPA shell for everything else.
//
// This file lives in public/ so Vite copies it into dist/ on build; the deploy
// then rsyncs it into the webroot. KEEP IT in the deployed bundle — without it,
// /api 404s and login breaks (there is no Nginx reverse proxy on this stack).

$uri  = $_SERVER['REQUEST_URI'];
$path = parse_url($uri, PHP_URL_PATH);

if (strpos($path, '/api/') === 0 || $path === '/api') {
    $target = 'http://127.0.0.1:8787' . $uri;
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    $ch = curl_init($target);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);

    if (in_array($method, ['POST','PUT','PATCH','DELETE'], true)) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
    }

    $fwd = [];
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            $lk = strtolower($k);
            if (in_array($lk, ['host','content-length','connection','accept-encoding'], true)) continue;
            $fwd[] = "$k: $v";
        }
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $fwd);

    $resp = curl_exec($ch);
    if ($resp === false) {
        http_response_code(502);
        header('Content-Type: application/json');
        header('Cache-Control: no-store, private');
        echo json_encode(['error' => 'Bad gateway', 'detail' => curl_error($ch)]);
        exit;
    }

    $status     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $rawHeaders = substr($resp, 0, $headerSize);
    $body       = substr($resp, $headerSize);
    curl_close($ch);

    http_response_code($status);
    foreach (explode("\r\n", $rawHeaders) as $hl) {
        if (stripos($hl, 'Location:') === 0
            || stripos($hl, 'Content-Type:') === 0
            || stripos($hl, 'Set-Cookie:') === 0) {
            header($hl, false);
        }
    }
    header('Cache-Control: no-store, private');
    echo $body;
    exit;
}

// SPA shell
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache');
readfile(__DIR__ . '/index.html');
