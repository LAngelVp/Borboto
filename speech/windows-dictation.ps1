$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Emitir($tipo, $texto = '', $errorCodigo = '') {
    [Console]::WriteLine((@{ tipo = $tipo; texto = $texto; error = $errorCodigo } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
$motor = $null
$suscripciones = @()
$fallo = $null
try {
    try { Add-Type -AssemblyName System.Speech } catch { $fallo = 'sin-runtime'; throw }
    Add-Type -TypeDefinition @'
using System;
using System.Threading.Tasks;
public static class BorbotoDictationInput {
    public static Task<string> Read() {
        return Task.Run(() => Console.ReadLine());
    }
}
'@
    $instalados = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
    $idioma = $instalados | Where-Object { $_.Culture.Name -eq 'es-MX' } | Select-Object -First 1
    if (-not $idioma) { $idioma = $instalados | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq 'es' } | Select-Object -First 1 }
    if (-not $idioma) { $fallo = 'sin-motor'; throw 'No Spanish recognizer' }
    $motor = [System.Speech.Recognition.SpeechRecognitionEngine]::new($idioma)
    $motor.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    try { $motor.SetInputToDefaultAudioDevice() } catch { $fallo = 'sin-microfono'; throw }
    foreach ($nombre in @('SpeechHypothesized', 'SpeechRecognized', 'RecognizeCompleted')) {
        $identificador = "borboto-$nombre"
        $suscripciones += $identificador
        Register-ObjectEvent -InputObject $motor -EventName $nombre -SourceIdentifier $identificador | Out-Null
    }
    $confirmado = ''
    $terminado = $false
    $deteniendo = $false
    $entrada = [BorbotoDictationInput]::Read()
    $motor.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    Emitir 'listo'
    while (-not $terminado) {
        if ($entrada.IsCompleted -and -not $deteniendo) {
            $comando = $entrada.Result
            if ($null -eq $comando) { $motor.RecognizeAsyncCancel(); $deteniendo = $true }
            elseif ($comando -eq 'STOP') { $motor.RecognizeAsyncStop(); $deteniendo = $true }
            else { $entrada = [BorbotoDictationInput]::Read() }
        }
        foreach ($evento in @(Get-Event)) {
            if ($evento.SourceIdentifier -eq 'borboto-RecognizeCompleted') {
                if ($evento.SourceEventArgs.Error) { $fallo = 'fallo-local'; throw $evento.SourceEventArgs.Error }
                $terminado = $true
            } elseif ($evento.SourceIdentifier -eq 'borboto-SpeechRecognized') {
                $confirmado = (($confirmado + ' ' + $evento.SourceEventArgs.Result.Text).Trim())
                Emitir 'texto' $confirmado
            } elseif ($evento.SourceIdentifier -eq 'borboto-SpeechHypothesized') {
                Emitir 'texto' (($confirmado + ' ' + $evento.SourceEventArgs.Result.Text).Trim())
            }
            Remove-Event -EventIdentifier $evento.EventIdentifier
        }
        if (-not $terminado) { [System.Threading.Thread]::Sleep(40) }
    }
} catch {
    if (-not $fallo) { $fallo = 'fallo-local' }
} finally {
    foreach ($identificador in $suscripciones) { Unregister-Event -SourceIdentifier $identificador -ErrorAction SilentlyContinue }
    if ($motor) { $motor.Dispose() }
}
if ($fallo) { Emitir 'error' '' $fallo } else { Emitir 'fin' }