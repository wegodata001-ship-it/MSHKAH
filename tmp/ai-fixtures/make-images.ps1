Add-Type -AssemblyName System.Drawing
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$png = Join-Path $dir "invoice.png"
$jpg = Join-Path $dir "invoice.jpg"
$bmp = New-Object System.Drawing.Bitmap 900, 700
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font "Arial", 16
$brush = [System.Drawing.Brushes]::Black
$y = 20
$lines = @(
  "TAX INVOICE",
  "Supplier: Barilla Israel Ltd",
  "Tax ID: 512345678",
  "Invoice #: INV-7788",
  "Date: 2026-10-01",
  "Currency: ILS",
  "Barilla Pasta 5KG  x2  unit  25.00  VAT 4.50  line 50.00",
  "Cooking Cream 1L    x6  unit  12.00  VAT 12.96 line 72.00",
  "Subtotal 103.54",
  "VAT 18.46",
  "Total 122.00"
)
foreach ($line in $lines) {
  $g.DrawString($line, $font, $brush, 20, $y)
  $y += 28
}
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($jpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$g.Dispose()
$bmp.Dispose()
