/**
 * 虚拟机管理器
 * 基于 WebAssembly (v86/QEMU-WASM) 在浏览器中运行真实 x86 Windows 10
 * 使用手机 RAM 作为虚拟机内存，IndexedDB 存储虚拟磁盘
 */
class VMManager {
  constructor() {
    this.emulator = null;
    this.isRunning = false;
    this.config = this.loadConfig();
    this.storageManager = new StorageManager();
    this.onStateChange = null;
    this.onFrameUpdate = null;
    this.onLog = null;
    this._screenCanvas = null;
    this._screenCtx = null;
    this._imageData = null;
  }

  // 默认配置 - 针对手机优化
  getDefaultConfig() {
    return {
      memorySize: 1024,        // 内存 MB (手机浏览器限制，建议 512-2048)
      vgaMemorySize: 32,       // 显存 MB
      cpuCount: 1,             // CPU 核心数 (WASM 通常单核)
      diskSize: 32 * 1024,     // 磁盘大小 MB (32GB)
      cdromPath: '',           // ISO 路径
      hdaPath: 'windows10.img', // 系统盘文件名
      bootFromCd: false,       // 从光驱启动
      enableNetwork: true,     // 网络
      enableAudio: false,      // 音频
      acpi: true,              // ACPI
      vga: 'cirrus',           // 显卡类型 (cirrus 兼容性最好)
      wasmUrl: 'https://copy.sh/v86/v86.wasm',  // WASM 引擎地址
      biosUrl: 'https://copy.sh/v86/bios/seabios.bin',
      vgabiosUrl: 'https://copy.sh/v86/bios/vgabios.bin'
    };
  }

  loadConfig() {
    try {
      const saved = localStorage.getItem('win10_vm_config');
      return saved ? { ...this.getDefaultConfig(), ...JSON.parse(saved) } : this.getDefaultConfig();
    } catch (e) {
      return this.getDefaultConfig();
    }
  }

  saveConfig() {
    localStorage.setItem('win10_vm_config', JSON.stringify(this.config));
  }

  // 检查手机可用内存
  async getAvailableMemory() {
    if (navigator.deviceMemory) {
      return navigator.deviceMemory * 1024; // GB -> MB
    }
    // 估算：根据设备性能
    if (navigator.hardwareConcurrency >= 8) return 4096;
    if (navigator.hardwareConcurrency >= 4) return 2048;
    return 1024;
  }

