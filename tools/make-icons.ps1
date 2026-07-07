# Generates the OneSearch extension icons (16/32/48/128 px PNGs) into /icons.
# Usage: pwsh -File tools/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-Icon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background: rounded rect, indigo -> fuchsia gradient
    $radius = [Math]::Max(3.0, $size * 0.22)
    $path = New-RoundedRectPath 0 0 $size $size $radius
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 99, 102, 241),
        [System.Drawing.Color]::FromArgb(255, 217, 70, 239))
    $g.FillPath($brush, $path)

    # Magnifier lens
    $penW = [Math]::Max(1.6, $size * 0.085)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $penW)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cx = $size * 0.44; $cy = $size * 0.44; $r = $size * 0.23
    $g.DrawEllipse($pen, [float]($cx - $r), [float]($cy - $r), [float]($r * 2), [float]($r * 2))

    # Handle
    $hx1 = $cx + $r * 0.72; $hy1 = $cy + $r * 0.72
    $hx2 = $size * 0.80;    $hy2 = $size * 0.80
    $g.DrawLine($pen, [float]$hx1, [float]$hy1, [float]$hx2, [float]$hy2)

    # Rainbow dots inside the lens (skip at 16px, too small)
    if ($size -ge 32) {
        $dotColors = @(
            [System.Drawing.Color]::FromArgb(255, 255, 213, 74),
            [System.Drawing.Color]::FromArgb(255, 126, 242, 154),
            [System.Drawing.Color]::FromArgb(255, 126, 203, 255))
        $dr = $size * 0.045
        $positions = @(
            @(($cx - $r * 0.45), ($cy)),
            @(($cx), ($cy)),
            @(($cx + $r * 0.45), ($cy)))
        for ($i = 0; $i -lt 3; $i++) {
            $b = New-Object System.Drawing.SolidBrush($dotColors[$i])
            $px = $positions[$i][0]; $py = $positions[$i][1]
            $g.FillEllipse($b, [float]($px - $dr), [float]($py - $dr), [float]($dr * 2), [float]($dr * 2))
            $b.Dispose()
        }
    }

    $g.Dispose()
    $out = Join-Path $outDir ("icon{0}.png" -f $size)
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $out"
}

foreach ($s in 16, 32, 48, 128) { New-Icon $s }
