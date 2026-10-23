@echo off
rem Fresh-install network capture gate: guest-only docker shim. NEVER ship this.
rem
rem SearXNG runs on the host (Docker in the guest is unreliable). The installer
rem still calls docker --version, docker info, docker compose up -d and
rem docker compose ps --status running -q; each answers from a probe of
rem http://127.0.0.1:8888, the URL the backend hardcodes, which the guest's
rem netsh portproxy forwards to the host (10.0.2.2:8888). The installer binary
rem is unchanged. Anything else fails loudly. See docs/NETWORK_GATE.md.
setlocal
if /i "%~1"=="--version" (
  echo Docker version 0.0.0-netgate-shim
  exit /b 0
)
if /i "%~1"=="info" goto probe
if /i "%~1"=="compose" goto compose
echo docker shim: unsupported command: %* 1>&2
exit /b 1

:compose
if /i "%~2"=="up" goto probe
if /i "%~2"=="ps" goto ps
echo docker shim: unsupported compose command: %* 1>&2
exit /b 1

:ps
call :check
if errorlevel 1 exit /b 0
echo netgate-shim
exit /b 0

:probe
call :check
if errorlevel 1 (
  echo docker shim: SearXNG not reachable at http://127.0.0.1:8888 1>&2
  exit /b 1
)
exit /b 0

:check
set "CODE="
for /f %%c in ('curl.exe -s -o NUL -w "%%{http_code}" --max-time 5 http://127.0.0.1:8888/') do set "CODE=%%c"
if "%CODE%"=="200" exit /b 0
exit /b 1
