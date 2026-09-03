# test-chat.ps1 — Simula uma conversa nova no webhook para testar o Kanban
# Uso: .\test-chat.ps1 "5519999999999" "Oi, preciso de ajuda com meu caso"

param(
  [string]$PHONE = "5519900000000",
  [string]$MSG = "Oi, tudo bem? Preciso de ajuda com meu caso."
)

$WEBHOOK = "https://crmlexia.com.br/api/public/wapi-webhook?secret=lexia-webhook-2026"

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
    pushName = "Cliente Teste"
    from = "${PHONE}@s.whatsapp.net"
  }
} | ConvertTo-Json -Depth 5

Write-Host "Enviando mensagem de $PHONE..." -ForegroundColor Cyan
Write-Host "Payload:" -ForegroundColor Gray
Write-Host $payload -ForegroundColor DarkGray

try {
  $resp = Invoke-WebRequest -Uri $WEBHOOK -Method POST -Body $payload -ContentType "application/json" -UseBasicParsing
  Write-Host "Resposta: $($resp.StatusCode) $($resp.Content)" -ForegroundColor Green
} catch {
  Write-Host "Erro: $($_.Exception.Message)" -ForegroundColor Red
}
