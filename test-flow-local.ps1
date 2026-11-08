# test-flow-local.ps1 — Fluxo completo do test-flow.ps1 apontando para o LOCAL
# Requer: bun run dev rodando (http://localhost:8080)

param(
  [string]$PHONE = "5519900001111"
)

$WEBHOOK = "http://localhost:8080/api/public/wapi-webhook?secret=lexia-webhook-2026"

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
      pushName = if ($fromMe) { "Sofia" } else { "Cliente Teste Local" }
      from = "${phone}@s.whatsapp.net"
    }
  } | ConvertTo-Json -Depth 5

  try {
    $resp = Invoke-WebRequest -Uri $WEBHOOK -Method POST -Body $payload -ContentType "application/json" -UseBasicParsing
    Write-Host "  -> $($resp.StatusCode)" -ForegroundColor Green
  } catch {
    $s = $_.Exception.Response.StatusCode.value__
    $body = ""
    try { $stream = $_.Exception.Response.GetResponseStream(); $reader = New-Object System.IO.StreamReader($stream); $body = $reader.ReadToEnd() } catch {}
    Write-Host "  -> ERRO HTTP $s : $body" -ForegroundColor Red
  }
}

Write-Host "=== TESTE LOCAL: Fluxo Kanban ===" -ForegroundColor Yellow
Write-Host "Telefone: $PHONE | Webhook: $WEBHOOK" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Mensagem inicial - deve ficar em Etapa 1" -ForegroundColor White
Send-Msg $PHONE "Oi, tudo bem? Preciso de ajuda."
Start-Sleep -Seconds 3

Write-Host "[2/3] Interesse - deve avancar para Etapa 2" -ForegroundColor White
Send-Msg $PHONE "Tenho interesse, quero saber valores"
Start-Sleep -Seconds 3

Write-Host "[3/3] Agendamento - deve avancar para Etapa 3" -ForegroundColor White
Send-Msg $PHONE "Sim, vamos agendar uma call para discutir"
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "=== FIM === Verifique o Kanban no painel local (http://localhost:8080)." -ForegroundColor Yellow
