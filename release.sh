#!/bin/bash

set -e

# 配置
get_remote_info() {
    local remote_info
    remote_info=$(git remote -v 2>/dev/null | head -1)
    if [ -z "$remote_info" ]; then
        return 1
    fi
    # 提取仓库路径，支持 origin、SwallowScreen 等名称
    echo "$remote_info" | sed -E 's/.*github\.com[:/]([^.]+).*/\1/' | awk '{print $1}'
}

REPO_NAME=$(get_remote_info || echo "SwallowNote")

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

echo_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 检查 Git 状态
check_git_status() {
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        echo_error "当前目录不是 Git 仓库"
        exit 1
    fi
}

# 获取最新版本号
get_latest_release() {
    curl -s "https://api.github.com/repos/Qithking/SwallowNote/releases/latest" 2>/dev/null | \
        grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || echo ""
}

# 获取当前 git 版本
get_current_version() {
    # 获取本地最新 tag
    git tag --sort=-version:refname 2>/dev/null | head -1 || echo "v0.0.0"
}

# 提交并推送代码
push_to_github() {
    echo ""
    echo "=== 提交代码到 GitHub ==="
    echo ""
    
    # 检查远程仓库
    remote_name=$(git remote 2>/dev/null | head -1)
    if [ -z "$remote_name" ]; then
        echo_error "未找到远程仓库"
        exit 1
    fi
    echo_info "检测到远程仓库: $remote_name"
    
    # 检查分支
    current_branch=$(git branch --show-current)
    if [ "$current_branch" != "main" ]; then
        echo_warning "当前不在 main 分支 (当前: $current_branch)"
        read -p "是否切换到 main 分支? (y/n): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            git checkout main
        else
            echo_info "继续在当前分支操作"
        fi
    fi
    
    # 显示更改
    echo ""
    echo_info "当前更改:"
    git status --short
    
    echo ""
    if git diff-index --quiet HEAD -- 2>/dev/null; then
        echo_info "没有需要提交的更改"
    else
        echo ""
        read -p "输入提交信息 (留空使用默认): " commit_msg
        if [ -z "$commit_msg" ]; then
            commit_msg="Update: $(date '+%Y-%m-%d %H:%M:%S')"
        fi
        
        echo ""
        echo_info "执行: git add . && git commit -m '$commit_msg'"
        git add .
        git commit -m "$commit_msg"
        
        echo ""
        echo_info "推送到 $remote_name/$current_branch..."
        git push "$remote_name" "$current_branch"
        
        echo_success "代码已成功推送到 GitHub!"
    fi
}

