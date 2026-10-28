<#
 * 一键构建 + 打包 + 安装扩展
 *
 * 用法（PowerShell）：
 *   cd <项目根>
 *   .\scripts\build-install.ps1
 *
 * 它做 5 件事：
 *   1. 编译扩展端（tsc → out/）
 *   2. 重建前端 bundle（webview-ui → dist-webview/）
 *   3. 跑单元测试
 *   4. 跑架构守卫（scripts/checkProject.js）
 *   5. 打包 VSIX 并安装进本机 VS Code
 *
 * ⚠️ 它【不会】自动重启 VS Code。
 *    扩展代码变更必须重载窗口才生效（VS Code 不会热重载已安装的扩展）。
 *
 * ⚠️ 为什么第 2 步不直接跑 `npm run build:webview`：
 *    它会先执行 `npm install`，在有安全策略/杀软锁文件的机器上会 EPERM
 *    （package-lock.json 被拒写）。依赖已装好时直接进 webview-ui 跑 build 即可。
 *
 * 💡 排障小抄：改完代码跑完这个脚本，再打开面板，
 *    日志里应该出现「Webview 已就绪，前端脚本执行成功」。
 *    没有这行 → 面板大概率是白的（详见 docs/WEBVIEW_BLANK_PANEL_POSTMORTEM.md）。
#>

[CmdletBinding()]
param(
    # 跳过测试与守卫（只想快速装一版看效果时用）
    [switch]$Fast,
    # 打包但不安装
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($n, $name) { Write-Output "`n=== [$n] $name ===" }
function Fail($msg) { throw $msg }

# ── 1. 编译扩展端 ──
Step 1 '编译扩展端'
npm run compile
if ($LASTEXITCODE -ne 0) { Fail "编译失败 (exit $LASTEXITCODE)" }

# ── 2. 重建前端 bundle ──
Step 2 '重建前端 bundle'
Push-Location webview-ui
try {
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    $buildExit = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($buildExit -ne 0) { Fail "前端构建失败 (exit $buildExit)" }

# ── 3 & 4. 测试 + 守卫 ──
if (-not $Fast) {
    Step 3 '跑单元测试'
    npm test
    if ($LASTEXITCODE -ne 0) { Fail "单元测试未全绿 (exit $LASTEXITCODE)" }

    Step 4 '架构守卫'
    npm run check
    if ($LASTEXITCODE -ne 0) { Fail "架构守卫未通过 (exit $LASTEXITCODE)" }
} else {
    Write-Output "`n=== [3/4] 跳过测试与守卫（-Fast） ==="
}

# ── 5. 打包 + 安装 ──
Step 5 '打包 VSIX'
# 版本号从 package.json 取，不写死 —— 升级版本时这个脚本不用改
$version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$vsix = Join-Path $root "vscode-mini-coder-$version.vsix"
npx --yes @vscode/vsce@3 package --out $vsix
if ($LASTEXITCODE -ne 0) { Fail "打包失败 (exit $LASTEXITCODE)" }

if (-not $NoInstall) {
    Step 6 '安装扩展'

    # 找 code 命令的顺序（从最准到最兜底）：
    #   1. 运行中的 VS Code 进程 —— 它一定是用户真正在用的那个
    #   2. PATH 里的 code
    #   3. 常见安装位置
    #   4. $env:VSCODE_BIN（手动指定）
    $codeCmd = $null

    $running = Get-Process Code -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -ne '' } |
        Select-Object -First 1
    if ($running -and $running.Path) {
        $candidate = Join-Path (Split-Path -Parent $running.Path) 'bin\code.cmd'
        if (Test-Path $candidate) { $codeCmd = $candidate }
    }

    if (-not $codeCmd) {
        $onPath = Get-Command code -ErrorAction SilentlyContinue
        if ($onPath) { $codeCmd = $onPath.Source }
    }

    if (-not $codeCmd) {
        $candidates = @(
            $env:VSCODE_BIN,
            "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
            'C:\Program Files\Microsoft VS Code\bin\code.cmd'
        ) | Where-Object { $_ -and (Test-Path $_) }
        if ($candidates.Count -gt 0) { $codeCmd = $candidates[0] }
    }

    if ($codeCmd) {
        Write-Output "使用 code 命令：$codeCmd"
        & $codeCmd --install-extension $vsix --force
        if ($LASTEXITCODE -ne 0) { Fail "安装失败 (exit $LASTEXITCODE)" }
    } else {
        Write-Output '!! 找不到 code 命令，VSIX 已生成，请手动安装：'
        Write-Output "   $vsix"
        Write-Output '   （或先设 VSCODE_BIN 环境变量指向 VS Code 的 bin\code.cmd）'
    }
}

Write-Output @'

==================================================
完成。
  1. 重载 VS Code 窗口（Ctrl+Shift+P → Developer: Reload Window）
  2. 点右下角 'Mini-Coder' 状态栏项，打开聊天面板
  3. 确认日志里出现「Webview 已就绪，前端脚本执行成功」
     读日志：
       $root = "$env:APPDATA\Code\logs"
       Get-ChildItem $root -Recurse -File -Filter '*Mini-Coder.log' |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
         ForEach-Object { Get-Content $_.FullName -Encoding UTF8 }
     排障手册：docs/WEBVIEW_BLANK_PANEL_POSTMORTEM.md
==================================================
'@
