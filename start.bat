@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
"%NODE%" --version >/dev/null 2>&1
if errorlevel 1 (
  echo 没有找到 Node.js。
  echo 请下载 Releases 里的 Windows 便携版压缩包，或者从 https://nodejs.org 安装 LTS 版本后再试。
  pause
  exit /b 1
)
rem Extra options (e.g. --background from 开机自动启动) go on to the app.
"%NODE%" server.js %*
rem Exit code 0: the dashboard was already running and its page was opened, so close this window.
if errorlevel 1 pause