# 发布版本
create_release() {
    echo ""
    echo "=== 创建新版本 ==="
    echo ""
    
    # 检查 GitHub CLI
    if ! command -v gh &> /dev/null; then
        echo_error "需要安装 GitHub CLI"
        echo "安装命令: brew install gh"
        exit 1
    fi
    
    # 检查登录状态
    if ! gh auth status &> /dev/null; then
        echo_error "未登录 GitHub"
        echo "请运行: gh auth login"
        exit 1
    fi
    
    # 获取远程仓库名称
    remote_name=$(git remote 2>/dev/null | head -1)
    if [ -z "$remote_name" ]; then
        echo_error "未找到远程仓库"
        exit 1
    fi
    echo_info "检测到远程仓库: $remote_name"
    
    # 获取当前版本
    current_version=$(get_current_version)
    echo_info "当前版本: $current_version"
    
    # 获取 GitHub 提交次数
    echo_info "获取 GitHub 提交记录..."
    commit_count=$(gh api repos/Qithking/SwallowNote/commits --jq '. | length' 2>/dev/null || echo "0")
    if [ "$commit_count" = "0" ]; then
        # 备用方案：获取总提交数
        commit_count=$(gh api repos/Qithking/SwallowNote/commits --paginate --jq 'length' 2>/dev/null || git rev-list --count HEAD 2>/dev/null || echo "0")
    fi
    echo_info "GitHub 提交次数: $commit_count"
    
    # 生成推荐版本号（基于当前版本递增 patch 版本）
    if [[ "$current_version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        major="${BASH_REMATCH[1]}"
        minor="${BASH_REMATCH[2]}"
        patch="${BASH_REMATCH[3]}"
        recommended_version="v${major}.${minor}.$((patch + 1))"
    else
        # 默认从 1.0.0 开始
        recommended_version="v1.0.1"
    fi
    
    echo ""
    echo_info "推荐版本号: $recommended_version"
    echo ""
    read -p "输入新版本号 (留空使用推荐版本号 $recommended_version): " new_version
    
    # 如果用户直接回车，使用推荐版本号
    if [ -z "$new_version" ]; then
        new_version="$recommended_version"
    else
        # 验证版本格式并添加 v 前缀
        if [[ "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            new_version="v$new_version"
        elif ! [[ "$new_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo_error "版本号格式错误，请使用 *.*.* 格式"
            exit 1
        fi
    fi
    
    echo_info "创建版本: $new_version"
    
    # 检查版本是否已存在
    if git tag | grep -q "^${new_version}$"; then
        echo_warning "版本 $new_version 已存在"
        read -p "是否删除旧 tag 并重新发布? (y/n): " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            git tag -d "$new_version" 2>/dev/null && echo_info "已删除本地 tag: $new_version"
            git push "$remote_name" --delete "$new_version" 2>/dev/null && echo_info "已删除远程 tag: $new_version" || echo_warning "远程 tag 可能不存在"
        else
            echo_info "已取消发布"
            return
        fi
    fi
    
    echo ""
    echo_info "创建 tag: $new_version"
    git tag "$new_version"
    
    echo ""
    echo_info "推送 tag 到 GitHub..."
    git push "$remote_name" "$new_version"
    
    echo_success "已创建版本 $new_version 并推送!"
    echo ""
    echo_info "GitHub Actions 将自动开始构建各平台安装包..."
    echo_info "查看构建进度: https://github.com/Qithking/SwallowNote/actions"
}

# 下载最新版本
download_latest() {
    echo ""
    echo "=== 下载最新版本 ==="
    echo ""
    
    # 获取最新版本信息
    echo_info "正在获取最新版本信息..."
    
    # 检查 GitHub CLI
    if command -v gh &> /dev/null && gh auth status &> /dev/null; then
        latest_info=$(gh release view --repo Qithking/SwallowNote --json tagName,url 2>/dev/null || echo "")
        latest_version=$(echo "$latest_info" | grep -o '"tagName"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
    fi
    
    # 备用方案: 使用 API
    if [ -z "$latest_version" ]; then
        latest_version=$(curl -s "https://api.github.com/repos/Qithking/SwallowNote/releases/latest" 2>/dev/null | \
            grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || echo "")
    fi
    
    if [ -z "$latest_version" ]; then
        echo_error "无法获取最新版本，请检查仓库地址"
        exit 1
    fi
    
    echo_info "最新版本: $latest_version"
    
    # 获取可用的下载资产
    echo ""
    echo_info "可用下载包:"
    
    if command -v gh &> /dev/null && gh auth status &> /dev/null; then
        assets=$(gh release view "$latest_version" --repo Qithking/SwallowNote --json assets -q '.assets[] | .name' 2>/dev/null || echo "")
        if [ -n "$assets" ]; then
            echo "$assets" | while read -r asset; do
                echo "  - $asset"
            done
        fi
    fi
    
    echo ""
    echo_info "下载链接: https://github.com/Qithking/SwallowNote/releases/tag/$latest_version"
    
    # 选择下载类型
    echo ""
    echo "选择下载类型:"
    echo "  1. macOS (DMG)"
    echo "  2. Windows (MSI)"
    echo "  3. Linux (AppImage)"
    echo "  4. Linux (DEB)"
    read -p "请选择 (1-4): " download_type
    
    case $download_type in
        1)
            asset_pattern="*-universal.dmg"
            ;;
        2)
            asset_pattern="*-x64.msi"
            ;;
        3)
            asset_pattern="*-x86_64.AppImage"
            ;;
        4)
            asset_pattern="*-x86_64.deb"
            ;;
        *)
            echo_error "无效选择"
            exit 1
            ;;
    esac
    
    echo ""
    read -p "确认下载? (y/n): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo_info "已取消"
        return
    fi
    
    cd ~/Downloads
    echo_info "开始下载..."
    
    download_url=""
    if command -v gh &> /dev/null && gh auth status &> /dev/null; then
        download_url=$(gh release view "$latest_version" --repo Qithking/SwallowNote --json assets -q ".assets[] | select(.name | test(\"$asset_pattern\")) | .url" 2>/dev/null || echo "")
    fi
    
    if [ -z "$download_url" ]; then
        download_url="https://github.com/Qithking/SwallowNote/releases/download/${latest_version}/SwallowNote-${latest_version}-${asset_pattern}"
    fi
    
    if command -v curl &> /dev/null; then
        curl -L -o "SwallowNote-${latest_version}.download" "$download_url" 2>&1
    elif command -v wget &> /dev/null; then
        wget -O "SwallowNote-${latest_version}.download" "$download_url"
    fi
    
    echo_success "下载完成!"
}

# 清除 GitHub Actions
clean_actions() {
    echo ""
    echo "=== 清除 GitHub Actions ==="
    echo ""
    echo "  1. 清除失败的 Actions"
    echo "  2. 清除所有 Actions"
    echo "  0. 返回"
    echo ""
    read -p "请选择: " sub_choice

    case $sub_choice in
        1)
            clean_failed_actions
            ;;
        2)
            clean_all_actions
            ;;
        0)
            return
            ;;
        *)
            echo_error "无效选择"
            ;;
    esac
}

