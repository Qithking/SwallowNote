@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  SwallowNote 发布脚本 (Windows 版)
REM  参考 release.sh 实现，逻辑保持一致
REM ============================================================

set "REPO=Qithking/SwallowNote"
set "INFO=[INFO]"
set "OK=[OK]"
set "ERR=[ERR]"
set "WARN=[WARN]"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM 检查是否为 git 仓库
git rev-parse --git-dir >nul 2>&1
if !errorlevel! neq 0 (
    echo %ERR% 当前目录不是 Git 仓库
    pause
    exit /b 1
)

REM 主菜单
:MENU
cd /d "%SCRIPT_DIR%"
cls
echo.
echo ============================================================
echo                SwallowNote 发布工具
echo ============================================================
echo.
echo   1. 提交代码到 GitHub (main 分支)
echo   2. 发布新版本 (创建 tag 触发 GitHub Actions)
echo   3. 下载最新版本
echo   4. 清除 Actions
echo   5. 删除 Tag
echo   6. 重新触发最新版本 GitHub Actions
echo   0. 退出
echo.
set "choice="
set /p "choice=请选择操作 (0-6): "

if "!choice!"=="1" goto push_to_github
if "!choice!"=="2" goto create_release
if "!choice!"=="3" goto download_latest
if "!choice!"=="4" goto clean_actions
if "!choice!"=="5" goto delete_tag
if "!choice!"=="6" goto rerun_latest
if "!choice!"=="0" exit /b 0
echo %ERR% 无效选择，请输入 0-6
timeout /t 1 >nul
goto MENU


REM ============================================================
REM  子程序: 获取 remote 名称 -> !remote_name!
REM ============================================================
:get_remote
set "remote_name="
for /f "tokens=1" %%i in ('git remote 2^>nul') do (
    set "remote_name=%%i"
    goto :eof
)
goto :eof

REM ============================================================
REM  子程序: 获取最新 tag -> !latest_tag!
REM ============================================================
:get_latest_tag
set "latest_tag="
for /f "delims=" %%i in ('git tag --sort=-version:refname 2^>nul') do (
    set "latest_tag=%%i"
    goto :eof
)
goto :eof

REM ============================================================
REM  子程序: 显示前 N 个 tag  参数: %1=N
REM ============================================================
:show_top_tags
set "_n=0"
for /f "delims=" %%i in ('git tag --sort=-version:refname 2^>nul') do (
    echo   %%i
    set /a "_n+=1"
    if !_n! geq %1 goto :eof
)
goto :eof

REM ============================================================
REM  子程序: 检查 gh 是否可用 -> !gh_ok!=1/0
REM ============================================================
:check_gh
set "gh_ok=0"
where gh >nul 2>&1
if !errorlevel! neq 0 (
    echo %ERR% 需要安装 GitHub CLI: https://cli.github.com
    goto :eof
)
gh auth status >nul 2>&1
if !errorlevel! neq 0 (
    echo %ERR% 未登录 GitHub，请运行: gh auth login
    goto :eof
)
set "gh_ok=1"
goto :eof

REM ============================================================
REM  子程序: 验证版本号格式  参数: %1=版本号
REM  输出: !ver_ok!=1/0, !v_major!, !v_minor!, !v_patch!
REM  支持 v1.2.3 和 1.2.3 两种格式
REM ============================================================
:validate_version
set "ver_ok=0"
set "v_major="
set "v_minor="
set "v_patch="
set "_v=%~1"
if "!_v!"=="" goto :eof
REM 去除 v 前缀
if "!_v:~0,1!"=="v" set "_v=!_v:~1!"
REM 用 for /f 拆分三段
for /f "tokens=1,2,3 delims=." %%a in ("!_v!") do (
    set "v_major=%%a"
    set "v_minor=%%b"
    set "v_patch=%%c"
)
REM 检查三段是否都存在
if "!v_major!"=="" goto :eof
if "!v_minor!"=="" goto :eof
if "!v_patch!"=="" goto :eof
REM 用 findstr 验证纯数字
echo !v_major!| findstr /r "^[0-9][0-9]*$" >nul || goto :eof
echo !v_minor!| findstr /r "^[0-9][0-9]*$" >nul || goto :eof
echo !v_patch!| findstr /r "^[0-9][0-9]*$" >nul || goto :eof
set "ver_ok=1"
goto :eof

