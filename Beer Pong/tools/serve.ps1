# Servidor estático simples para testar o PWA localmente (sem Node/Python).
# Uso: powershell -ExecutionPolicy Bypass -File tools/serve.ps1
param(
  [int]$Port = 4173,
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
}

Write-Host "Beer Pong em http://localhost:$Port/ (Ctrl+C para parar)"
Write-Host "Raiz: $Root"

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $path = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($path) -or $path -eq '/') { $path = '/index.html' }

    $relative = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $file = Join-Path $Root $relative

    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $contentType = $types[$ext]
      if (-not $contentType) { $contentType = 'application/octet-stream' }
      $response.ContentType = $contentType
      $response.Headers.Add('Cache-Control', 'no-store')
      $response.Headers.Add('Service-Worker-Allowed', '/')
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $response.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 - arquivo nao encontrado')
      $response.ContentType = 'text/plain; charset=utf-8'
      $response.ContentLength64 = $body.Length
      $response.OutputStream.Write($body, 0, $body.Length)
    }
    $response.Close()
  } catch {
    # ignora conexões abortadas pelo navegador
  }
}
