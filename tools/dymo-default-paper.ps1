<#
Set the DYMO LabelWriter queue's default paper to 99012 Large Address.

Run this ONCE, as Administrator, on the PC that hosts the shared queue
(10.10.206.95). The driver's factory default is "30252 Address" (28 x 89mm);
any PC or user printing with the queue's defaults gets that form, and Chrome
then shrinks the portal's 36 x 89mm label pages by 0.707 into the top 25mm
of the label. Remote Set-PrintConfiguration is refused (access denied /
WinRM off), so it has to be run locally.

Printer defaults only apply to users who have not customised their own
Printing Preferences; anyone who has must also pick 99012 there (or in the
Chrome print dialog under More settings > Paper size, which Chrome remembers
per printer).

  powershell -ExecutionPolicy Bypass -File tools\dymo-default-paper.ps1 [-PrinterName 'DYMO LabelWriter 550']
#>
param([string]$PrinterName = 'DYMO LabelWriter 550')

$ErrorActionPreference = 'Stop'
$target = 'ns0000:LargeAddress99012'   # 35729 x 88561 microns in the driver's PrintTicket

$cfg = Get-PrintConfiguration -PrinterName $PrinterName
$xml = [xml]$cfg.PrintTicketXml
$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace('psf', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
$ns.AddNamespace('psk', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords')
$opt = $xml.SelectSingleNode("//psf:Feature[@name='psk:PageMediaSize']/psf:Option", $ns)
Write-Host "Current default paper: $($opt.GetAttribute('name'))"
if ($opt.GetAttribute('name') -eq $target) { Write-Host 'Already 99012 - nothing to do.'; exit 0 }

$opt.SetAttribute('name', $target)
$opt.SelectSingleNode("psf:ScoredProperty[@name='psk:MediaSizeWidth']/psf:Value", $ns).InnerText  = '35729'
$opt.SelectSingleNode("psf:ScoredProperty[@name='psk:MediaSizeHeight']/psf:Value", $ns).InnerText = '88561'
Set-PrintConfiguration -PrinterName $PrinterName -PrintTicketXml $xml.OuterXml

$check = [xml](Get-PrintConfiguration -PrinterName $PrinterName).PrintTicketXml
$now = $check.SelectSingleNode("//psf:Feature[@name='psk:PageMediaSize']/psf:Option", $ns).GetAttribute('name')
if ($now -ne $target) { throw "Default paper is still $now" }
Write-Host "Default paper is now $now. Reprint a label from the portal to confirm it fills the roll."
