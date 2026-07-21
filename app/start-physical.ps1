$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.*" -or $_.IPAddress -like "10.*" } | Select-Object -First 1).IPAddress
$env:EXPO_PUBLIC_API_URL = "http://$($ip):3001"
npx expo start