REM ============================================================
REM  子程序: 检查 tag 是否存在  参数: %1=tag  -> !tag_found!=1/0
REM ============================================================
:tag_exists
set "tag_found=0"
for /f "delims=" %%i in ('git tag 2^>nul') do (
    if "%%i"=="%~1" set "tag_found=1"
)
goto :eof


REM ============================================================
REM  1. 提交代码到 GitHub
REM ============================================================
:push_to_github
cls
echo.
echo === 提交代码到 GitHub ===
echo.

call :get_remote
if "!remote_name!"=="" (
    echo %ERR% 未找到远程仓库
    pause
    goto MENU
)
echo %INFO% 检测到远程仓库: !remote_name!

REM 检查分支
for /f "delims=" %%i in ('git branch --show-current') do set "branch=%%i"
if not "!branch!"=="main" (
    echo %WARN% 当前不在 main 分支 ^(当前: !branch!^)
    set "c="
    set /p "c=是否切换到 main 分支? (y/n): "
    if /i "!c!"=="y" (
        git checkout main
        if !errorlevel! neq 0 (
            echo %ERR% 切换分支失败
            pause
            goto MENU
        )
        for /f "delims=" %%i in ('git branch --show-current') do set "branch=%%i"
    ) else (
        echo %INFO% 继续在当前分支操作
    )
)

REM 显示更改
echo.
echo %INFO% 当前更改:
git status --short
echo.

git diff-index --quiet HEAD -- 2>nul
if !errorlevel! equ 0 (
    echo %INFO% 没有需要提交的更改
    pause
    goto MENU
)

set "msg="
set /p "msg=输入提交信息 (留空使用默认): "
if "!msg!"=="" set "msg=Update: %date% %time%"

echo.
echo %INFO% 执行: git add . ^&^& git commit -m "!msg!"
git add .
if !errorlevel! neq 0 (
    echo %ERR% git add 失败
    pause
    goto MENU
)

git commit -m "!msg!"
if !errorlevel! neq 0 (
    echo %ERR% commit 失败
    pause
    goto MENU
)

echo.
echo %INFO% 推送到 !remote_name!/!branch!...
git push "!remote_name!" "!branch!"
if !errorlevel! equ 0 (
    echo %OK% 代码已成功推送到 GitHub!
) else (
    echo %ERR% 推送失败
)

echo.
pause
goto MENU


REM ============================================================
REM  2. 发布新版本 (创建 tag 触发 GitHub Actions)
REM ============================================================
:create_release
cls
echo.
echo === 创建新版本 ===
echo.

call :check_gh
if !gh_ok! equ 0 (
    pause
    goto MENU
)

call :get_remote
if "!remote_name!"=="" (
    echo %ERR% 未找到远程仓库
    pause
    goto MENU
)
echo %INFO% 检测到远程仓库: !remote_name!

REM 获取当前版本
call :get_latest_tag
if "!latest_tag!"=="" (
    set "cur_ver=v0.0.0"
) else (
    set "cur_ver=!latest_tag!"
)
echo %INFO% 当前版本: !cur_ver!

REM 获取 GitHub 提交次数
echo %INFO% 获取 GitHub 提交记录...
set "commit_count=0"
for /f "delims=" %%i in ('gh api repos/!REPO!/commits --jq "length" 2^>nul') do set "commit_count=%%i"
if "!commit_count!"=="0" (
    for /f "delims=" %%i in ('git rev-list --count HEAD 2^>nul') do set "commit_count=%%i"
)
echo %INFO% GitHub 提交次数: !commit_count!

