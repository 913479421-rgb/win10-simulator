# Win10 模拟器 - 网页书签版 (PWA)

在手机浏览器中运行**真实 Windows 10** 的渐进式网页应用（PWA），可添加到主屏幕作为书签图标，使用手机的内存和存储本地运行虚拟机。

## 核心特性

- **真实 Windows 10**：基于 WebAssembly (v86/QEMU-WASM) 全系统虚拟化，运行完整的 x86 Windows 10
- **手机本地运行**：使用手机 RAM 作为虚拟机内存，IndexedDB 存储虚拟磁盘和 ISO
- **书签安装**：添加到主屏幕后像原生 App 一样运行，全屏无地址栏
- **离线可用**：Service Worker 缓存所有资源，无需网络即可运行
- **跨平台**：支持 Android、iOS (iPhone 15)、iPad、桌面浏览器
- **触摸操作**：单指点击/拖动、长按右键、双指缩放
- **外接键盘**：支持蓝牙/USB-C 外接键盘直接输入

## 技术架构

```
┌─────────────────────────────────────┐
│           手机浏览器 (PWA)            │
├─────────────────────────────────────┤
│  UI 层 (HTML/CSS/JS)                │
│  ├─ 控制面板                        │
│  ├─ VNC/帧缓冲显示 (Canvas)         │
│  └─ 触摸/键盘输入                   │
├─────────────────────────────────────┤
│  虚拟化引擎                          │
│  └─ v86 (WebAssembly x86 模拟器)    │
│     ├─ CPU 模拟 (TCG)               │
│     ├─ 内存管理 (WASM Memory)       │
│     ├─ 显卡模拟 (Cirrus VGA)        │
│     └─ 存储模拟 (IDE/SATA)          │
├─────────────────────────────────────┤
│  存储层                              │
│  └─ IndexedDB                       │
│     ├─ 虚拟磁盘 (QCOW/RAW, 分块存储) │
│     └─ ISO 镜像                     │
├─────────────────────────────────────┤
│  手机硬件                            │
│  ├─ RAM (虚拟机内存来源)            │
│  ├─ 闪存 (虚拟磁盘存储)             │
│  └─ CPU (WebAssembly 执行)          │
└─────────────────────────────────────┘
```

## 快速开始

### 1. 部署

将所有文件上传到任意 HTTPS 静态托管服务：
- GitHub Pages
- Vercel / Netlify
- Cloudflare Pages
- 本地服务器（需 HTTPS 或 localhost）

```bash
# 本地测试
python3 -m http.server 8080
# 然后访问 http://localhost:8080
```

### 2. 添加到主屏幕

**iPhone (Safari)：**
1. 用 Safari 打开网页
2. 点击底部分享按钮
3. 选择「添加到主屏幕」
4. 点击添加，主屏幕出现 Win10 图标

**Android (Chrome)：**
1. 用 Chrome 打开网页
2. 点击菜单（三个点）
3. 选择「添加到主屏幕」或「安装应用」
4. 确认安装

### 3. 安装 Windows 10

1. 打开应用，点击「创建虚拟磁盘」（建议 32GB）
2. 点击「选择 Windows ISO」，从手机文件中选择 Win10 镜像
3. 进入设置，开启「从光驱启动」
4. 点击「启动 Windows 10」，等待 WebAssembly 引擎加载
5. 点击「显示桌面」，进入 Windows 安装界面
6. 按照正常流程安装 Windows 10
7. 安装完成后，关闭「从光驱启动」，重启即可

## 性能说明

### 预期性能

由于 WebAssembly 和 TCG 解释执行的限制，性能约为原生 x86 的 3-8%：

| 操作 | 预期表现 |
|------|----------|
| 启动时间 | 10-30 分钟 |
| 桌面响应 | 基本可用，有延迟 |
| 记事本/写字板 | 流畅 |
| 网页浏览 | 简单网页可用 |
| Office | 较卡 |
| 视频播放 | 480p 以下 |
| 3D 游戏 | 不建议 |

### 性能优化建议

1. **使用高性能手机**：iPhone 15 Pro (A17 Pro) 或旗舰 Android
2. **连接电源**：防止低电量降频
3. **关闭低电量模式**
4. **分配足够内存**：建议 1024-2048MB（根据手机 RAM）
5. **降低分辨率**：在 Windows 中设置 1024x768 或更低
6. **关闭 Windows 动画效果**
7. **使用散热背夹**：防止发热降频

### 内存限制

