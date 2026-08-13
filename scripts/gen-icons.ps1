param(
  [string]$SourceIcon = "public\app-icon.png"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$iconsDir = "public\icons"
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

function Save-Png($bmp, $path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Created $path"
}

function New-Placeholder([int]$Size, [string]$Out, [int]$Inset) {
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(46, 107, 39))
  $g.FillRectangle($bg, 0, 0, $Size, $Size)

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF($Inset, $Inset, ($Size - (2 * $Inset)), ($Size - (2 * $Inset)))

  $fontSize = [float](($Size - (2 * $Inset)) * 0.30)
  $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString("DPAD", $font, $white, $rect, $sf)

  Save-Png $bmp $Out
}

function Resize-Png([string]$Src, [int]$Size, [string]$Out) {
  $img = [System.Drawing.Image]::FromFile((Resolve-Path $Src))
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.DrawImage($img, 0, 0, $Size, $Size)
  Save-Png $bmp $Out
  $img.Dispose()
}

function New-Maskable([string]$Src, [int]$Size, [string]$Out) {
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::FromArgb(255, 46, 107, 39))
  $img = [System.Drawing.Image]::FromFile((Resolve-Path $Src))
  $inset = [int]($Size * 0.08)
  $g.DrawImage($img, $inset, $inset, ($Size - (2 * $inset)), ($Size - (2 * $inset)))
  Save-Png $bmp $Out
  $img.Dispose()
}

if (Test-Path $SourceIcon) {
  Write-Host "Using source icon: $SourceIcon"
  Resize-Png $SourceIcon 512 "$iconsDir\icon-512.png"
  Resize-Png $SourceIcon 192 "$iconsDir\icon-192.png"
  Resize-Png $SourceIcon 180 "$iconsDir\apple-touch-icon-180.png"
  Resize-Png $SourceIcon 64 "$iconsDir\favicon.png"
  New-Maskable $SourceIcon 512 "$iconsDir\icon-maskable-512.png"
} else {
  Write-Host "Source icon missing - generating DPAD placeholder."
  New-Placeholder 512 "public\app-icon.png" 0
  New-Placeholder 512 "$iconsDir\icon-512.png" 0
  New-Placeholder 192 "$iconsDir\icon-192.png" 0
  New-Placeholder 180 "$iconsDir\apple-touch-icon-180.png" 0
  New-Placeholder 64 "$iconsDir\favicon.png" 0
  New-Placeholder 512 "$iconsDir\icon-maskable-512.png" 41
}
Write-Host "Done. To use your own icon, replace public\app-icon.png with a 512x512 PNG and re-run this script."
