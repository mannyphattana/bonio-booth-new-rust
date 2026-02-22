$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content C:\Users\User\.tauri\bonio-booth.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "P@ssw9rd"
npm run tauri build
6995e01564565cc4b09ec6be
50000