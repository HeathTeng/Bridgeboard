@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo 没有找到 Node.js。
  echo 请下载 Releases 里的 Windows 便携版压缩包，或者从 https://nodejs.org 安装 LTS 版本后再试。
  pause
  exit /b 1
)
"%NODE%" server.js --demo
pause
