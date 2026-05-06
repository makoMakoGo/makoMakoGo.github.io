---
title: Codex VS Code 扩展污染 WSLENV 导致 PATHEXT 只剩 .CPL
date: 2026-05-04
description: 记录 Codex VS Code 扩展把 PATHEXT 当路径列表传入 WSLENV 后破坏 PowerShell 命令解析的问题与修复。
categories:
  - Codex
  - WSL
  - Tooling
draft: false
---

## TL;DR

- 在 Codex VS Code 扩展启动的 WSL 会话里，`WSLENV` 被注入了 `PATHEXT/l`。
- `/l` 表示路径列表，但 `PATHEXT` 是 Windows 可执行扩展名列表，不是路径列表。
- WSL 把 `PATHEXT` 当路径列表转换后，PowerShell 侧可能只剩 `.CPL`，导致 `Get-Command nssm` 找不到，必须写 `nssm.exe`。
- 根因是扩展打包 JS 里把 `{name: "PATHEXT", type: "list"}` 放进环境变量传递列表。
- 即时修复是 patch 扩展 JS 删除该项；长效防护是在 `~/.profile` 过滤掉 `WSLENV` 中的 `PATHEXT` / `PATHEXT/...`。

## 症状

WSL 里跑 PowerShell 脚本，`Get-Command nssm` 报错找不到。但 `nssm.exe` 就能找到。

`cmd.exe where nssm` 明明能找到。排查一圈发现 `$env:PATHEXT` 只剩：

```text
.CPL
```

正常应该是：

```text
.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PY;.PYW;.CPL
```

`PATHEXT` 是 Windows 的可执行扩展名列表。PowerShell 靠它解析裸命令名 — 输 `nssm`，系统按 `PATHEXT` 的扩展名顺序去匹配 `nssm.COM`、`nssm.EXE`、`nssm.BAT`……只剩 `.CPL` 时，`nssm` 永远匹配不上，必须写 `nssm.exe`。

## 触发条件

只在 Codex/VS Code 扩展启动的 WSL 会话里出现。普通 WSL shell 正常。普通 PowerShell 正常。

线索在 `WSLENV` 里：

```text
WSLENV=<PATHEXT/l:COMSPEC/p:SYSTEMROOT/p:...>
```

正常 WSL 里 `WSLENV` 不应该有 `PATHEXT`。这里不但有，还带了 `/l`。

## `/l` 怎么破坏 PATHEXT

`WSLENV` 是 WSL 和 Windows 之间传递环境变量的桥。`/l` 后缀表示这个变量是「路径列表」— WSL 在 Win32 边界上对它做两件事：

1. **分隔符互转** — Windows 用 `;`，Linux 用 `:`。`/l` 在两边自动转换分隔符
2. **路径格式映射** — `C:\Windows` ↔ `/mnt/c/Windows`

真实路径列表传入 `/l` 正常工作：

```bash
# Windows: FOO/l=C:\Windows;C:\Users  →  WSL 里拿到：
/mnt/c/Windows:/mnt/c/Users
```

但 `PATHEXT` **不是路径列表**。它是可执行扩展名列表：

```text
.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.PY;.PYW;.CPL
```

这些 `.XXX` 条目没有目录结构、没有盘符、也不该被 WSL 转写。当 `/l` 把它们当路径处理时，转换器尝试对每个条目做路径格式映射，大部分条目在转换过程中变得不可识别，被丢弃或覆盖。`.CPL` 恰好活下来纯属巧合 — 它的格式碰巧落在转换器的容错边界里。

**根本问题也不是 `/l` 用错了类型。** 普通 WSL 里 Linux 侧 `PATHEXT` 为空。从 WSL 启动 `pwsh.exe` 时，Windows 子进程本来就能继承 Windows 侧自己的 `PATHEXT`。**根本不需要通过 `WSLENV` 传它**。多传这一步反而覆盖了正确值。

## 根因定位

Codex VS Code 扩展的打包 JS 里硬编码了环境变量传递列表：

```javascript
$De = [
  {name: "PATHEXT", type: "list"},  // ← 问题在这一行
  {name: "COMSPEC", type: "path"},
  {name: "SYSTEMROOT", type: "path"},
  ...
]
```

`type: "list"` 在 WSL 会话创建时生成 `PATHEXT/l`，塞进 `WSLENV`。扩展代码没区分「路径列表」和「扩展名列表」。

定位过程：查看 Codex 会话的父进程，找到扩展里的 `codex app-server`，在扩展打包 JS 里 `rg "PATHEXT/l|WSLENV|PATHEXT"`，得到上面的代码块。