REM 生成推荐版本号: 递增 patch
set "rec_ver=v1.0.1"
call :validate_version "!cur_ver!"
if !ver_ok! equ 1 (
    set /a "_p=v_patch+1"
    set "rec_ver=v!v_major!.!v_minor!.!_p!"
)

echo.
echo %INFO% 推荐版本号: !rec_ver!
echo.
set "new_ver="
set /p "new_ver=输入新版本号 (留空使用推荐版本号 !rec_ver!): "
if "!new_ver!"=="" set "new_ver=!rec_ver!"

call :validate_version "!new_ver!"
if !ver_ok! equ 0 (
    echo %ERR% 版本号格式错误，请使用 *.*.* 格式
    pause
    goto MENU
)

REM 加 v 前缀
if not "!new_ver:~0,1!"=="v" set "new_ver=v!new_ver!"
echo %INFO% 创建版本: !new_ver!

REM 检查 tag 是否已存在
call :tag_exists "!new_ver!"
if !tag_found! equ 1 (
    echo %WARN% 版本 !new_ver! 已存在
    set "c="
    set /p "c=是否删除旧 tag 并重新发布? (y/n): "
    if /i "!c!"=="y" (
        git tag -d "!new_ver!" 2>nul
        echo %INFO% 已删除本地 tag: !new_ver!
        git push "!remote_name!" --delete "!new_ver!" 2>nul
        if !errorlevel! equ 0 (
            echo %INFO% 已删除远程 tag: !new_ver!
        ) else (
            echo %WARN% 远程 tag 可能不存在
        )
    ) else (
        echo %INFO% 已取消发布
        pause
        goto MENU
    )
)

echo.
echo %INFO% 创建 tag: !new_ver!
git tag "!new_ver!"
if !errorlevel! neq 0 (
    echo %ERR% 创建 tag 失败
    pause
    goto MENU
)

echo.
echo %INFO% 推送 tag 到 GitHub...
git push "!remote_name!" "!new_ver!"
if !errorlevel! equ 0 (
    echo %OK% 已创建版本 !new_ver! 并推送!
    echo %INFO% GitHub Actions 将自动开始构建各平台安装包...
    echo %INFO% 查看构建进度: https://github.com/!REPO!/actions
) else (
    echo %ERR% 推送失败
)

echo.
pause
goto MENU


REM ============================================================
REM  3. 下载最新版本
REM ============================================================
:download_latest
cls
echo.
echo === 下载最新版本 ===
echo.

echo %INFO% 正在获取最新版本信息...
set "rel_ver="

call :check_gh
if !gh_ok! equ 1 (
    for /f "delims=" %%i in ('gh release view --repo !REPO! --json tagName --jq ".tagName" 2^>nul') do set "rel_ver=%%i"
)

REM 备用方案: 使用 API
if "!rel_ver!"=="" (
    for /f "tokens=2 delims=: " %%i in ('curl -s "https://api.github.com/repos/!REPO!/releases/latest" 2^>nul ^| findstr /i "tag_name"') do (
        set "rel_ver=%%i"
    )
    set "rel_ver=!rel_ver:"=!"
    set "rel_ver=!rel_ver:,=!"
    set "rel_ver=!rel_ver: =!"
)

if "!rel_ver!"=="" (
    echo %ERR% 无法获取最新版本，请检查仓库地址
    pause
    goto MENU
)

echo %INFO% 最新版本: !rel_ver!

REM 显示可用的下载资产
echo.
echo %INFO% 可用下载包:
if !gh_ok! equ 1 (
    for /f "delims=" %%i in ('gh release view "!rel_ver!" --repo !REPO! --json assets --jq ".assets[].name" 2^>nul') do (
        echo   - %%i
    )
)

echo.
echo %INFO% 下载链接: https://github.com/!REPO!/releases/tag/!rel_ver!

