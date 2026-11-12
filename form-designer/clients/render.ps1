# Render a PDF from PowerShell (Windows):
#   .\render.ps1 -Template 1001 -Data .\invoice.xml -Out .\invoice.pdf
param(
  [Parameter(Mandatory = $true)][string]$Template,
  [Parameter(Mandatory = $true)][string]$Data,
  [string]$Out = "out.pdf",
  [string]$Server = "http://localhost:3700",
  [string]$ApiKey = ""
)
$contentType = if ($Data -match '\.json$') { 'application/json; charset=utf-8' } else { 'application/xml; charset=utf-8' }
$headers = @{}
if ($ApiKey) { $headers['x-api-key'] = $ApiKey }
$body = [System.IO.File]::ReadAllBytes((Resolve-Path $Data))
Invoke-WebRequest -Uri "$Server/api/render/$Template" -Method Post -ContentType $contentType -Headers $headers -Body $body -OutFile $Out
Write-Host "Saved $Out"