# 清除失败的 GitHub Actions
clean_failed_actions() {
    echo ""
    echo "=== 清除失败的 GitHub Actions ==="
    echo ""

    if ! command -v gh &> /dev/null; then
        echo_error "需要安装 GitHub CLI"
        echo "安装命令: brew install gh"
        exit 1
    fi

    if ! gh auth status &> /dev/null; then
        echo_error "未登录 GitHub"
        echo "请运行: gh auth login"
        exit 1
    fi

    echo_info "获取失败的 Actions 运行..."

    failed_runs=$(gh run list --repo Qithking/SwallowNote --status failure --json databaseId,workflowName --jq '.[] | "\(.databaseId) \(.workflowName)"' 2>/dev/null)

    if [ -z "$failed_runs" ]; then
        echo_info "没有失败的 Actions 运行"
        return
    fi

    echo ""
    echo_info "找到以下失败的运行:"
    echo "$failed_runs" | while read -r id name; do
        echo "  - [$id] $name"
    done

    echo ""
    read -p "确认删除所有失败运行? (y/n): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        echo ""
        echo_info "正在删除..."
        echo "$failed_runs" | while read -r id name; do
            gh run delete "$id" --repo Qithking/SwallowNote 2>/dev/null && echo_success "已删除: $name ($id)" || echo_error "删除失败: $id"
        done
        echo_success "清理完成!"
    else
        echo_info "已取消"
    fi
}

# 清除所有 GitHub Actions
clean_all_actions() {
    echo ""
    echo "=== 清除所有 GitHub Actions ==="
    echo ""

    if ! command -v gh &> /dev/null; then
        echo_error "需要安装 GitHub CLI"
        echo "安装命令: brew install gh"
        exit 1
    fi

    if ! gh auth status &> /dev/null; then
        echo_error "未登录 GitHub"
        echo "请运行: gh auth login"
        exit 1
    fi

    echo_warning "此操作将删除所有 Actions 运行记录！"
    echo ""
    read -p "确认删除所有 Actions? (y/n): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo_info "已取消"
        return
    fi

    echo ""
    echo_info "获取所有 Actions 运行..."

    all_runs=$(gh run list --repo Qithking/SwallowNote --json databaseId --jq '.[] | .databaseId' 2>/dev/null)

    if [ -z "$all_runs" ]; then
        echo_info "没有 Actions 运行"
        return
    fi

    echo_info "正在删除..."
    deleted=0
    failed=0
    for id in $all_runs; do
        if gh run delete "$id" --repo Qithking/SwallowNote 2>/dev/null; then
            ((deleted++)) || true
        else
            ((failed++)) || true
        fi
    done
    echo_success "已删除: $deleted 个, 失败: $failed 个"
}

# 删除 tag
delete_tag() {
    echo ""
    echo "=== 删除 Tag ==="
    echo ""
    echo "  1. 删除指定 Tag"
    echo "  2. 删除所有 Tags"
    echo "  0. 返回"
    echo ""
    read -p "请选择: " sub_choice

    case $sub_choice in
        1)
            delete_single_tag
            ;;
        2)
            delete_all_tags
            ;;
        0)
            return
            ;;
        *)
            echo_error "无效选择"
            ;;
    esac
}

# 删除指定 tag
delete_single_tag() {
    echo ""
    echo "=== 删除指定 Tag ==="
    echo ""

    remote_name=$(git remote 2>/dev/null | head -1)
    if [ -z "$remote_name" ]; then
        echo_error "未找到远程仓库"
        exit 1
    fi

    echo_info "本地 Tags:"
    git tag --sort=-version:refname | head -10

    echo ""
    read -p "输入要删除的 tag 名称 (如 v1.7.8): " tag_name

    if [ -z "$tag_name" ]; then
        echo_error "请输入 tag 名称"
        exit 1
    fi

    if ! git tag | grep -q "^${tag_name}$"; then
        echo_error "本地未找到 tag: $tag_name"
        exit 1
    fi

    echo ""
    read -p "确认删除本地 tag '$tag_name'? (y/n): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        git tag -d "$tag_name"
        echo_success "已删除本地 tag: $tag_name"
    fi

    echo ""
    read -p "同时删除远程 tag '$tag_name'? (y/n): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        git push "$remote_name" --delete "$tag_name" 2>/dev/null && echo_success "已删除远程 tag: $tag_name" || echo_warning "远程 tag 可能不存在"
    fi
}

