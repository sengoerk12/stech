param([ValidateRange(20,500)][int]$Limit = 220)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$root = [Windows.Automation.AutomationElement]::RootElement
$className = [Windows.Automation.AutomationElement]::ClassNameProperty
$main = $root.FindAll([Windows.Automation.TreeScope]::Children,
    [Windows.Automation.PropertyCondition]::new($className,'TSrvMainFrm'))
$panCafeIds = @(Get-Process -Name 'pncserver' -ErrorAction SilentlyContinue | ForEach-Object Id)
$main = @($main | Where-Object { $_.Current.ProcessId -in $panCafeIds })
if ($main.Count -ne 1) { throw 'PanCafe yonetim penceresi tekil olarak bulunamadi.' }

$owner = [Windows.Automation.AutomationElement]::ProcessIdProperty
$windows = $root.FindAll([Windows.Automation.TreeScope]::Children,
    [Windows.Automation.PropertyCondition]::new($owner,$main[0].Current.ProcessId))
$walker = [Windows.Automation.TreeWalker]::RawViewWalker
$records = foreach ($window in $windows) {
    if ($window.Current.IsOffscreen -and $window.Current.ClassName -ne 'TSrvMainFrm') { continue }
    $queue = [Collections.Generic.Queue[object]]::new()
    $queue.Enqueue(@($window,0))
    $visited = 0
    while ($queue.Count -gt 0 -and $visited -lt $Limit) {
        $element,$depth = $queue.Dequeue()
        $visited++
        try {
            $current = $element.Current
            $kind = $current.ControlType.ProgrammaticName
            if ($depth -eq 0 -or $current.ClassName -match 'Edit|Button|List|Grid|Tab|Menu' -or
                $kind -match 'Edit|Button|List|Grid|Tab|Menu') {
                [pscustomobject]@{
                    Pencere = $window.Current.ClassName
                    Sinif = $current.ClassName
                    Kontrol = $kind
                    Ozellik = (($element.GetSupportedPatterns() | ForEach-Object {
                        $_.ProgrammaticName -replace 'PatternIdentifiers.Pattern',''
                    }) -join ', ')
                }
            }
            if ($depth -ge 7 -or $kind -match 'List$|Table$|DataGrid$') { continue }
            $child = $walker.GetFirstChild($element)
            while ($child -and ($queue.Count + $visited) -lt $Limit) {
                $queue.Enqueue(@($child,($depth+1)))
                $child = $walker.GetNextSibling($child)
            }
        } catch [Windows.Automation.ElementNotAvailableException] {
            # A popup can close during inspection.
        }
    }
}
$records | Group-Object Pencere,Sinif,Kontrol,Ozellik | Select-Object Count,Name | Format-Table -AutoSize -Wrap