REM 选择下载类型
echo.
echo 选择下载类型:
echo   1. macOS (DMG)
echo   2. Windows (MSI)
echo   3. Linux (AppImage)
echo   4. Linux (DEB)
echo.
set "dtype="
set /p "dtype=请选择 (1-4): "

set "pat="
if "!dtype!"=="1" set "pat=universal.dmg"
if "!dtype!"=="2" set "pat=x64.msi"
if "!dtype!"=="3" set "pat=x86_64.AppImage"
if "!dtype!"=="4" set "pat=x86_64.deb"

if "!pat!"=="" (
    echo %ERR% 无效选择
    pause
    goto MENU
)

echo.
set "c="
set /p "c=确认下载? (y/n): "
if /i not "!c!"=="y" (
    echo %INFO% 已取消
    pause
    goto MENU
)

REM 获取下载 URL (优先使用 gh, 备用方案: 直接构造 URL)
set "dl_url="
if !gh_ok! equ 1 (
    for /f "delims=" %%i in ('gh release view "!rel_ver!" --repo !REPO! --json assets --jq ".assets[].url" 2^>nul ^| findstr /i "!pat!"') do (
        set "dl_url=%%i"
    )
)
if "!dl_url!"=="" (
    set "dl_url=https://github.com/!REPO!/releases/download/!rel_ver!/SwallowNote-!rel_ver!-!pat!"
)
set "dl_file=SwallowNote-!rel_ver!-!pat!"

echo.
echo %INFO% 开始下载...

REM 使用 curl 下载到 Downloads 目录
set "_dl_dir=%USERPROFILE%\Downloads"
if not exist "!_dl_dir!" mkdir "!_dl_dir!"

where curl >nul 2>&1
if !errorlevel! equ 0 (
    pushd "!_dl_dir!"
    curl -L -o "!dl_file!" "!dl_url!"
    set "_dl_err=!errorlevel!"
    popd
    if !_dl_err! equ 0 (
        echo %OK% 下载完成!
        echo %INFO% 保存到: !_dl_dir!\!dl_file!
    ) else (
        echo %ERR% 下载失败
        echo %INFO% 请手动下载: !dl_url!
    )
) else (
    echo %WARN% 未找到 curl，请手动下载:
    echo   !dl_url!
)

echo.
pause
goto MENU


REM ============================================================
REM  4. 清除 Actions
REM ============================================================
:clean_actions
cls
echo.
echo === 清除 GitHub Actions ===
echo.
echo   1. 清除失败的 Actions
echo   2. 清除所有 Actions
echo   0. 返回
echo.
set "sc="
set /p "sc=请选择: "

if "!sc!"=="1" goto clean_failed
if "!sc!"=="2" goto clean_all
if "!sc!"=="0" goto MENU
echo %ERR% 无效选择
pause
goto clean_actions

:clean_failed
echo.
echo === 清除失败的 GitHub Actions ===
echo.
call :check_gh
if !gh_ok! equ 0 (
    pause
    goto MENU
)

echo %INFO% 获取失败的 Actions 运行...
REM 将失败的 run ID 存入临时文件 (防止删除后列表变化导致二次读取为空)
set "_runfile=%TEMP%\swallownote_failed_runs.tmp"
REM 注意: jq 表达式中的 | 在双引号内不需要 ^ 转义
gh run list --repo !REPO! --status failure --json databaseId,workflowName --jq ".[] | [.databaseId, .workflowName] | @csv" > "%_runfile%" 2>nul

REM 检查是否有失败的运行
set "_has=0"
for /f "usebackq tokens=1,* delims=," %%a in ("%_runfile%") do set "_has=1"

if !_has! equ 0 (
    echo %INFO% 没有失败的 Actions 运行
    del "%_runfile%" 2>nul
    pause
    goto MENU
)

echo.
echo %INFO% 找到以下失败的运行:
for /f "usebackq tokens=1,* delims=," %%a in ("%_runfile%") do (
    set "_wn=%%b"
    set "_wn=!_wn:"=!"
    echo   - [%%a] !_wn!
)

