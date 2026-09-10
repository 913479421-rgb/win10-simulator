/**
 * Win10 模拟器 - 主应用逻辑
 * 负责 UI 交互、配置管理、输入转发
 */

// 全局状态
const AppState = {
    vm: null,
    storage: null,
    isDisplayOpen: false,
    modifierKeys: { ctrl: false, alt: false, shift: false, win: false }
};

// 官方 ISO 预配置
const OFFICIAL_ISO = {
    filename: 'Win10_22H2_Chinese_Simplified_x32v1.iso',
    size: 4364279808,
    version: 'Windows 10 22H2 简体中文 32位',
    md5: '7b3e7deadde4b4d0df38d4d45f94c4d5',
    downloadUrl: 'https://www.microsoft.com/zh-cn/software-download/windows10ISO',
    // GitHub Release 分片下载
    releaseParts: [
        'https://github.com/913479421-rgb/win10-simulator/releases/download/v1.0.0-iso/Win10_22H2_x86_zh-CN.iso.part00',
        'https://github.com/913479421-rgb/win10-simulator/releases/download/v1.0.0-iso/Win10_22H2_x86_zh-CN.iso.part01',
        'https://github.com/913479421-rgb/win10-simulator/releases/download/v1.0.0-iso/Win10_22H2_x86_zh-CN.iso.part02'
    ]
};

// DOM 元素
const DOM = {};

// PS/2 扫描码 (set 1)
const SCANCODES = {
    'Escape': 0x01, '1': 0x02, '2': 0x03, '3': 0x04, '4': 0x05,
    '5': 0x06, '6': 0x07, '7': 0x08, '8': 0x09, '9': 0x0A, '0': 0x0B,
    '-': 0x0C, '=': 0x0D, 'Backspace': 0x0E, 'Tab': 0x0F,
    'q': 0x10, 'w': 0x11, 'e': 0x12, 'r': 0x13, 't': 0x14,
    'y': 0x15, 'u': 0x16, 'i': 0x17, 'o': 0x18, 'p': 0x19,
    '[': 0x1A, ']': 0x1B, 'Enter': 0x1C, 'Control': 0x1D,
    'a': 0x1E, 's': 0x1F, 'd': 0x20, 'f': 0x21, 'g': 0x22,
    'h': 0x23, 'j': 0x24, 'k': 0x25, 'l': 0x26, ';': 0x27,
    "'": 0x28, '`': 0x29, 'Shift': 0x2A, '\\': 0x2B,
    'z': 0x2C, 'x': 0x2D, 'c': 0x2E, 'v': 0x2F, 'b': 0x30,
    'n': 0x31, 'm': 0x32, ',': 0x33, '.': 0x34, '/': 0x35,
    ' ': 0x39, 'CapsLock': 0x3A,
    'F1': 0x3B, 'F2': 0x3C, 'F3': 0x3D, 'F4': 0x3E,
    'F5': 0x3F, 'F6': 0x40, 'F7': 0x41, 'F8': 0x42,
    'F9': 0x43, 'F10': 0x44, 'F11': 0x57, 'F12': 0x58,
    'ArrowUp': 0x48, 'ArrowDown': 0x50, 'ArrowLeft': 0x4B, 'ArrowRight': 0x4D,
    'Home': 0x47, 'End': 0x4F, 'PageUp': 0x49, 'PageDown': 0x51,
    'Insert': 0x52, 'Delete': 0x53,
    'Meta': 0x5B, 'Alt': 0x38
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    initVM();
    initStorage();
    initEventListeners();
    updateStorageInfo();
    checkInstallPrompt();
    registerServiceWorker();
});

// 初始化 DOM 引用
function initDOM() {
    const ids = [
        'status-indicator', 'status-value', 'stat-memory', 'stat-disk', 'stat-storage',
        'progress-container', 'progress-fill', 'progress-text',
        'btn-start', 'btn-stop', 'btn-display', 'btn-settings',
        'btn-create-disk', 'input-iso', 'btn-save-settings',
        'settings-panel', 'setting-memory', 'setting-memory-value',
        'setting-disk-size', 'setting-boot-cd', 'setting-network',
        'info-system-disk', 'info-iso',
        'log-output', 'btn-clear-log',
        'display-overlay', 'btn-close-display', 'btn-keyboard',
        'screen_container', 'btn-right-click', 'btn-esc',
        'install-prompt', 'btn-dismiss-install',
        'iso-presets', 'btn-use-preset-iso', 'btn-download-iso', 'btn-auto-download-iso'
    ];
    ids.forEach(id => {
        DOM[id] = document.getElementById(id);
    });
}