## 修复

两套：patch 扩展文件即时止血，profile 过滤长效防护。扩展更新会覆盖 patch，profile 不受影响。

### 层一：patch 扩展 JS

扩展文件位置（WSL 路径）：

```text
/mnt/c/Users/<user>/.vscode/extensions/openai.chatgpt-*-win32-x64/out/extension.js
```

删除 `{name:"PATHEXT",type:"list"},` 这一项。

验证 patch：

```bash
perl -0777 -ne '$c=()=/{name:"PATHEXT",type:"list"},/g; print "PATHEXT-list-occurrences=$c\n"' \
  /mnt/c/Users/<user>/.vscode/extensions/openai.chatgpt-*-win32-x64/out/extension.js
# 期望: PATHEXT-list-occurrences=0

node --check /mnt/c/Users/<user>/.vscode/extensions/openai.chatgpt-*-win32-x64/out/extension.js
# 期望: 无报错
```

重启 VS Code 后，`WSLENV` 里不再有 `PATHEXT/l`，`pwsh.exe` 的 `PATHEXT` 恢复正常。

### 层二：profile 过滤 WSLENV

扩展更新后会重新带回错误代码。在 `~/.profile` 头部加一层过滤 — 不管扩展怎么传，login shell 先把 `PATHEXT` 从 `WSLENV` 里清掉：

```bash
# PATHEXT is a Windows executable-extension list, not a WSL path list.
# Carrying it through WSLENV overwrites the correct Windows-side value.
if [ -n "${WSLENV:-}" ]; then
    _codex_wslenv_new=
    _codex_wslenv_old_ifs=$IFS
    IFS=:
    for _codex_wslenv_entry in $WSLENV; do
        case "$_codex_wslenv_entry" in
            PATHEXT|PATHEXT/*)
                continue
                ;;
        esac
        _codex_wslenv_new="${_codex_wslenv_new:+$_codex_wslenv_new:}$_codex_wslenv_entry"
    done
    IFS=$_codex_wslenv_old_ifs
    export WSLENV=$_codex_wslenv_new
    unset _codex_wslenv_new _codex_wslenv_old_ifs _codex_wslenv_entry
fi
```

Codex 扩展用 `bash -lc ...` 启动 WSL 会话，`-l` 走 `.profile`，过滤在 Codex 跑起来之前生效。

### 为什么不在扩展 JS 里改成 `"PATHEXT"`（不带 `/l`）

不传 `PATHEXT` 不是禁用它 — 是避免 `WSLENV` 覆盖 Windows 子进程自己的正确值。普通 WSL 里 `PATHEXT` 为空，`pwsh.exe` 启动后自动拿到完整 `PATHEXT`。什么都不传反而是正确的。

## 验证

**语法检查：**

```bash
bash -n ~/.profile
```

**模拟扩展带回错误值：**

```bash
env -u PATHEXT WSLENV='PATHEXT/l:COMSPEC/p:SYSTEMROOT/p:WT_SESSION' \
  bash -lc 'printf "WSLENV=<%s>\n" "$WSLENV"'
```

期望输出：

```text
WSLENV=<COMSPEC/p:SYSTEMROOT/p:WT_SESSION>
```

`PATHEXT/l` 被移除，其余条目完整保留。

**模拟扩展再次注入时 PowerShell 仍正常：**

```bash
env -u PATHEXT WSLENV='PATHEXT/l:COMSPEC/p:SYSTEMROOT/p:SYSTEMDRIVE:USERNAME' \
  bash -lc 'printf "WSLENV=<%s>\nPATHEXT=<%s>\n" "$WSLENV" "$PATHEXT"; pwsh.exe -NoLogo -NoProfile -NonInteractive -Command "\$env:PATHEXT"'
```

期望：`PATHEXT` 完整，含全部扩展名。

## 备注

- 上游理想修复：扩展不把 `PATHEXT` 写进 `WSLENV` 传递列表
- 理论副作用极小：profile 过滤只移除 `PATHEXT` 和 `PATHEXT/...`。如果真有一个工具故意要通过 `WSLENV=PATHEXT...` 从 WSL 覆盖 Windows 子进程的可执行扩展名查找 — 会被拦下。这不是常规 WSL 工作流

## 资料来源

- 原始报告：`fish-claude/reports/external-codex-vscode-wsl-pathext.md`
- dianjinqu @ LINUX DO：<https://linux.do/t/topic/2105562>
