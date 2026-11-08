# test-chat-local.ps1 — Mesmo teste do test-chat.ps1, porém no servidor LOCAL
# Requer: bun run dev rodando (http://localhost:8080) — verificado via health do webhook.
# Uso: .\test-chat-local.ps1 "5519999999999" "Oi, preciso de ajuda com meu caso"

param(
  [string]$PHONE = "5519900000000",
  [string]$MSG = "Oi, tudo bem? Preciso de ajuda com meu caso."
)

$WEBHOOK = "http://localhost:8080/api/public/wapi-webhook?secret=lexia-webhook-2026"

$payload = @{
  instanceId = "LITE-JEI3LK-4S2HOW"
  message = @{
    key = @{
      remoteJid = "${PHONE}@s.whatsapp.net"
      fromMe = $false
    }
    message = @{
      conversation = $MSG
    }
    pushName = "Cliente Teste Local"
    from = "${PHONE}@s.whatsapp.net"
  }
} | ConvertTo-Json -Depth 5

Write-Host "[LOCAL] Enviando mensagem de $PHONE para $WEBHOOK ..." -ForegroundColor Cyan

try {
  $resp = Invoke-WebRequest -Uri $WEBHOOK -Method POST -Body $payload -ContentType "application/json" -UseBasicParsing
  Write-Host "Resposta: $($resp.StatusCode) $($resp.Content)" -ForegroundColor Green
} catch {
  $s = $_.Exception.Response.StatusCode.value__
  $body = ""
  try { $stream = $_.Exception.Response.GetResponseStream(); $reader = New-Object System.IO.StreamReader($stream); $body = $reader.ReadToEnd() } catch {}
  Write-Host "Erro HTTP $s : $body" -ForegroundColor Red
}