// 初始化虚拟机
function initVM() {
    AppState.vm = new VMManager();

    // v86 使用 screen_container（包含 div + canvas）
    AppState.vm.setScreenContainer(DOM['screen_container']);

    AppState.vm.onStateChange = (state) => {
        updateStatus(state);
        updateButtons(state);
    };

    AppState.vm.onLog = (message, type) => {
        addLog(message, type);
    };

    updateConfigDisplay();
}

// 初始化存储
function initStorage() {
    AppState.storage = new StorageManager();
    AppState.storage.requestPersistentStorage();
}

// 初始化事件监听
function initEventListeners() {
    // 控制按钮
    DOM['btn-start'].addEventListener('click', startVM);
    DOM['btn-stop'].addEventListener('click', stopVM);
    DOM['btn-display'].addEventListener('click', openDisplay);
    DOM['btn-settings'].addEventListener('click', toggleSettings);

    // 存储管理
    DOM['btn-create-disk'].addEventListener('click', createDisk);
    DOM['input-iso'].addEventListener('change', handleIsoSelect);

    // 预配置 ISO
    if (DOM['btn-use-preset-iso']) {
        DOM['btn-use-preset-iso'].addEventListener('click', usePresetIso);
    }

    // 自动下载 ISO
    if (DOM['btn-auto-download-iso']) {
        DOM['btn-auto-download-iso'].addEventListener('click', autoDownloadAndImportIso);
    }

    // 检测已下载的官方 ISO
    checkForDownloadedIso();

    // 设置
    DOM['setting-memory'].addEventListener('input', (e) => {
        DOM['setting-memory-value'].textContent = e.target.value + ' MB';
    });
    DOM['btn-save-settings'].addEventListener('click', saveSettings);

    // 日志
    DOM['btn-clear-log'].addEventListener('click', () => {
        DOM['log-output'].innerHTML = '';
    });

    // 显示层
    DOM['btn-close-display'].addEventListener('click', closeDisplay);
    DOM['btn-keyboard'].addEventListener('click', toggleKeyboard);
    DOM['btn-right-click'].addEventListener('click', sendRightClick);
    DOM['btn-esc'].addEventListener('click', sendEsc);

    // 修饰键
    document.querySelectorAll('.ctrl-btn[data-key]').forEach(btn => {
        btn.addEventListener('click', () => toggleModifier(btn.dataset.key));
    });

    // screen_container 点击锁定鼠标（v86 自动处理鼠标）
    DOM['screen_container'].addEventListener('click', () => {
        if (AppState.vm && AppState.vm.isRunning) {
            AppState.vm.lockMouse();
        }
    });

    // 物理键盘
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // 安装提示
    DOM['btn-dismiss-install'].addEventListener('click', () => {
        DOM['install-prompt'].style.display = 'none';
        localStorage.setItem('install_prompt_dismissed', 'true');
    });

    // 防止双击缩放
    document.addEventListener('dblclick', (e) => e.preventDefault());
}

// 启动虚拟机
async function startVM() {
    if (AppState.vm.isRunning) return;
    await AppState.vm.start();
}

// 停止虚拟机
async function stopVM() {
    if (!AppState.vm.isRunning) return;
    await AppState.vm.stop();
}

// 打开显示层
function openDisplay() {
    if (!AppState.vm.isRunning) {
        addLog('请先启动虚拟机', 'warn');
        return;
    }
    DOM['display-overlay'].style.display = 'flex';
    AppState.isDisplayOpen = true;

    // 尝试全屏
    if (DOM['display-overlay'].requestFullscreen) {
        DOM['display-overlay'].requestFullscreen().catch(() => {});
    }

    // 锁定鼠标
    setTimeout(() => {
        if (AppState.vm && AppState.vm.isRunning) {
            AppState.vm.lockMouse();
        }
    }, 500);
}

// 关闭显示层
function closeDisplay() {
    DOM['display-overlay'].style.display = 'none';
    AppState.isDisplayOpen = false;
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
}

