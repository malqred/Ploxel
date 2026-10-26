Add-Type -AssemblyName System.Drawing

function New-PloxelBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = [int]($size * 0.22)
  $path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $path.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $path.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
  $path.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 140, 168, 146),
    [System.Drawing.Color]::FromArgb(255, 84, 112, 94),
    90
  )
  $g.FillPath($brush, $path)

  # изометрический куб
  $cx = $size * 0.5
  $cy = $size * 0.52
  $w = $size * 0.30
  $h = $size * 0.17

  $top = @(
    (New-Object System.Drawing.PointF($cx, ($cy - $h * 1.7))),
    (New-Object System.Drawing.PointF(($cx + $w), ($cy - $h))),
    (New-Object System.Drawing.PointF($cx, ($cy - $h * 0.3))),
    (New-Object System.Drawing.PointF(($cx - $w), ($cy - $h)))
  )
  $left = @(
    (New-Object System.Drawing.PointF(($cx - $w), ($cy - $h))),
    (New-Object System.Drawing.PointF($cx, ($cy - $h * 0.3))),
    (New-Object System.Drawing.PointF($cx, ($cy + $h * 1.25))),
    (New-Object System.Drawing.PointF(($cx - $w), ($cy + $h * 0.55)))
  )
  $right = @(
    (New-Object System.Drawing.PointF(($cx + $w), ($cy - $h))),
    (New-Object System.Drawing.PointF($cx, ($cy - $h * 0.3))),
    (New-Object System.Drawing.PointF($cx, ($cy + $h * 1.25))),
    (New-Object System.Drawing.PointF(($cx + $w), ($cy + $h * 0.55)))
  )

  $topBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 244, 232))
  $leftBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 216, 198))
  $rightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 205, 194, 174))

  $g.FillPolygon($topBrush, [System.Drawing.PointF[]]$top)
  $g.FillPolygon($leftBrush, [System.Drawing.PointF[]]$left)
  $g.FillPolygon($rightBrush, [System.Drawing.PointF[]]$right)

  # пиксельный акцент на верхней грани
  $dot = $size * 0.028
  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 126, 156, 137))
  $g.FillRectangle($accent, [single]($cx - $dot / 2), [single]($cy - $h * 1.05), [single]$dot, [single]$dot)

  $g.Dispose()
  return $bmp
}

$buildDir = Join-Path (Get-Location) 'build'
New-Item -ItemType Directory -Force $buildDir | Out-Null

$png = New-PloxelBitmap 512
$png.Save((Join-Path $buildDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$png.Dispose()

$ico = New-PloxelBitmap 256
$handle = $ico.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Create((Join-Path $buildDir 'icon.ico'))
$icon.Save($stream)
$stream.Close()
$ico.Dispose()

Write-Output "иконки готовы"