# 删除所有 tags
delete_all_tags() {
    echo ""
    echo "=== 删除所有 Tags ==="
    echo ""

    remote_name=$(git remote 2>/dev/null | head -1)
    if [ -z "$remote_name" ]; then
        echo_error "未找到远程仓库"
        exit 1
    fi

    local_tags=$(git tag --sort=-version:refname 2>/dev/null)
    if [ -z "$local_tags" ]; then
        echo_info "没有本地 Tags"
        return
    fi

    echo_info "本地 Tags:"
    echo "$local_tags" | head -10
    echo ""

    echo_warning "此操作将删除所有本地和远程 Tags！"
    echo ""
    read -p "确认删除所有 Tags? (y/n): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo_info "已取消"
        return
    fi

    echo ""
    echo_info "正在删除本地 Tags..."
    deleted_local=0
    for tag in $local_tags; do
        if git tag -d "$tag" 2>/dev/null; then
            ((deleted_local++)) || true
        fi
    done
    echo_success "已删除本地 Tags: $deleted_local 个"

    echo_info "正在删除远程 Tags..."
    deleted_remote=0
    failed_remote=0
    for tag in $local_tags; do
        if git push "$remote_name" --delete "$tag" 2>/dev/null; then
            ((deleted_remote++)) || true
        else
            ((failed_remote++)) || true
        fi
    done
    echo_success "已删除远程 Tags: $deleted_remote 个, 失败: $failed_remote 个"
}

# 重新触发最新版本的 GitHub Actions
rerun_latest_action() {
    echo ""
    echo "=== 重新触发最新版本的 GitHub Actions ==="
    echo ""
    
    # 检查 GitHub CLI
    if ! command -v gh &> /dev/null; then
        echo_error "需要安装 GitHub CLI"
        echo "安装命令: brew install gh"
        exit 1
    fi
    
    # 检查登录状态
    if ! gh auth status &> /dev/null; then
        echo_error "未登录 GitHub"
        echo "请运行: gh auth login"
        exit 1
    fi
    
    # 获取远程仓库名称
    remote_name=$(git remote 2>/dev/null | head -1)
    if [ -z "$remote_name" ]; then
        echo_error "未找到远程仓库"
        exit 1
    fi
    echo_info "检测到远程仓库: $remote_name"
    
    # 获取最新 tag
    echo_info "获取最新版本 tag..."
    latest_tag=$(git tag --sort=-version:refname 2>/dev/null | head -1)
    
    if [ -z "$latest_tag" ]; then
        echo_error "未找到任何 tag"
        exit 1
    fi
    
    echo_info "最新版本: $latest_tag"
    echo ""
    read -p "确认重新触发 $latest_tag 的构建? (y/n): " confirm
    
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo_info "已取消"
        return
    fi
    
    # 删除并重新推送 tag
    echo ""
    echo_info "删除远程 tag..."
    git push "$remote_name" --delete "$latest_tag" 2>/dev/null || echo_warning "远程 tag 可能不存在"
    
    echo_info "重新推送 tag: $latest_tag"
    git push "$remote_name" "$latest_tag"
    
    echo_success "已重新触发 GitHub Actions!"
    echo_info "查看构建进度: https://github.com/Qithking/SwallowNote/actions"
}

# 主菜单
show_menu() {
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║          SwallowNote 发布工具 v1.0              ║"
    echo "╠══════════════════════════════════════════════════╣"
    echo "║  1. 提交代码到 GitHub (main 分支)                ║"
    echo "║  2. 发布新版本 (创建 tag 触发 GitHub Actions)    ║"
    echo "║  3. 下载最新版本                                ║"
    echo "║  4. 清除 Actions                               ║"
    echo "║  5. 删除 Tag                                   ║"
    echo "║  6. 重新触发最新版本 GitHub Actions            ║"
    echo "║  0. 退出                                         ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
}

# 主程序
main() {
    check_git_status
    
    while true; do
        show_menu
        read -p "请选择操作 (0-6): " choice
        
        case $choice in
            1)
                push_to_github
                ;;
            2)
                create_release
                ;;
            3)
                download_latest
                ;;
            4)
                clean_actions
                ;;
            5)
                delete_tag
                ;;
            6)
                rerun_latest_action
                ;;
            0)
                echo_info "再见!"
                exit 0
                ;;
            *)
                echo_error "无效选择，请输入 0-6"
                ;;
        esac
        
        echo ""
        read -p "按 Enter 继续..." dummy
    done
}

main