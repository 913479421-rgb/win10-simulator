#!/bin/bash
# ============================================================
# Win10 模拟器 - GitHub Pages 一键部署脚本
# 用法: ./deploy-to-github.sh
# ============================================================

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════╗"
echo "║   Win10 模拟器 - GitHub Pages 部署工具       ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# 检查依赖
check_dependencies() {
    echo -e "${YELLOW}[1/5] 检查依赖...${NC}"
    
    if ! command -v git &> /dev/null; then
        echo -e "${RED}错误: 未安装 git${NC}"
        exit 1
    fi
    
    if ! command -v gh &> /dev/null; then
        echo -e "${RED}错误: 未安装 GitHub CLI (gh)${NC}"
        echo "安装方法: https://cli.github.com/"
        exit 1
    fi
    
    echo -e "${GREEN}  ✓ git $(git --version | awk '{print $3}')${NC}"
    echo -e "${GREEN}  ✓ gh $(gh --version | head -1 | awk '{print $3}')${NC}"
}

# 登录 GitHub
login_github() {
    echo ""
    echo -e "${YELLOW}[2/5] GitHub 认证${NC}"
    
    if gh auth status &> /dev/null; then
        echo -e "${GREEN}  ✓ 已登录: $(gh api user --jq .login)${NC}"
        return
    fi
    
    echo ""
    echo "请选择认证方式:"
    echo "  1) 设备码登录 (推荐，浏览器中授权)"
    echo "  2) Token 登录 (使用 Personal Access Token)"
    echo ""
    read -p "请选择 [1/2]: " auth_choice
    
    if [ "$auth_choice" = "1" ]; then
        echo ""
        echo -e "${YELLOW}正在启动设备码登录...${NC}"
        gh auth login --hostname github.com --git-protocol https --web
    elif [ "$auth_choice" = "2" ]; then
        echo ""
        echo "请输入 GitHub Personal Access Token:"
        echo "  生成地址: https://github.com/settings/tokens/new"
        echo "  需要权限: repo, workflow, read:org"
        echo ""
        read -s -p "Token: " GH_TOKEN
        echo ""
        echo "$GH_TOKEN" | gh auth login --hostname github.com --git-protocol https --with-token
    else
        echo -e "${RED}无效选择${NC}"
        exit 1
    fi
    
    if gh auth status &> /dev/null; then
        echo -e "${GREEN}  ✓ 登录成功: $(gh api user --jq .login)${NC}"
    else
        echo -e "${RED}登录失败${NC}"
        exit 1
    fi
}

# 配置仓库
setup_repo() {
    echo ""
    echo -e "${YELLOW}[3/5] 创建 GitHub 仓库${NC}"
    
    DEFAULT_REPO="win10-simulator"
    read -p "仓库名称 [默认: $DEFAULT_REPO]: " REPO_NAME
    REPO_NAME=${REPO_NAME:-$DEFAULT_REPO}
    
    DEFAULT_DESC="在手机浏览器中运行真实 Windows 10 的 PWA 应用"
    read -p "仓库描述 [默认: $DEFAULT_DESC]: " REPO_DESC
    REPO_DESC=${REPO_DESC:-$DEFAULT_DESC}
    
    echo ""
    echo "仓库可见性:"
    echo "  1) 公开 (Public) - GitHub Pages 免费"
    echo "  2) 私有 (Private) - 需要 Pro 账号才能用 Pages"
    read -p "请选择 [1/2，默认: 1]: " vis_choice
    
    if [ "$vis_choice" = "2" ]; then
        VISIBILITY="--private"
    else
        VISIBILITY="--public"
    fi
    
    # 检查仓库是否已存在
    USERNAME=$(gh api user --jq .login)
    if gh repo view "$USERNAME/$REPO_NAME" &> /dev/null; then
        echo -e "${YELLOW}  仓库已存在，将使用现有仓库${NC}"
    else
        echo "  创建仓库: $USERNAME/$REPO_NAME"
        gh repo create "$REPO_NAME" $VISIBILITY --description "$REPO_DESC" --source=. --remote=origin 2>/dev/null || \
        gh repo create "$REPO_NAME" $VISIBILITY --description "$REPO_DESC"
        echo -e "${GREEN}  ✓ 仓库创建成功${NC}"
    fi
    
    REPO_URL="https://github.com/$USERNAME/$REPO_NAME"
    echo "  仓库地址: $REPO_URL"
}

