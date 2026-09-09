/**
 * Win10 模拟器 - 主应用逻辑
 * 负责 UI 交互、配置管理、输入转发
 */

// 全局状态
const AppState = {
    vm: null,
    storage: null,
    vnc: null,
    isDisplayOpen: false,
    modifierKeys: { ctrl: false, alt: false, shift: false, win: false },
    lastTouchPos: { x: 0, y: 0 }
};

// DOM 元素
const DOM = {};

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
        'vm-screen', 'btn-right-click', 'btn-esc',
        'install-prompt', 'btn-dismiss-install'
    ];
    ids.forEach(id => {
        DOM[id] = document.getElementById(id);
    });
}

// 初始化虚拟机
function initVM() {
    AppState.vm = new VMManager();
    AppState.vm.setScreenCanvas(DOM['vm-screen']);

    AppState.vm.onStateChange = (state) => {
        updateStatus(state);
        updateButtons(state);
    };

    AppState.vm.onLog = (message, type) => {
        addLog(message, type);
    };

    AppState.vm.onFrameUpdate = () => {
        // 帧更新回调
    };

    // 更新配置显示
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

    // 画布触摸事件
    initCanvasTouch();

    // 键盘事件
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

    const success = await AppState.vm.start();
    if (success) {
        addLog('Windows 10 已启动，可以点击「显示桌面」查看', 'success');
    }
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
            if (!confirm('系统盘已存在，是否覆盖？这将删除所有数据。')) {
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

    const sizeGB = (file.size / 1024 / 1024 / 1024).toFixed(2);
    addLog(`正在导入 ISO: ${file.name} (${sizeGB} GB)...`);

    try {
        const result = await AppState.storage.importIso(file, (percent, name) => {
            showProgress(`正在导入 ${name}...`, percent);
        });

        AppState.vm.config.cdromPath = result.name;
        AppState.vm.saveConfig();

        addLog(`ISO 导入完成: ${result.name}`, 'success');
        updateStorageInfo();
        setTimeout(hideProgress, 1500);
    } catch (error) {
        addLog(`ISO 导入失败: ${error.message}`, 'error');
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

// 初始化画布触摸
function initCanvasTouch() {
    const canvas = DOM['vm-screen'];
    let lastX = 0, lastY = 0;
    let touchStartTime = 0;
    let touchMoved = false;

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        lastX = Math.round((touch.clientX - rect.left) * scaleX);
        lastY = Math.round((touch.clientY - rect.top) * scaleY);
        touchStartTime = Date.now();
        touchMoved = false;

        // 鼠标移动 + 左键按下
        sendMouseMove(lastX, lastY);
        sendMouseButton(1, true);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = Math.round((touch.clientX - rect.left) * scaleX);
        const y = Math.round((touch.clientY - rect.top) * scaleY);

        if (Math.abs(x - lastX) > 2 || Math.abs(y - lastY) > 2) {
            touchMoved = true;
        }
        sendMouseMove(x, y);
        lastX = x;
        lastY = y;
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        // 左键释放
        sendMouseButton(1, false);

        // 短按 = 单击（已通过按下/释放完成）
        // 长按 = 右键
        if (!touchMoved && Date.now() - touchStartTime > 500) {
            sendRightClick();
        }
    }, { passive: false });

    // 双指捏合缩放
    let initialPinchDistance = 0;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            initialPinchDistance = getPinchDistance(e.touches);
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const distance = getPinchDistance(e.touches);
            const scale = distance / initialPinchDistance;
            // 可以在这里实现画布缩放
        }
    }, { passive: false });
}

function getPinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

// 发送鼠标移动
function sendMouseMove(x, y) {
    if (AppState.vm && AppState.vm.emulator) {
        AppState.vm.sendMouseEvent(x, y);
    }
}

// 发送鼠标按钮
function sendMouseButton(button, pressed) {
    if (AppState.vm && AppState.vm.emulator) {
        // v86 的 mouse_button 接受位掩码: 1=左, 2=右, 4=中
        AppState.vm.emulator.mouse_button(pressed ? button : 0);
    }
}

// 发送右键
function sendRightClick() {
    if (AppState.vm && AppState.vm.emulator) {
        AppState.vm.emulator.mouse_button(2);
        setTimeout(() => AppState.vm.emulator.mouse_button(0), 100);
    }
}

// 发送 Esc
function sendEsc() {
    sendKey(0x01, true);
    setTimeout(() => sendKey(0x01, false), 50);
}

// 切换修饰键
function toggleModifier(key) {
    AppState.modifierKeys[key] = !AppState.modifierKeys[key];
    const btn = document.querySelector(`.ctrl-btn[data-key="${key}"]`);
    if (btn) {
        btn.classList.toggle('active', AppState.modifierKeys[key]);
    }

    // 发送按键
    const scancodes = { ctrl: 0x1D, alt: 0x38, shift: 0x2A, win: 0x5B };
    if (scancodes[key]) {
        sendKey(scancodes[key], AppState.modifierKeys[key]);
    }
}

// 发送键盘事件
function sendKey(scancode, pressed) {
    if (AppState.vm && AppState.vm.emulator) {
        // v86 使用 set_keycode，需要发送 make/break 码
        if (pressed) {
            AppState.vm.emulator.keyboard_send_scancode(scancode);
        } else {
            AppState.vm.emulator.keyboard_send_scancode(scancode | 0x80);
        }
    }
}

// 处理物理键盘
function handleKeyDown(e) {
    if (!AppState.isDisplayOpen) return;
    e.preventDefault();

    const scancode = keyToScancode(e.key);
    if (scancode !== null) {
        sendKey(scancode, true);
    }
}

function handleKeyUp(e) {
    if (!AppState.isDisplayOpen) return;
    e.preventDefault();

    const scancode = keyToScancode(e.key);
    if (scancode !== null) {
        sendKey(scancode, false);
    }
}

// 键码映射 (PS/2 扫描码 set 1)
function keyToScancode(key) {
    const map = {
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
    return map[key] || null;
}

// 切换软键盘
function toggleKeyboard() {
    // 聚焦到隐藏输入框以唤起软键盘
    let input = document.getElementById('hidden-keyboard-input');
    if (!input) {
        input = document.createElement('input');
        input.id = 'hidden-keyboard-input';
        input.style.position = 'fixed';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        document.body.appendChild(input);
    }
    input.focus();
}

// === PWA 相关 ===

// 注册 Service Worker
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('service-worker.js');
            console.log('[PWA] Service Worker 注册成功:', registration.scope);
        } catch (error) {
            console.log('[PWA] Service Worker 注册失败:', error);
        }
    }
}

// 检查安装提示
function checkInstallPrompt() {
    const dismissed = localStorage.getItem('install_prompt_dismissed');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         navigator.standalone === true;

    if (!dismissed && !isStandalone) {
        setTimeout(() => {
            DOM['install-prompt'].style.display = 'flex';
        }, 3000);
    }
}

// 监听安装提示事件
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

// 导出调试
window.AppState = AppState;
window.addLog = addLog;