- 手机浏览器通常限制单个标签页 2-4GB 内存
- 建议虚拟机内存设置为 512-1024MB
- iPhone 15 (6GB RAM) 建议分配 1024MB
- iPhone 15 Pro (8GB RAM) 可分配 2048MB

### 存储限制

- IndexedDB 存储上限通常为手机可用存储的 50-60%
- 32GB 虚拟磁盘需要手机至少 64GB 可用空间
- 虚拟磁盘是稀疏文件，实际占用随使用增长

## 文件结构

```
Win10Simulator-Web/
├── index.html              # 主页面
├── manifest.json           # PWA 清单
├── service-worker.js       # 离线缓存
├── README.md               # 本文档
├── css/
│   └── style.css           # 样式（深色主题+移动端适配）
├── js/
│   ├── app.js              # 主应用逻辑（UI/输入/配置）
│   ├── vm.js               # 虚拟机管理器（v86 集成）
│   ├── vnc.js              # VNC 客户端（备用远程连接）
│   └── storage.js          # IndexedDB 存储管理器
└── icons/
    ├── icon-192.png        # 应用图标
    ├── icon-512.png
    └── icon-1024.png
```

## 与其他版本对比

| 特性 | Android APK | iOS IPA | 网页书签版 (PWA) |
|------|-------------|---------|-----------------|
| 真实 Windows | ✅ | ✅ | ✅ |
| 安装方式 | APK 侧载 | IPA 侧载 | 添加到主屏幕 |
| 无需编译 | ❌ | ❌ | ✅ |
| 跨平台 | ❌ | ❌ | ✅ |
| 离线运行 | ✅ | ✅ | ✅ |
| 性能 | 较好 (原生 QEMU) | 有限 (TCG) | 有限 (WASM) |
| 内存上限 | 高 | 中 | 低 (浏览器限制) |
| 存储上限 | 高 | 高 | 中 (IndexedDB) |
| 上架商店 | 难 | 不可 | 无需上架 |

## 常见问题

### Q: 为什么这么慢？
A: WebAssembly 无法使用 JIT 动态编译，x86 指令需要逐条解释执行。这是浏览器沙盒的固有限制。

### Q: 可以提升性能吗？
A: 在非越狱设备上，性能上限受限于 WebAssembly。可以尝试：
- 使用最新版 Chrome/Safari（WASM 优化更好）
- 关闭其他后台应用
- 降低 Windows 分辨率和特效
- 使用性能模式手机

### Q: 虚拟磁盘文件在哪里？
A: 存储在浏览器的 IndexedDB 中，路径为 `Win10Simulator` 数据库。可以通过浏览器开发者工具查看，或使用应用内的存储管理功能。

### Q: 清除浏览器数据会丢失虚拟机吗？
A: 是的。清除网站数据会删除 IndexedDB 中的虚拟磁盘。建议定期备份重要文件。

### Q: 可以连接网络吗？
A: v86 支持通过 WebSocket 代理连接网络，需要部署 websockify 代理服务。默认配置下网络不可用。

### Q: 支持多开吗？
A: 不建议。同时运行多个虚拟机会超出浏览器内存限制。

## 技术细节

### WebAssembly 引擎

本项目使用 [v86](https://github.com/copy/v86) 作为 WebAssembly 虚拟化引擎：
- 支持 x86 实模式和保护模式
- 内置 TCG 代码生成器（WASM 版本）
- 支持多种显卡（Cirrus、VGA）
- 支持 IDE/SATA 存储
- 开源（BSD 协议）

### IndexedDB 分块存储

虚拟磁盘采用 4MB 分块存储在 IndexedDB 中：
- 支持数 GB 大小的虚拟磁盘
- 稀疏写入，未使用的块不占空间
- 异步读写，不阻塞 UI

### PWA 特性

- **manifest.json**：定义应用名称、图标、显示模式
- **Service Worker**：离线缓存所有资源
- **全屏模式**：添加到主屏幕后隐藏浏览器 UI
- **安全区域适配**：适配 iPhone 灵动岛和 Home Indicator

## 许可证

本项目代码基于 MIT 许可证开源。Windows 10 是 Microsoft Corporation 的商标。v86 基于 BSD 许可证开源。

## 参考项目

- [v86](https://github.com/copy/v86) - WebAssembly x86 模拟器
- [UTM](https://github.com/utmapp/UTM) - iOS QEMU 前端
- [WebVM](https://webvm.io/) - 浏览器中的 Linux 虚拟机