echo.
set "c="
set /p "c=确认删除所有失败运行? (y/n): "
if /i not "!c!"=="y" (
    echo %INFO% 已取消
    del "%_runfile%" 2>nul
    pause
    goto MENU
)

echo.
echo %INFO% 正在删除...
set "_d=0"
set "_f=0"
for /f "usebackq tokens=1,* delims=," %%i in ("%_runfile%") do (
    gh run delete "%%i" --repo !REPO! 2>nul
    if !errorlevel! equ 0 (
        set /a "_d+=1"
        set "_wn=%%j"
        set "_wn=!_wn:"=!"
        echo %OK% 已删除: !_wn! ^(%%i^)
    ) else (
        set /a "_f+=1"
        echo %ERR% 删除失败: %%i
    )
)
echo %OK% 清理完成! 已删除: !_d! 个, 失败: !_f! 个
del "%_runfile%" 2>nul
echo.
pause
goto MENU

:clean_all
echo.
echo === 清除所有 GitHub Actions ===
echo.
call :check_gh
if !gh_ok! equ 0 (
    pause
    goto MENU
)

echo %WARN% 此操作将删除所有 Actions 运行记录！
echo.
set "c="
set /p "c=确认删除所有 Actions? (y/n): "
if /i not "!c!"=="y" (
    echo %INFO% 已取消
    pause
    goto MENU
)

echo.
echo %INFO% 获取所有 Actions 运行...
set "_runfile=%TEMP%\swallownote_all_runs.tmp"
gh run list --repo !REPO! --json databaseId --jq ".[].databaseId" > "%_runfile%" 2>nul

set "_has=0"
for /f "usebackq delims=" %%i in ("%_runfile%") do set "_has=1"
if !_has! equ 0 (
    echo %INFO% 没有 Actions 运行
    del "%_runfile%" 2>nul
    pause
    goto MENU
)

echo %INFO% 正在删除...
set "_d=0"
set "_f=0"
for /f "usebackq delims=" %%i in ("%_runfile%") do (
    gh run delete "%%i" --repo !REPO! 2>nul
    if !errorlevel! equ 0 (
        set /a "_d+=1"
    ) else (
        set /a "_f+=1"
    )
)
echo %OK% 已删除: !_d! 个, 失败: !_f! 个
del "%_runfile%" 2>nul
echo.
pause
goto MENU


REM ============================================================
REM  5. 删除 Tag
REM ============================================================
:delete_tag
cls
echo.
echo === 删除 Tag ===
echo.
echo   1. 删除指定 Tag
echo   2. 删除所有 Tags
echo   0. 返回
echo.
set "sc="
set /p "sc=请选择: "

if "!sc!"=="1" goto del_one
if "!sc!"=="2" goto del_all
if "!sc!"=="0" goto MENU
echo %ERR% 无效选择
pause
goto delete_tag

:del_one
echo.
call :get_remote
if "!remote_name!"=="" (
    echo %ERR% 未找到远程仓库
    pause
    goto MENU
)

echo %INFO% 本地 Tags:
call :show_top_tags 10
echo.

set "tn="
set /p "tn=输入要删除的 tag 名称 (如 v1.7.8): "
if "!tn!"=="" (
    echo %ERR% 请输入 tag 名称
    pause
    goto MENU
)

call :tag_exists "!tn!"
if !tag_found! equ 0 (
    echo %ERR% 本地未找到 tag: !tn!
    pause
    goto MENU
)

echo.
set "c="
set /p "c=确认删除本地 tag '!tn!'? (y/n): "
if /i "!c!"=="y" (
    git tag -d "!tn!"
    echo %OK% 已删除本地 tag: !tn!
)

echo.
set "c="
set /p "c=同时删除远程 tag? (y/n): "
if /i "!c!"=="y" (
    git push "!remote_name!" --delete "!tn!" 2>nul
    if !errorlevel! equ 0 (
        echo %OK% 已删除远程 tag: !tn!
    ) else (
        echo %WARN% 远程 tag 可能不存在
    )
)

