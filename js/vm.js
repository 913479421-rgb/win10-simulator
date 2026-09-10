/**
 * 虚拟机管理器
 * 基于 WebAssembly (v86) 在浏览器中运行真实 x86 Windows 10
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
    this._screenContainer = null;
    this._hdaBuffer = null;
    this._cdromBuffer = null;
  }

  // 默认配置 - 高性能优化版
  getDefaultConfig() {
    return {
      memorySize: 1024,        // 内存 MB（1GB，提升启动和运行速度）
      vgaMemorySize: 16,       // 显存 MB（16MB，提升显示性能）
      diskSize: 16 * 1024,     // 磁盘大小 MB (16GB)
      cdromPath: '',           // ISO 路径
      hdaPath: 'windows10.img', // 系统盘文件名
      bootFromCd: false,       // 从光驱启动
      enableNetwork: false,    // 网络（需要 websockproxy，默认关闭）
      acpi: true,              // ACPI（快速启动支持）
      wasmUrl: 'v86/v86.wasm',
      biosUrl: 'v86/bios/seabios.bin',
      vgabiosUrl: 'v86/bios/vgabios.bin'
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

  // 设置屏幕容器（v86 需要 screen_container，包含 div + canvas）
  setScreenContainer(container) {
    this._screenContainer = container;
  }

  // 日志
  log(message, type = 'info') {
    console.log(`[VM] ${message}`);
    if (this.onLog) this.onLog(message, type);
  }

  // 启动虚拟机（高性能优化版）
  async start() {
    if (this.isRunning) {
      this.log('虚拟机已在运行', 'warn');
      return false;
    }

    this.log('正在快速启动 Windows 10...');
    this._setState('starting');
    const startTime = Date.now();

    try {
      // 并行执行：加载 v86 引擎 + 准备磁盘
      const [v86Ready] = await Promise.all([
        this._preloadV86Engine(),
        this._prepareDisk()
      ]);

      // 准备启动参数（高性能配置）
      const emulatorOptions = {
        wasm_path: this.config.wasmUrl,
        memory_size: this.config.memorySize * 1024 * 1024,
        vga_memory_size: this.config.vgaMemorySize * 1024 * 1024,
        screen_container: this._screenContainer,
        bios: { url: this.config.biosUrl },
        vga_bios: { url: this.config.vgabiosUrl },
        hda: this._hdaBuffer,
        acpi: this.config.acpi,
        autostart: true,
        // 快速启动优化
        preserve_mac_from_state_image: true,
        disable_speaker: true,
        initial_state: null
      };

      // 挂载 ISO（如果需要）
      if (this.config.cdromPath && this.config.bootFromCd && this._cdromBuffer) {
        emulatorOptions.cdrom = this._cdromBuffer;
        emulatorOptions.boot_order = 0x13; // CD-ROM first
      } else {
        emulatorOptions.boot_order = 0x11; // HDD first（快速启动）
      }

      // 网络
      if (this.config.enableNetwork && this.config.networkRelayUrl) {
        emulatorOptions.network_relay_url = this.config.networkRelayUrl;
      }

      // 创建模拟器实例
      this.log('正在初始化虚拟机...');
      const V86Class = this._getV86Constructor();
      if (!V86Class) {
        throw new Error('v86 引擎加载失败：V86 和 V86Starter 均未定义。请刷新页面重试。');
      }
      this.log(`使用引擎: ${V86Class.name || 'V86'}`);
      this.emulator = new V86Class(emulatorOptions);

      // 绑定事件
      this.emulator.add_listener('emulator-ready', () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.log(`虚拟机已就绪（启动耗时 ${elapsed} 秒），正在启动 Windows...`);
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
      });

      this.emulator.add_listener('screen-update', () => {
        if (this.onFrameUpdate) this.onFrameUpdate();
      });

      // 等待启动（缩短超时时间）
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('启动超时（可能是 WASM 加载失败，请检查网络）')), 120000);
        this.emulator.add_listener('emulator-ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      this.log(`Windows 10 启动中（总耗时 ${totalTime} 秒），请耐心等待...`);
      return true;

    } catch (error) {
      this.log(`启动失败: ${error.message}`, 'error');
      this._setState('error');
      if (this.emulator) {
        try { this.emulator.stop(); } catch (e) {}
        this.emulator = null;
      }
      return false;
    }
  }

  // 预加载 v86 引擎（并行）
  async _preloadV86Engine() {
    this.log('正在加载 WebAssembly 虚拟化引擎...');
    await this.loadV86Engine();
    return true;
  }

  // 准备磁盘（并行）
  async _prepareDisk() {
    // 检查系统盘
    const diskExists = await this.storageManager.diskExists(this.config.hdaPath);
    if (!diskExists) {
      this.log('系统盘不存在，正在创建...');
      await this.storageManager.createDisk(this.config.hdaPath, this.config.diskSize);
      this.log(`虚拟磁盘已创建: ${this.config.diskSize / 1024} GB`);
    }

    this.log('正在准备虚拟磁盘...');
    const diskInfo = await this.storageManager.getDiskInfo(this.config.hdaPath);
    const diskSize = diskInfo ? diskInfo.size : (this.config.diskSize * 1024 * 1024);
    this._hdaBuffer = new IndexedDBBuffer(this.storageManager, this.config.hdaPath, diskSize, false);

    // 准备 ISO（如果需要）
    if (this.config.cdromPath && this.config.bootFromCd) {
      this.log('正在准备 ISO 镜像...');
      const isoInfo = await this.storageManager.getIsoInfo(this.config.cdromPath);
      const isoSize = isoInfo ? isoInfo.size : 0;
      if (isoSize > 0) {
        this._cdromBuffer = new IndexedDBBuffer(this.storageManager, this.config.cdromPath, isoSize, true);
        this.log(`ISO 已挂载: ${this.config.cdromPath} (${(isoSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
      }
    }

    return true;
  }

  // 停止虚拟机
  async stop() {
    if (!this.isRunning || !this.emulator) {
      return;
    }

    this.log('正在关闭虚拟机...');
    this._setState('stopping');

    try {
      // v86 只有 stop() 方法，没有 destroy()
      this.emulator.stop();
      this.emulator = null;
      this.isRunning = false;
      this._setState('stopped');
      this.log('虚拟机已关闭，磁盘数据已保存在 IndexedDB');
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

  // 发送键盘扫描码（v86 使用 keyboard_send_scancodes 数组）
  sendScancodes(codes) {
    if (this.emulator) {
      this.emulator.keyboard_send_scancodes(codes);
    }
  }

  // 发送单个按键（按下+释放）
  sendKey(scancode) {
    if (this.emulator) {
      // make code + break code (OR 0x80)
      this.emulator.keyboard_send_scancodes([scancode, scancode | 0x80]);
    }
  }

  // 发送按键按下
  sendKeyDown(scancode) {
    if (this.emulator) {
      this.emulator.keyboard_send_scancodes([scancode]);
    }
  }

  // 发送按键释放
  sendKeyUp(scancode) {
    if (this.emulator) {
      this.emulator.keyboard_send_scancodes([scancode | 0x80]);
    }
  }

  // 鼠标锁定（v86 通过 screen_container 自动处理鼠标，点击后锁定）
  lockMouse() {
    if (this.emulator && this.emulator.lock_mouse) {
      this.emulator.lock_mouse();
    }
  }

  // 加载 v86 引擎（已在 HTML 中直接引入，这里做兼容性检查）
  async loadV86Engine() {
    // 检查是否已定义
    if (this._getV86Constructor()) {
      this.log('v86 引擎已加载');
      return;
    }

    // 回退：动态加载本地文件
    this.log('正在动态加载 v86 引擎...');
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'v86/libv86.js';
      script.onload = () => {
        if (this._getV86Constructor()) {
          this.log('v86 引擎加载完成');
          resolve();
        } else {
          reject(new Error('v86 引擎加载后仍未找到 V86/V86Starter 构造函数'));
        }
      };
      script.onerror = () => reject(new Error('无法加载 v86 引擎 (v86/libv86.js)，请检查网络连接'));
      document.head.appendChild(script);
    });
  }

  // 安全获取 v86 构造函数（兼容多种导出方式）
  _getV86Constructor() {
    // 方式1: 全局变量 V86（npm 版本）
    if (typeof V86 !== 'undefined' && V86) {
      return V86;
    }
    // 方式2: 全局变量 V86Starter（旧版本）
    if (typeof V86Starter !== 'undefined' && V86Starter) {
      return V86Starter;
    }
    // 方式3: window.V86
    if (typeof window !== 'undefined' && window.V86) {
      return window.V86;
    }
    // 方式4: window.V86Starter
    if (typeof window !== 'undefined' && window.V86Starter) {
      return window.V86Starter;
    }
    // 方式5: 全局对象上的任何 v86 相关属性
    if (typeof globalThis !== 'undefined') {
      for (const key of Object.keys(globalThis)) {
        if (/v86/i.test(key) && typeof globalThis[key] === 'function') {
          return globalThis[key];
        }
      }
    }
    return null;
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
      diskSize: this.config.diskSize
    };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VMManager;
}
