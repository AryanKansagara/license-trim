# Test helper for script.test.ts. PARSE ONLY: it reads a generated script with the PowerShell parser and prints its structure
# as JSON. It never runs the script, never dot-sources it, and never calls Invoke-Expression or SafeGetValue on it.
# The values of the $changes rows are rebuilt by walking the syntax tree; only the node types the generator emits are
# accepted (single-quoted strings, + between them, [char] codes, ConvertFromUtf32), anything else throws.
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $Path).Path, [ref]$tokens, [ref]$errors)

function Get-Const($n) {
  switch ($n.GetType().Name) {
    'StringConstantExpressionAst' {
      if ($n.StringConstantType -ne 'SingleQuoted') { throw "Unexpected $($n.StringConstantType) string: $($n.Extent.Text)" }
      return $n.Value
    }
    'ConstantExpressionAst' { return $n.Value }
    'ParenExpressionAst' { return Get-Const $n.Pipeline }
    'PipelineAst' {
      if ($n.PipelineElements.Count -ne 1) { throw "Unexpected pipeline: $($n.Extent.Text)" }
      return Get-Const $n.PipelineElements[0]
    }
    'CommandExpressionAst' { return Get-Const $n.Expression }
    'BinaryExpressionAst' {
      if ($n.Operator -ne 'Plus') { throw "Unexpected operator $($n.Operator)" }
      $l = Get-Const $n.Left; $r = Get-Const $n.Right
      if ($l -isnot [string]) { throw "Left side of + must be a string: $($n.Extent.Text)" }
      return $l + [string]$r
    }
    'ConvertExpressionAst' {
      if ($n.StaticType -ne [char]) { throw "Unexpected cast: $($n.Extent.Text)" }
      return [char][int](Get-Const $n.Child)
    }
    'InvokeMemberExpressionAst' {
      if (-not $n.Static -or $n.Expression.TypeName.Name -ne 'char' -or $n.Member.Value -ne 'ConvertFromUtf32' -or $n.Arguments.Count -ne 1) { throw "Unexpected call: $($n.Extent.Text)" }
      return [char]::ConvertFromUtf32([int](Get-Const $n.Arguments[0]))
    }
    'ArrayExpressionAst' {
      $items = foreach ($st in $n.SubExpression.Statements) {
        $e = $st.PipelineElements[0].Expression
        if ($e -is [System.Management.Automation.Language.ArrayLiteralAst]) { foreach ($x in $e.Elements) { Get-Const $x } } else { Get-Const $e }
      }
      return , @($items)
    }
    'HashtableAst' {
      $h = [ordered]@{}
      foreach ($kv in $n.KeyValuePairs) {
        if ($kv.Item1.StringConstantType -ne 'BareWord') { throw "Unexpected key: $($kv.Item1.Extent.Text)" }
        $h[$kv.Item1.Value] = Get-Const $kv.Item2
      }
      return $h
    }
    default { throw "Unexpected syntax $($n.GetType().Name): $($n.Extent.Text)" }
  }
}

# The $changes = @( ... ) assignment, wherever it is.
$assign = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -eq '$changes' }, $false)
$rows = @(); $rowsError = $null
if ($assign.Count -eq 1) {
  try {
    $rows = @($assign[0].Right.Expression.SubExpression.Statements | ForEach-Object {
      $e = $_.PipelineElements[0].Expression
      if ($e -is [System.Management.Automation.Language.ArrayLiteralAst]) { $e.Elements } else { $e }
    } | ForEach-Object { Get-Const $_ })
  } catch { $rows = @(); $rowsError = $_.Exception.Message }
}

$commands = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.CommandAst] }, $true) |
  ForEach-Object { $_.GetCommandName() } | Sort-Object -Unique
[pscustomobject]@{
  parseErrors   = @($errors | ForEach-Object { $_.Message })
  comments      = @($tokens | Where-Object { $_.Kind -eq 'Comment' } | ForEach-Object { $_.Extent.StartLineNumber }).Count
  topLevel      = @($ast.EndBlock.Statements | ForEach-Object { $_.GetType().Name })
  hasParam      = [bool]$ast.ParamBlock
  commands      = @($commands)
  changesAssign = $assign.Count
  rows          = @($rows)
  rowsError     = $rowsError
} | ConvertTo-Json -Depth 8 -Compress