echo.
pause
goto MENU

:del_all
echo.
call :get_remote
if "!remote_name!"=="" (
    echo %ERR% 未找到远程仓库
    pause
    goto MENU
)

REM 将本地 Tags 存入临时文件 (与 release.sh 逻辑一致，方便两次遍历使用)
set "_tagfile=%TEMP%\swallownote_tags.tmp"
git tag --sort=-version:refname > "%_tagfile%" 2>nul

REM 检查是否有本地 Tags
set "_has_tags=0"
for /f "usebackq delims=" %%i in ("%_tagfile%") do (
    set "_has_tags=1"
    goto :has_tags_check
)
:has_tags_check
if !_has_tags! equ 0 (
    echo %INFO% 没有本地 Tags
    del "%_tagfile%" 2>nul
    pause
    goto MENU
)

echo %INFO% 本地 Tags:
call :show_top_tags 10
echo.

echo %WARN% 此操作将删除所有本地和远程 Tags！
echo.
set "c="
set /p "c=确认删除所有 Tags? (y/n): "
if /i not "!c!"=="y" (
    echo %INFO% 已取消
    del "%_tagfile%" 2>nul
    pause
    goto MENU
)

REM 删除本地 Tags (使用临时文件遍历，与 release.sh 的 local_tags 一致)
echo.
echo %INFO% 正在删除本地 Tags...
set "_d=0"
for /f "usebackq delims=" %%i in ("%_tagfile%") do (
    git tag -d "%%i" 2>nul
    if !errorlevel! equ 0 set /a "_d+=1"
)
echo %OK% 已删除本地 Tags: !_d! 个

REM 删除远程 Tags (使用同一份 tag 列表，与 release.sh 的 local_tags 一致)
echo %INFO% 正在删除远程 Tags...
set "_rd=0"
set "_rf=0"
for /f "usebackq delims=" %%i in ("%_tagfile%") do (
    git push "!remote_name!" --delete "%%i" 2>nul
    if !errorlevel! equ 0 (
        set /a "_rd+=1"
    ) else (
        set /a "_rf+=1"
    )
)
echo %OK% 已删除远程 Tags: !_rd! 个, 失败: !_rf! 个

del "%_tagfile%" 2>nul
echo.
pause
goto MENU


REM ============================================================
REM  6. 重新触发最新版本 GitHub Actions
REM  逻辑: 删除远程 tag + 重新推送 tag (与 release.sh 一致)
REM ============================================================
:rerun_latest
cls
echo.
echo === 重新触发最新版本 GitHub Actions ===
echo.

call :check_gh
if !gh_ok! equ 0 (
    pause
    goto MENU
)

call :get_remote
if "!remote_name!"=="" (
    echo %ERR% 未找到远程仓库
    pause
    goto MENU
)
echo %INFO% 检测到远程仓库: !remote_name!

echo %INFO% 获取最新版本 tag...
call :get_latest_tag
if "!latest_tag!"=="" (
    echo %ERR% 未找到任何 tag
    pause
    goto MENU
)

echo %INFO% 最新版本: !latest_tag!
echo.
set "c="
set /p "c=确认重新触发 !latest_tag! 的构建? (y/n): "
if /i not "!c!"=="y" (
    echo %INFO% 已取消
    pause
    goto MENU
)

echo.
echo %INFO% 删除远程 tag...
git push "!remote_name!" --delete "!latest_tag!" 2>nul
if !errorlevel! neq 0 echo %WARN% 远程 tag 可能不存在

echo %INFO% 重新推送 tag: !latest_tag!
git push "!remote_name!" "!latest_tag!"
if !errorlevel! equ 0 (
    echo %OK% 已重新触发 GitHub Actions!
    echo %INFO% 查看构建进度: https://github.com/!REPO!/actions
) else (
    echo %ERR% 推送失败
)

echo.
pause
goto MENU
