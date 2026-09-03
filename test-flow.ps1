# test-flow.ps1 — Simula um fluxo completo de atendimento para testar o Kanban
# Envia 3 mensagens em sequência para ver se o Kanban avança corretamente

param(
  [string]$PHONE = "5519900001111"
)

$WEBHOOK = "https://crmlexia.com.br/api/public/wapi-webhook?secret=lexia-webhook-2026"

function Send-Msg($phone, $msg, $fromMe = $false) {
  $payload = @{
    instanceId = "LITE-JEI3LK-4S2HOW"
    message = @{
      key = @{
        remoteJid = "${phone}@s.whatsapp.net"
        fromMe = $fromMe
      }
      message = @{
        conversation = $msg
      }
      pushName = if ($fromMe) { "Sofia" } else { "Cliente Teste" }
      from = "${phone}@s.whatsapp.net"
    }
  } | ConvertTo-Json -Depth 5

  try {
    $resp = Invoke-WebRequest -Uri $WEBHOOK -Method POST -Body $payload -ContentType "application/json" -UseBasicParsing
    Write-Host "  -> $($resp.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "  -> ERRO: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host "=== TESTE: Fluxo Kanban ===" -ForegroundColor Yellow
Write-Host "Telefone: $PHONE" -ForegroundColor Cyan
Write-Host ""

# 1. Mensagem inicial (deve ficar em Etapa 1)
Write-Host "[1/3] Mensagem inicial - deve ficar em Etapa 1" -ForegroundColor White
Send-Msg $PHONE "Oi, tudo bem? Preciso de ajuda."
Start-Sleep -Seconds 3

# 2. Demonstra interesse (deve avancar para Etapa 2)
Write-Host "[2/3] Interesse - deve avancar para Etapa 2" -ForegroundColor White
Send-Msg $PHONE "Tenho interesse, quero saber valores"
Start-Sleep -Seconds 3

# 3. Pode agendar (deve avancar para Etapa 3)
Write-Host "[3/3] Agendamento - deve avancar para Etapa 3" -ForegroundColor White
Send-Msg $PHONE "Sim, vamos agendar uma call para discutir"
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "=== FIM === Verifique o Kanban no painel." -ForegroundColor Yellow
