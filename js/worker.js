/**
 * v86 模拟器 Web Worker
 * 在独立线程中运行模拟器，避免阻塞 UI 主线程
 */

// 导入 v86 引擎
importScripts('v86/libv86.js');

let emulator = null;
let screenCanvas = null;
let isRunning = false;

// 消息处理
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'init':
      initEmulator(data);
      break;
    case 'start':
      startEmulator();
      break;
    case 'stop':
      stopEmulator();
      break;
    case 'restart':
      restartEmulator();
      break;
    case 'keyboard':
      sendKeyboard(data);
      break;
    case 'mouse':
      sendMouse(data);
      break;
    case 'lock_mouse':
      lockMouse();
      break;
    case 'get_stats':
      sendStats();
      break;
  }
};

// 初始化模拟器
function initEmulator(config) {
  self.postMessage({ type: 'progress', data: { percent: 5, stage: '初始化模拟器...' } });

  try {
    const V86Class = typeof V86 !== 'undefined' ? V86 : V86Starter;
    
    if (!V86Class) {
      self.postMessage({ type: 'error', data: { message: 'v86 引擎未加载' } });
      return;
    }

    self.postMessage({ type: 'progress', data: { percent: 15, stage: '加载 WebAssembly...' } });

    emulator = new V86Class({
      wasm_path: config.wasmUrl,
      memory_size: config.memorySize * 1024 * 1024,
      vga_memory_size: config.vgaMemorySize * 1024 * 1024,
      bios: { url: config.biosUrl },
      vga_bios: { url: config.vgabiosUrl },
      hda: config.hdaBuffer,
      cdrom: config.cdromBuffer,
      boot_order: config.bootOrder,
      acpi: config.acpi,
      autostart: false,
      disable_speaker: true,
      // Worker 模式下不使用 screen_container，通过消息传递屏幕数据
      screen_container: null
    });

    self.postMessage({ type: 'progress', data: { percent: 30, stage: '初始化硬件...' } });

    // 绑定事件
    emulator.add_listener('emulator-ready', () => {
      isRunning = true;
      self.postMessage({ type: 'progress', data: { percent: 40, stage: 'BIOS 启动...' } });
      self.postMessage({ type: 'ready' });
    });

    emulator.add_listener('emulator-stopped', () => {
      isRunning = false;
      self.postMessage({ type: 'stopped' });
    });

    emulator.add_listener('screen-set-size', (data) => {
      self.postMessage({ type: 'screen-size', data });
    });

    emulator.add_listener('screen-update', () => {
      // 发送屏幕更新信号（不发送实际像素数据，由主线程从共享内存读取）
      self.postMessage({ type: 'screen-update' });
    });

    emulator.add_listener('cpu-update', (data) => {
      self.postMessage({ type: 'cpu-stats', data });
    });

    self.postMessage({ type: 'progress', data: { percent: 25, stage: '等待启动...' } });
    self.postMessage({ type: 'init-complete' });

  } catch (error) {
    self.postMessage({ type: 'error', data: { message: error.message } });
  }
}

// 启动模拟器
function startEmulator() {
  if (emulator) {
    emulator.run();
    self.postMessage({ type: 'progress', data: { percent: 50, stage: '正在启动...' } });
  }
}

// 停止模拟器
function stopEmulator() {
  if (emulator) {
    emulator.stop();
    isRunning = false;
  }
}

// 重启模拟器
function restartEmulator() {
  if (emulator) {
    emulator.restart();
  }
}

// 发送键盘输入
function sendKeyboard(data) {
  if (emulator && emulator.keyboard_send_scancodes) {
    emulator.keyboard_send_scancodes(data.codes);
  }
}

// 发送鼠标输入
function sendMouse(data) {
  if (emulator && emulator.mouse_send) {
    emulator.mouse_send(data.x, data.y, data.buttons);
  }
}

// 锁定鼠标
function lockMouse() {
  if (emulator && emulator.lock_mouse) {
    emulator.lock_mouse();
  }
}

// 发送统计信息
function sendStats() {
  self.postMessage({
    type: 'stats',
    data: {
      running: isRunning,
      cpu: emulator ? emulator.cpu : null
    }
  });
}