  // 检查可用存储
  async getAvailableStorage() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        quota: estimate.quota,
        usage: estimate.usage,
        available: estimate.quota - estimate.usage
      };
    }
    return { quota: -1, usage: -1, available: -1 };
  }

  // 设置屏幕画布
  setScreenCanvas(canvas) {
    this._screenCanvas = canvas;
    this._screenCtx = canvas.getContext('2d');
  }

  // 日志
  log(message, type = 'info') {
    console.log(`[VM] ${message}`);
    if (this.onLog) this.onLog(message, type);
  }

  // 启动虚拟机
  async start() {
    if (this.isRunning) {
      this.log('虚拟机已在运行', 'warn');
      return false;
    }

    this.log('正在启动 Windows 10 虚拟机...');
    this._setState('starting');

    try {
      // 1. 检查系统盘是否存在
      const diskExists = await this.storageManager.diskExists(this.config.hdaPath);
      if (!diskExists) {
        this.log('系统盘不存在，正在创建...');
        await this.storageManager.createDisk(this.config.hdaPath, this.config.diskSize);
        this.log(`虚拟磁盘已创建: ${this.config.diskSize / 1024} GB`);
      }

      // 2. 加载虚拟磁盘
      this.log('正在加载虚拟磁盘...');
      const diskBuffer = await this.storageManager.loadDisk(this.config.hdaPath);

      // 3. 准备启动参数
      const emulatorOptions = {
        memory_size: this.config.memorySize * 1024 * 1024,
        vga_memory_size: this.config.vgaMemorySize * 1024 * 1024,
        screen: {
          canvas: this._screenCanvas,
          context: this._screenCtx
        },
        hda: {
          buffer: diskBuffer,
          async: true,
          size: this.config.diskSize * 1024 * 1024
        },
        bios: { url: this.config.biosUrl },
        vga_bios: { url: this.config.vgabiosUrl },
        wasm_path: this.config.wasmUrl,
        acpi: this.config.acpi,
        network_relay_url: this.config.enableNetwork ? null : undefined,
        uart1: {
          receive: (data) => {
            // 串口输出
          }
        },
        autostart: true
      };

      // 4. 如果有 ISO，挂载光驱
      if (this.config.cdromPath && this.config.bootFromCd) {
        this.log('正在加载 ISO 镜像...');
        const isoBuffer = await this.storageManager.loadDisk(this.config.cdromPath);
        emulatorOptions.cdrom = { buffer: isoBuffer, async: true };
        emulatorOptions.boot_order = 0x13; // 从光驱启动
      } else {
        emulatorOptions.boot_order = 0x11; // 从硬盘启动
      }

      // 5. 加载 v86 引擎
      this.log('正在加载 WebAssembly 虚拟化引擎...');
      await this.loadV86Engine();

      // 6. 创建模拟器实例
      this.log('正在初始化虚拟机...');
      this.emulator = new V86Starter(emulatorOptions);

      // 7. 绑定事件
      this.emulator.add_listener('emulator-ready', () => {
        this.log('虚拟机已就绪');
        this.isRunning = true;
        this._setState('running');
      });

      this.emulator.add_listener('emulator-stopped', () => {
        this.log('虚拟机已停止');
        this.isRunning = false;
        this._setState('stopped');
      });

      this.emulator.add_listener('screen-set-size', (data) => {
        this.log(`屏幕分辨率: ${data.width}x${data.height}`);
        if (this._screenCanvas) {
          this._screenCanvas.width = data.width;
          this._screenCanvas.height = data.height;
        }
      });

      this.emulator.add_listener('screen-update', () => {
        if (this.onFrameUpdate) this.onFrameUpdate();
      });

      // 8. 等待启动
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('启动超时')), 120000);
        this.emulator.add_listener('emulator-ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.log('Windows 10 启动成功！');
      return true;

    } catch (error) {
      this.log(`启动失败: ${error.message}`, 'error');
      this._setState('error');
      this.emulator = null;
      return false;
    }
  }

  // 停止虚拟机
  async stop() {
    if (!this.isRunning || !this.emulator) {
      return;
    }

    this.log('正在关闭虚拟机...');
    this._setState('stopping');

    try {
      // 保存磁盘状态
      this.log('正在保存磁盘状态...');
      if (this.emulator.hda && this.emulator.hda.buffer) {
        await this.storageManager.saveDisk(this.config.hdaPath, this.emulator.hda.buffer);
      }

      // 停止模拟器
      this.emulator.stop();
      this.emulator.destroy();
      this.emulator = null;
      this.isRunning = false;
      this._setState('stopped');
      this.log('虚拟机已关闭');
    } catch (error) {
      this.log(`关闭时出错: ${error.message}`, 'error');
    }
  }

  // 重置虚拟机
  reset() {
    if (this.emulator) {
      this.emulator.restart();
      this.log('虚拟机已重置');
    }
  }

  // 发送键盘事件
  sendKeyEvent(scancode, pressed) {
    if (this.emulator) {
      this.emulator.keyboard_send_scancode(scancode);
    }
  }

  // 发送鼠标事件
  sendMouseEvent(x, y, buttons) {
    if (this.emulator) {
      this.emulator.mouse_move(x, y);
      if (buttons !== undefined) {
        this.emulator.mouse_button(buttons);
      }
    }
  }

  // 加载 v86 引擎
  async loadV86Engine() {
    if (typeof V86Starter !== 'undefined') {
      return; // 已加载
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://copy.sh/v86/libv86.js';
      script.onload = () => {
        this.log('v86 引擎加载完成');
        resolve();
      };
      script.onerror = () => reject(new Error('无法加载 v86 引擎'));
      document.head.appendChild(script);
    });
  }

  // 设置状态
  _setState(state) {
    if (this.onStateChange) this.onStateChange(state);
  }

  // 获取运行时统计
  getStats() {
    return {
      running: this.isRunning,
      memoryAllocated: this.config.memorySize,
      diskSize: this.config.diskSize,
      cpuCores: this.config.cpuCount
    };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VMManager;
}