# 初始化 git 并推送
push_code() {
    echo ""
    echo -e "${YELLOW}[4/5] 推送代码${NC}"
    
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cd "$SCRIPT_DIR"
    
    # 初始化 git
    if [ ! -d ".git" ]; then
        git init
        git checkout -b main
    fi
    
    # 配置用户
    if ! git config user.email &> /dev/null; then
        git config user.email "$(gh api user --jq .email || echo 'user@example.com')"
    fi
    if ! git config user.name &> /dev/null; then
        git config user.name "$(gh api user --jq .login)"
    fi
    
    # 添加远程
    if ! git remote get-url origin &> /dev/null; then
        git remote add origin "https://github.com/$(gh api user --jq .login)/$REPO_NAME.git"
    fi
    
    # 创建 .gitignore
    cat > .gitignore << 'EOF'
.DS_Store
*.log
node_modules/
EOF
    
    # 添加并提交
    git add -A
    git commit -m "feat: Win10 模拟器 PWA 初始版本

- WebAssembly (v86) 全系统虚拟化
- IndexedDB 虚拟磁盘存储
- PWA 支持，可添加到主屏幕
- 触摸和键盘输入支持
- 深色主题 UI" 2>/dev/null || echo "  无新变更"
    
    # 推送
    echo "  推送到 GitHub..."
    git push -u origin main --force 2>/dev/null || git push -u origin main
    
    echo -e "${GREEN}  ✓ 代码推送成功${NC}"
}

# 启用 GitHub Pages
enable_pages() {
    echo ""
    echo -e "${YELLOW}[5/5] 启用 GitHub Pages${NC}"
    
    USERNAME=$(gh api user --jq .login)
    
    # 尝试通过 API 启用 Pages
    echo "  配置 Pages 源: main 分支 / (root)"
    
    # 方法1: 使用 gh api 启用 Pages
    ENABLE_RESULT=$(gh api -X POST \
        -H "Accept: application/vnd.github+json" \
        "/repos/$USERNAME/$REPO_NAME/pages" \
        -f "source[branch]=main" \
        -f "source[path]=/" 2>&1) || true
    
    if echo "$ENABLE_RESULT" | grep -q "html_url"; then
        PAGES_URL=$(echo "$ENABLE_RESULT" | grep -o '"html_url": *"[^"]*"' | cut -d'"' -f4)
        echo -e "${GREEN}  ✓ GitHub Pages 已启用${NC}"
    else
        # 方法2: 创建 .nojekyll 并提示手动启用
        touch .nojekyll
        git add .nojekyll
        git commit -m "chore: add .nojekyll for GitHub Pages" 2>/dev/null || true
        git push 2>/dev/null || true
        
        echo -e "${YELLOW}  ⚠ 需要手动启用 Pages（API 可能受限）${NC}"
        echo ""
        echo "  请按以下步骤操作:"
        echo "  1. 打开: $REPO_URL/settings/pages"
        echo "  2. Source 选择: Deploy from a branch"
        echo "  3. Branch 选择: main, / (root)"
        echo "  4. 点击 Save"
        echo ""
        PAGES_URL="https://$USERNAME.github.io/$REPO_NAME/"
    fi
    
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          部署完成！                           ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  📦 仓库地址: ${BLUE}$REPO_URL${NC}"
    echo -e "  🌐 网站地址: ${BLUE}$PAGES_URL${NC}"
    echo ""
    echo -e "${YELLOW}  注意:${NC}"
    echo "  - Pages 部署可能需要 1-3 分钟生效"
    echo "  - 首次访问可能显示 404，请稍等刷新"
    echo "  - 手机访问该网址后，选择「添加到主屏幕」即可安装"
    echo ""
}

# 主流程
main() {
    check_dependencies
    login_github
    setup_repo
    push_code
    enable_pages
}

main "$@"