// 切换设置面板
function toggleSettings() {
    const panel = DOM['settings-panel'];
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// 创建虚拟磁盘
async function createDisk() {
    const sizeGB = parseInt(DOM['setting-disk-size'].value);
    const sizeMB = sizeGB * 1024;

    showProgress(`正在创建 ${sizeGB}GB 虚拟磁盘...`, 10);

    try {
        const exists = await AppState.storage.diskExists('windows10.img');
        if (exists) {
            if (!confirm(`系统盘已存在（${sizeGB}GB），是否覆盖？\n这将删除所有已安装的系统和数据！`)) {
                hideProgress();
                return;
            }
            await AppState.storage.deleteDisk('windows10.img');
        }

        await AppState.storage.createDisk('windows10.img', sizeMB);
        showProgress('虚拟磁盘创建完成', 100);
        addLog(`虚拟磁盘创建成功: ${sizeGB} GB`, 'success');
        updateStorageInfo();

        setTimeout(hideProgress, 1500);
    } catch (error) {
        addLog(`创建磁盘失败: ${error.message}`, 'error');
        hideProgress();
    }
}

// 处理 ISO 选择
async function handleIsoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.iso') && !file.name.toLowerCase().endsWith('.img')) {
        addLog('请选择 .iso 或 .img 格式的镜像文件', 'warn');
        return;
    }

    await importIsoFile(file);

    // 重置 input，允许重复选择同一文件
    event.target.value = '';
}

// 导入 ISO 文件（通用函数）
async function importIsoFile(file) {
    const sizeGB = (file.size / 1024 / 1024 / 1024).toFixed(2);
    addLog(`正在导入 ISO: ${file.name} (${sizeGB} GB)...`);
    addLog('大文件导入可能需要几分钟，请耐心等待，请勿关闭页面...');

    // 检查存储空间
    const usage = await AppState.storage.getStorageUsage();
    if (usage && usage.available < file.size) {
        const availableGB = (usage.available / 1024 / 1024 / 1024).toFixed(1);
        addLog(`警告: 手机可用存储不足 (${availableGB} GB)，导入可能失败`, 'warn');
    }

    try {
        const result = await AppState.storage.importIso(file, (percent, name) => {
            showProgress(`正在导入 ${name}... ${percent}%`, percent);
        });

        AppState.vm.config.cdromPath = result.name;
        AppState.vm.saveConfig();

        addLog(`ISO 导入完成: ${result.name}`, 'success');
        addLog('请在设置中开启「从光驱启动」后再启动虚拟机', 'info');
        updateStorageInfo();

        // 隐藏预配置提示
        if (DOM['iso-presets']) {
            DOM['iso-presets'].style.display = 'none';
        }

        setTimeout(hideProgress, 1500);
        return true;
    } catch (error) {
        addLog(`ISO 导入失败: ${error.message}`, 'error');
        addLog('请确保有足够的存储空间，并重试', 'warn');
        hideProgress();
        return false;
    }
}

// 检测已下载的官方 ISO（通过检查 IndexedDB 中是否已有）
async function checkForDownloadedIso() {
    try {
        const isos = await AppState.storage.listIsos();
        const hasOfficial = isos.some(iso => iso.name === OFFICIAL_ISO.filename);

        if (!hasOfficial && DOM['iso-presets']) {
            // 显示预配置提示（用户需要先下载 ISO）
            DOM['iso-presets'].style.display = 'block';
        }
    } catch (error) {
        console.error('检测 ISO 失败', error);
    }
}

// 使用预配置 ISO（触发文件选择器，用户选择已下载的文件）
function usePresetIso() {
    addLog(`请选择已下载的官方镜像: ${OFFICIAL_ISO.filename}`, 'info');
    addLog(`版本: ${OFFICIAL_ISO.version} (约 4GB)`, 'info');
    DOM['input-iso'].click();
}

