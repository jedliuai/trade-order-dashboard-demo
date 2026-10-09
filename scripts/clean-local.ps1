param([switch]$Apply)

# 默认只预览；加 -Apply 才删除已确认可重新生成的项目内文件。
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$targets = @(
    'node_modules', 'frontend/node_modules', '.venv',
    'frontend/dist', 'frontend/public/.cloudflare-demo',
    'frontend/.tmp-build-previous-1R9NN3',
    'frontend/.tmp-build-previous-BHFLz3',
    'frontend/.tmp-build-previous-T7F5aq',
    'frontend/.tmp-build-previous-fVEi1X',
    '.playwright-cli', '.wrangler',
    'local_api/__pycache__', 'local_api/tests/__pycache__', 'scripts/__pycache__',
    'tmp/readme-preview',
    'tmp/cloudflare-demo-cookies-2.txt', 'tmp/cloudflare-demo-cookies.txt',
    'tmp/readme-analysis-latest.txt', 'tmp/readme-analytics-snapshot.txt',
    'tmp/readme-build.log', 'tmp/readme-customer-latest.txt',
    'tmp/readme-customer-product.txt', 'tmp/readme-frontend-tests.log',
    'tmp/readme-lint.log', 'tmp/readme-product-snapshot.txt',
    'tmp/readme-render.json', 'tmp/readme-rendered.html'
)

$rootItem = Get-Item -LiteralPath $projectRoot -Force
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw '项目根目录是链接，停止清理。'
}
$remote = git -C $projectRoot remote get-url origin
if ($LASTEXITCODE -ne 0 -or $remote -ne 'https://github.com/jedliuai/trade-order-dashboard-demo.git') {
    throw '不是指定的演示仓库，停止清理。'
}
$tracked = @(git -C $projectRoot -c core.quotepath=false ls-files)
if ($LASTEXITCODE -ne 0) { throw '无法核对版本文件，停止清理。' }

# 先检查全部目标，再执行删除；不扫描其他项目或系统目录。
$plan = @()
foreach ($relative in $targets) {
    $fullPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $fullPath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "目标越界：$relative"
    }
    if (-not (Test-Path -LiteralPath $fullPath)) { continue }
    if ((Resolve-Path -LiteralPath $fullPath).Path -ne $fullPath) { throw "路径解析异常：$relative" }
    $item = Get-Item -LiteralPath $fullPath -Force
    $cursor = $item
    while ($cursor -and $cursor.FullName -ne $projectRoot) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "路径包含链接：$relative" }
        $cursor = if ($cursor.PSIsContainer) { $cursor.Parent } else { $cursor.Directory }
    }
    $entries = @($item)
    if ($item.PSIsContainer) { $entries += @(Get-ChildItem -LiteralPath $fullPath -Force -Recurse) }
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
        throw "目标内包含链接：$relative"
    }
    if ($tracked | Where-Object { $_ -eq $relative -or $_.StartsWith($relative + '/', [StringComparison]::OrdinalIgnoreCase) }) {
        throw "目标包含版本文件：$relative"
    }
    git -C $projectRoot check-ignore -q -- $relative
    if ($LASTEXITCODE -ne 0) { throw "目标未被 Git 忽略：$relative" }
    $files = @($entries | Where-Object { -not $_.PSIsContainer })
    $plan += [pscustomobject]@{
        Relative = $relative
        Path = $fullPath
        Bytes = ($files | Measure-Object Length -Sum).Sum
        Files = $files.Count
    }
}
$plan | Select-Object Relative, @{n='MiB';e={[math]::Round($_.Bytes / 1MB, 2)}}, Files | Format-Table -AutoSize
$total = ($plan | Measure-Object Bytes -Sum).Sum
Write-Output ("预计清理 {0:N2} MiB；保留源码、封面素材、数据库、备份及隐私检查原材料。" -f ($total / 1MB))
if (-not $Apply) {
    Write-Output '当前为预览，没有删除文件。确认清单后，在项目根目录执行：powershell -NoProfile -File scripts/clean-local.ps1 -Apply'
    return
}

$active = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(node|python|pythonw)\.exe$' -and $_.CommandLine -and
    ($_.CommandLine.Contains($projectRoot) -or $_.CommandLine -match 'local_api\.server|scripts[/\\]local\.mjs|frontend[/\\]node_modules[/\\]vite')
})
if ($active.Count -gt 0) { throw '项目服务正在运行，先停止服务再清理。' }

# 删除前为所有保留文件记录校验值；不会创建新的备份或读取文件内容到日志。
$preserved = @{}
foreach ($file in Get-ChildItem -LiteralPath $projectRoot -File -Force -Recurse) {
    $inTarget = $plan | Where-Object {
        $file.FullName -eq $_.Path -or $file.FullName.StartsWith($_.Path + '\', [StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $inTarget) { $preserved[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
}
foreach ($target in $plan) {
    Remove-Item -LiteralPath $target.Path -Recurse -Force
    if (Test-Path -LiteralPath $target.Path) { throw "清理未完成：$($target.Relative)" }
}
foreach ($filePath in $preserved.Keys) {
    if (-not (Test-Path -LiteralPath $filePath)) { throw "保留文件缺失：$filePath" }
    if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $preserved[$filePath]) {
        throw "保留文件发生变化：$filePath"
    }
}
Write-Output ("已清理 {0:N2} MiB，全部保留文件校验通过。" -f ($total / 1MB))
Write-Output '下次本地运行：npm run setup，再运行 npm run dev。构建模式还需 npm run build。Cloudflare 部署依赖另用 npm ci 恢复。'
