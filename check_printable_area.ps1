# Print test: compare printable area between normal and CUT printer drivers
# Usage: Run this on the machine with the printer connected

$printerName = Read-Host "Enter printer name (e.g. DS-RX1)"

# Find CUT variant
$cutCandidates = @(
    "$printerName (CUT)",
    "$printerName (Cut)",
    "$printerName CUT",
    "$printerName Cut"
)
$cutName = $null
foreach ($c in $cutCandidates) {
    if (Get-Printer -Name $c -ErrorAction SilentlyContinue) {
        $cutName = $c
        break
    }
}

Write-Host ""
Write-Host "=== Normal Printer: '$printerName' ==="

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PrinterCaps {
    [DllImport("gdi32.dll")] public static extern IntPtr CreateDCW(string driver, string device, string port, IntPtr devMode);
    [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr hdc, int index);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
}
'@ -ErrorAction SilentlyContinue

function Get-PrinterCaps($name) {
    $hdc = [PrinterCaps]::CreateDCW("WINSPOOL", $name, $null, [IntPtr]::Zero)
    if ($hdc -eq [IntPtr]::Zero) {
        Write-Host "  ERROR: Cannot create DC for '$name'"
        return
    }
    $horzRes   = [PrinterCaps]::GetDeviceCaps($hdc, 8)   # HORZRES
    $vertRes   = [PrinterCaps]::GetDeviceCaps($hdc, 10)  # VERTRES
    $horzSize  = [PrinterCaps]::GetDeviceCaps($hdc, 4)   # HORZSIZE (mm)
    $vertSize  = [PrinterCaps]::GetDeviceCaps($hdc, 6)   # VERTSIZE (mm)
    $logPixelsX = [PrinterCaps]::GetDeviceCaps($hdc, 88) # LOGPIXELSX (DPI X)
    $logPixelsY = [PrinterCaps]::GetDeviceCaps($hdc, 90) # LOGPIXELSY (DPI Y)
    $physW     = [PrinterCaps]::GetDeviceCaps($hdc, 110) # PHYSICALWIDTH
    $physH     = [PrinterCaps]::GetDeviceCaps($hdc, 111) # PHYSICALHEIGHT
    $physOffX  = [PrinterCaps]::GetDeviceCaps($hdc, 112) # PHYSICALOFFSETX
    $physOffY  = [PrinterCaps]::GetDeviceCaps($hdc, 113) # PHYSICALOFFSETY
    [PrinterCaps]::DeleteDC($hdc) | Out-Null

    Write-Host "  Printable Area : ${horzRes} x ${vertRes} px"
    Write-Host "  Printable Size : ${horzSize} x ${vertSize} mm"
    Write-Host "  DPI            : ${logPixelsX} x ${logPixelsY}"
    Write-Host "  Physical Paper : ${physW} x ${physH} px"
    Write-Host "  Physical Offset: (${physOffX}, ${physOffY}) px"
    Write-Host "  Aspect Ratio   : $([math]::Round($horzRes / $vertRes, 4))"
    Write-Host ""
}

Get-PrinterCaps $printerName

if ($cutName) {
    Write-Host "=== CUT Printer: '$cutName' ==="
    Get-PrinterCaps $cutName
} else {
    Write-Host "No CUT driver variant found for '$printerName'"
    Write-Host "Tried: $($cutCandidates -join ', ')"
}