// 自动下载并导入 ISO（从 GitHub Release 下载分片并合并）
async function autoDownloadAndImportIso() {
    // 检查是否已存在
    const isos = await AppState.storage.listIsos();
    const exists = isos.some(iso => iso.name === OFFICIAL_ISO.filename);
    if (exists) {
        if (!confirm('检测到已导入的官方 ISO，是否重新下载并覆盖？')) {
            return;
        }
        // 删除旧的
        for (const iso of isos) {
            if (iso.name === OFFICIAL_ISO.filename) {
                await AppState.storage.deleteDisk(iso.name);
            }
        }
    }

    addLog('开始自动下载 Windows 10 官方 ISO...', 'info');
    addLog(`从 GitHub Release 下载 ${OFFICIAL_ISO.releaseParts.length} 个分片`, 'info');
    addLog('总大小约 4GB，下载时间取决于网络速度，请耐心等待...', 'info');

    try {
        const parts = [];
        let totalDownloaded = 0;
        const totalSize = OFFICIAL_ISO.size;

        // 逐个下载分片
        for (let i = 0; i < OFFICIAL_ISO.releaseParts.length; i++) {
            const url = OFFICIAL_ISO.releaseParts[i];
            addLog(`正在下载分片 ${i + 1}/${OFFICIAL_ISO.releaseParts.length}...`, 'info');

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`下载分片 ${i + 1} 失败: HTTP ${response.status}`);
            }

            // 使用 ReadableStream 逐块读取，显示进度
            const reader = response.body.getReader();
            const chunks = [];
            let partSize = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                partSize += value.length;
                totalDownloaded += value.length;

                const percent = Math.min(99, Math.round((totalDownloaded / totalSize) * 100));
                showProgress(`正在下载 ISO... ${percent}% (${(totalDownloaded / 1024 / 1024 / 1024).toFixed(2)} GB)`, percent);
            }

            const partBlob = new Blob(chunks);
            parts.push(partBlob);
            addLog(`分片 ${i + 1} 下载完成 (${(partSize / 1024 / 1024).toFixed(0)} MB)`, 'success');
        }

        // 合并分片
        addLog('正在合并分片...', 'info');
        showProgress('正在合并 ISO 文件...', 99);
        const mergedBlob = new Blob(parts, { type: 'application/octet-stream' });

        // 验证大小
        if (mergedBlob.size !== OFFICIAL_ISO.size) {
            addLog(`警告: 合并后大小 (${mergedBlob.size}) 与预期 (${OFFICIAL_ISO.size}) 不符`, 'warn');
        }

        // 转换为 File 对象
        const isoFile = new File([mergedBlob], OFFICIAL_ISO.filename, {
            type: 'application/octet-stream',
            lastModified: Date.now()
        });

        // 导入到 IndexedDB
        addLog('正在导入到本地存储...', 'info');
        const success = await importIsoFile(isoFile);

        if (success) {
            addLog('自动下载并导入完成！', 'success');
            addLog('请在设置中开启「从光驱启动」后启动虚拟机', 'info');

            // 隐藏预配置提示
            if (DOM['iso-presets']) {
                DOM['iso-presets'].style.display = 'none';
            }
        }

    } catch (error) {
        addLog(`自动下载失败: ${error.message}`, 'error');
        addLog('请尝试手动从微软官网下载，然后通过「选择 Windows ISO」导入', 'warn');
        hideProgress();
    }
}

// 保存设置
function saveSettings() {
    const config = AppState.vm.config;
    config.memorySize = parseInt(DOM['setting-memory'].value);
    config.diskSize = parseInt(DOM['setting-disk-size'].value) * 1024;
    config.bootFromCd = DOM['setting-boot-cd'].checked;
    config.enableNetwork = DOM['setting-network'].checked;

    AppState.vm.saveConfig();
    updateConfigDisplay();
    addLog('设置已保存', 'success');

    if (config.bootFromCd) {
        addLog('已设置从光驱启动，下次启动将进入 Windows 安装', 'info');
    }

    DOM['settings-panel'].style.display = 'none';
}

// 更新配置显示
function updateConfigDisplay() {
    const config = AppState.vm.config;
    DOM['stat-memory'].textContent = config.memorySize + ' MB';
    DOM['stat-disk'].textContent = (config.diskSize / 1024) + ' GB';
    DOM['setting-memory'].value = config.memorySize;
    DOM['setting-memory-value'].textContent = config.memorySize + ' MB';
    DOM['setting-disk-size'].value = config.diskSize / 1024;
    DOM['setting-boot-cd'].checked = config.bootFromCd;
    DOM['setting-network'].checked = config.enableNetwork;
}

// 更新存储信息
async function updateStorageInfo() {
    try {
        const diskExists = await AppState.storage.diskExists('windows10.img');
        DOM['info-system-disk'].textContent = diskExists ? 'windows10.img' : '未创建';

        const isos = await AppState.storage.listIsos();
        if (isos.length > 0) {
            DOM['info-iso'].textContent = isos[0].name;
        } else {
            DOM['info-iso'].textContent = AppState.vm.config.cdromPath || '未选择';
        }

        const usage = await AppState.storage.getStorageUsage();
        if (usage) {
            const availableGB = (usage.available / 1024 / 1024 / 1024).toFixed(1);
            DOM['stat-storage'].textContent = availableGB + ' GB';
        }
    } catch (error) {
        console.error('更新存储信息失败', error);
    }
}

