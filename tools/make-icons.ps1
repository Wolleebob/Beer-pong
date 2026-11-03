# Gera os ícones PNG do PWA usando System.Drawing (Windows PowerShell).
# Uso: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath([double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-RadialGlow([double]$cx, [double]$cy, [double]$radius, [System.Drawing.Color]$center) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($cx - $radius, $cy - $radius, $radius * 2, $radius * 2)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $brush.CenterColor = $center
  $brush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $center.R, $center.G, $center.B))
  return @{ Path = $path; Brush = $brush }
}

function Draw-Background([System.Drawing.Graphics]$g, [bool]$rounded) {
  $rect = New-Object System.Drawing.RectangleF(0, 0, 512, 512)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 22, 31, 53),
    [System.Drawing.Color]::FromArgb(255, 5, 7, 13),
    90
  )
  if ($rounded) {
    $path = New-RoundedPath 0 0 512 512 112
    $g.FillPath($bg, $path)
    $path.Dispose()
  } else {
    $g.FillRectangle($bg, $rect)
  }
  $bg.Dispose()

  $pink = New-RadialGlow 120 80 260 ([System.Drawing.Color]::FromArgb(95, 255, 61, 113))
  $g.FillPath($pink.Brush, $pink.Path)
  $pink.Brush.Dispose(); $pink.Path.Dispose()

  $cyan = New-RadialGlow 430 450 240 ([System.Drawing.Color]::FromArgb(60, 56, 225, 242))
  $g.FillPath($cyan.Brush, $cyan.Path)
  $cyan.Brush.Dispose(); $cyan.Path.Dispose()

  # faint grid / speckles
  $rng = New-Object System.Random(7)
  for ($i = 0; $i -lt 26; $i++) {
    $x = $rng.Next(30, 482)
    $y = $rng.Next(30, 482)
    $s = $rng.Next(1, 4)
    $a = $rng.Next(12, 45)
    $c = [System.Drawing.Color]::FromArgb($a, 255, 235, 210)
    $brush = New-Object System.Drawing.SolidBrush($c)
    $g.FillEllipse($brush, $x, $y, $s, $s)
    $brush.Dispose()
  }
}

function Draw-Foreground([System.Drawing.Graphics]$g) {
  # neon halo behind the cup
  $halo = New-RadialGlow 256 290 190 ([System.Drawing.Color]::FromArgb(55, 255, 196, 92))
  $g.FillPath($halo.Brush, $halo.Path)
  $halo.Brush.Dispose(); $halo.Path.Dispose()

  # cup shadow
  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 0, 0, 0))
  $g.FillEllipse($shadow, 152, 388, 210, 34)
  $shadow.Dispose()

  # cup body
  $body = New-Object System.Drawing.Drawing2D.GraphicsPath
  $body.AddPolygon(@(
    (New-Object System.Drawing.PointF(171, 196)),
    (New-Object System.Drawing.PointF(341, 196)),
    (New-Object System.Drawing.PointF(314, 388)),
    (New-Object System.Drawing.PointF(198, 388))
  ))
  $bodyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(171, 196)),
    (New-Object System.Drawing.PointF(341, 388)),
    [System.Drawing.Color]::FromArgb(255, 255, 112, 132),
    [System.Drawing.Color]::FromArgb(255, 136, 12, 38)
  )
  $g.FillPath($bodyBrush, $body)
  $bodyBrush.Dispose()

  # left gloss
  $gloss = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gloss.AddPolygon(@(
    (New-Object System.Drawing.PointF(184, 208)),
    (New-Object System.Drawing.PointF(208, 208)),
    (New-Object System.Drawing.PointF(199, 378)),
    (New-Object System.Drawing.PointF(185, 378))
  ))
  $glossBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(48, 255, 255, 255))
  $g.FillPath($glossBrush, $gloss)
  $glossBrush.Dispose(); $gloss.Dispose()

  # cup bottom
  $bottomBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(198, 372)),
    (New-Object System.Drawing.PointF(314, 400)),
    [System.Drawing.Color]::FromArgb(255, 150, 14, 42),
    [System.Drawing.Color]::FromArgb(255, 96, 6, 26)
  )
  $g.FillEllipse($bottomBrush, 198, 372, 116, 30)
  $bottomBrush.Dispose()

  # cup opening
  $openBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 112, 12, 34))
  $g.FillEllipse($openBrush, 171, 180, 170, 34)
  $openBrush.Dispose()

  # beer
  $beerRect = New-Object System.Drawing.RectangleF(184, 187, 144, 22)
  $beerBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $beerRect,
    [System.Drawing.Color]::FromArgb(255, 255, 214, 122),
    [System.Drawing.Color]::FromArgb(255, 201, 116, 24),
    90
  )
  $g.FillEllipse($beerBrush, 184, 185, 144, 26)
  $beerBrush.Dispose()

  # foam
  $foamBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 255, 248, 226))
  $g.FillEllipse($foamBrush, 196, 186, 26, 12)
  $g.FillEllipse($foamBrush, 228, 182, 30, 14)
  $g.FillEllipse($foamBrush, 262, 187, 24, 11)
  $g.FillEllipse($foamBrush, 288, 185, 20, 10)
  $foamBrush.Dispose()

  # rim
  $rimPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235, 255, 226, 226), 6)
  $g.DrawEllipse($rimPen, 171, 180, 170, 34)
  $rimPen.Dispose()

  # neon accent ring around cup top
  $neonPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 255, 196, 92), 2)
  $g.DrawEllipse($neonPen, 160, 172, 192, 48)
  $neonPen.Dispose()

  # ping pong ball
  $ballShadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 0, 0, 0))
  $g.FillEllipse($ballShadow, 330, 172, 86, 78)
  $ballShadow.Dispose()

  $ballRect = New-Object System.Drawing.RectangleF(324, 120, 84, 84)
  $ballBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $ballRect,
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(255, 196, 187, 165),
    120
  )
  $g.FillEllipse($ballBrush, 324, 120, 84, 84)
  $ballBrush.Dispose()

  $shine = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 255, 255, 255))
  $g.FillEllipse($shine, 342, 136, 22, 16)
  $shine.Dispose()

  # sparkles
  $sparkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 255, 196, 92), 4)
  $g.DrawLine($sparkPen, 104, 150, 104, 174)
  $g.DrawLine($sparkPen, 92, 162, 116, 162)
  $sparkPen.Dispose()

  $sparkPen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 56, 225, 242), 3)
  $g.DrawLine($sparkPen2, 420, 268, 420, 286)
  $g.DrawLine($sparkPen2, 411, 277, 429, 277)
  $sparkPen2.Dispose()
}

function New-Icon([int]$size, [string]$file, [bool]$maskable = $false, [bool]$rounded = $true) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $scale = $size / 512.0
  $g.ScaleTransform($scale, $scale)

  Draw-Background $g $rounded

  if ($maskable) {
    $g.TranslateTransform(256, 256)
    $g.ScaleTransform(0.78, 0.78)
    $g.TranslateTransform(-256, -256)
  }
  Draw-Foreground $g

  $g.Dispose()
  $path = Join-Path $outDir $file
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "ok: $file"
}

New-Icon 192 'icon-192.png'
New-Icon 512 'icon-512.png'
New-Icon 512 'maskable-512.png' $true $false
New-Icon 180 'apple-touch-icon.png' $false $false
New-Icon 64 'favicon.png'
