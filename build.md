$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content C:\Users\User\.tauri\bonio-booth.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build