// 更新状态显示
function updateStatus(state) {
    const indicator = DOM['status-indicator'];
    const value = DOM['status-value'];

    indicator.className = 'status-indicator';

    switch (state) {
        case 'running':
            indicator.classList.add('running');
            value.textContent = '运行中';
            break;
        case 'starting':
            indicator.classList.add('starting');
            value.textContent = '启动中...';
            break;
        case 'stopping':
            indicator.classList.add('stopping');
            value.textContent = '关闭中...';
            break;
        case 'error':
            indicator.classList.add('error');
            value.textContent = '错误';
            break;
        default:
            value.textContent = '已停止';
    }
}

// 更新按钮状态
function updateButtons(state) {
    const running = state === 'running';
    const busy = state === 'starting' || state === 'stopping';

    DOM['btn-start'].disabled = running || busy;
    DOM['btn-stop'].disabled = !running && !busy;
    DOM['btn-display'].disabled = !running;
}

// 添加日志
function addLog(message, type = 'info') {
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    DOM['log-output'].appendChild(line);
    DOM['log-output'].scrollTop = DOM['log-output'].scrollHeight;

    // 限制日志行数
    while (DOM['log-output'].children.length > 200) {
        DOM['log-output'].removeChild(DOM['log-output'].firstChild);
    }
}

// 显示进度
function showProgress(text, percent) {
    DOM['progress-container'].style.display = 'block';
    DOM['progress-text'].textContent = text;
    DOM['progress-fill'].style.width = percent + '%';
}

// 隐藏进度
function hideProgress() {
    DOM['progress-container'].style.display = 'none';
}

// === 输入处理 ===

// 切换修饰键
function toggleModifier(key) {
    AppState.modifierKeys[key] = !AppState.modifierKeys[key];
    const btn = document.querySelector(`.ctrl-btn[data-key="${key}"]`);
    if (btn) {
        btn.classList.toggle('active', AppState.modifierKeys[key]);
    }

    const scancodes = { ctrl: 0x1D, alt: 0x38, shift: 0x2A, win: 0x5B };
    if (scancodes[key] && AppState.vm) {
        if (AppState.modifierKeys[key]) {
            AppState.vm.sendKeyDown(scancodes[key]);
        } else {
            AppState.vm.sendKeyUp(scancodes[key]);
        }
    }
}

// 发送右键
function sendRightClick() {
    addLog('提示: 在屏幕上双指点击 = 鼠标右键', 'info');
}

// 发送 Esc
function sendEsc() {
    if (AppState.vm) {
        AppState.vm.sendKey(SCANCODES['Escape']);
    }
}

// 处理物理键盘按下
function handleKeyDown(e) {
    if (!AppState.isDisplayOpen) return;
    e.preventDefault();

    const scancode = SCANCODES[e.key];
    if (scancode !== undefined && AppState.vm) {
        AppState.vm.sendKeyDown(scancode);
    }
}

// 处理物理键盘释放
function handleKeyUp(e) {
    if (!AppState.isDisplayOpen) return;
    e.preventDefault();

    const scancode = SCANCODES[e.key];
    if (scancode !== undefined && AppState.vm) {
        AppState.vm.sendKeyUp(scancode);
    }
}

// 切换软键盘
function toggleKeyboard() {
    let input = document.getElementById('hidden-keyboard-input');
    if (!input) {
        input = document.createElement('input');
        input.id = 'hidden-keyboard-input';
        input.style.position = 'fixed';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        input.style.top = '-100px';
        document.body.appendChild(input);
    }
    input.focus();
}

// === PWA 相关 ===

async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('service-worker.js');
            console.log('[PWA] Service Worker 注册成功');
        } catch (error) {
            console.log('[PWA] Service Worker 注册失败:', error);
        }
    }
}

function checkInstallPrompt() {
    const dismissed = localStorage.getItem('install_prompt_dismissed');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         navigator.standalone === true;

    if (!dismissed && !isStandalone) {
        setTimeout(() => {
            DOM['install-prompt'].style.display = 'flex';
        }, 5000);
    }
}

// 导出调试
window.AppState = AppState;
window.addLog = addLog;
