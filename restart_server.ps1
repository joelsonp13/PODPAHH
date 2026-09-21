$p = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($p) {
    Stop-Process -Id $p -Force
    Write-Host "Killed process $p"
} else {
    Write-Host "No process on port 3000"
}
Start-Sleep -Seconds 1
Start-Process -FilePath 'node' -ArgumentList 'C:\Users\Natanael\Documents\podpahh\pedevapor-shop\server\index.js' -WorkingDirectory 'C:\Users\Natanael\Documents\podpahh\pedevapor-shop' -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host 'Server restarted'
