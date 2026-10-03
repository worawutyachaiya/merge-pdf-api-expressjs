$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Await-WinRt($operation, [Type]$resultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
    $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.ToString().StartsWith('Windows.Foundation.IAsyncOperation`1')
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod(@($resultType)).Invoke($null, @($operation))
  return $task.GetAwaiter().GetResult()
}

function Await-WinRtAction($operation) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.ToString() -eq 'Windows.Foundation.IAsyncAction'
  } | Select-Object -First 1
  $task = $method.Invoke($null, @($operation))
  [void]$task.GetAwaiter().GetResult()
}

$inputPath = $env:MERGE_PDF_THUMB_INPUT
$outputDir = $env:MERGE_PDF_THUMB_OUTPUT
if (-not $inputPath -or -not $outputDir -or -not (Test-Path -LiteralPath $inputPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $outputDir -PathType Container)) {
  throw 'Thumbnail input or output path is missing'
}

$fileAsync = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]::GetFileFromPathAsync($inputPath)
$file = Await-WinRt $fileAsync ([Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime])
$pdfAsync = [Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime]::LoadFromFileAsync($file)
$pdf = Await-WinRt $pdfAsync ([Windows.Data.Pdf.PdfDocument,Windows.Data.Pdf,ContentType=WindowsRuntime])
if ($pdf.PageCount -lt 1 -or $pdf.PageCount -gt 500) { throw 'Unsupported PDF page count' }

$options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$options.DestinationWidth = [uint32]240
for ($index = 0; $index -lt $pdf.PageCount; $index++) {
  $page = $pdf.GetPage($index)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  try {
    Await-WinRtAction ($page.RenderToStreamAsync($stream, $options))
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    try {
      [void](Await-WinRt ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
      $bytes = New-Object byte[] $stream.Size
      $reader.ReadBytes($bytes)
      $outputPath = Join-Path $outputDir ('page-{0}.png' -f ($index + 1))
      [System.IO.File]::WriteAllBytes($outputPath, $bytes)
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
    $page.Dispose()
  }
}
