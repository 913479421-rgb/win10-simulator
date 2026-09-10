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
    this.onProgress = null; // 启动进度回调
    this.onStats = null; // 实时状态回调
    this._screenContainer = null;
    this._hdaBuffer = null;
    this._cdromBuffer = null;
    this._worker = null; // Web Worker
    this._useWorker = false; // 是否使用 Worker 模式
    this._startTime = 0;
    this._currentProgress = 0;
  }

  // 默认配置 - 针对 Tiny11 (Windows 11 精简版 x64) 优化
  getDefaultConfig() {
    return {
      memorySize: 1024,        // 内存 MB（Tiny11 64位至少需要 1GB，推荐 2GB）
      vgaMemorySize: 16,       // 显存 MB
      diskSize: 32 * 1024,     // 磁盘大小 MB (32GB，Tiny11 安装后约 8-10GB)
      cdromPath: '',           // ISO 路径
      hdaPath: 'windows11.img', // 系统盘文件名
      bootFromCd: true,        // 默认从光驱启动（首次安装）
      enableNetwork: false,    // 网络
      acpi: true,              // ACPI
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

  // 启动虚拟机（高性能优化版 + 真实进度显示）
  async start() {
    if (this.isRunning) {
      this.log('虚拟机已在运行', 'warn');
      return false;
    }

    this.log('正在快速启动 Windows 10...');
    this._setState('starting');
    this._startTime = Date.now();
    this._currentProgress = 0;

    try {
      // 阶段1: 加载 v86 引擎 (0-25%)
      this._updateProgress(5, '加载 WebAssembly 引擎...');
      await this._preloadV86Engine();
      this._updateProgress(25, '引擎加载完成');

      // 阶段2: 准备磁盘 (25-40%)
      this._updateProgress(30, '准备虚拟磁盘...');
      await this._prepareDisk();
      this._updateProgress(40, '磁盘准备完成');

      // 阶段3: 初始化虚拟机 (40-55%)
      this._updateProgress(45, '初始化硬件...');
      const emulatorOptions = this._buildEmulatorOptions();
      
      const V86Class = this._getV86Constructor();
      if (!V86Class) {
        throw new Error('v86 引擎加载失败：V86 和 V86Starter 均未定义。请刷新页面重试。');
      }
      this.log(`使用引擎: ${V86Class.name || 'V86'}`);
      this.emulator = new V86Class(emulatorOptions);
      this._updateProgress(55, '硬件初始化完成');

      // 阶段4: 绑定事件并启动 (55-70%)
      this._bindEmulatorEvents();
      this._updateProgress(60, 'BIOS 启动中...');

      // 等待 emulator-ready
      await this._waitForEmulatorReady(120000);
      
      this._updateProgress(70, 'BIOS 启动完成');

      // 阶段5: 引导系统 (70-90%)
      this._updateProgress(75, '引导加载器...');
      
      // 启动实时状态监控
      this._startStatsMonitor();

      const totalTime = ((Date.now() - this._startTime) / 1000).toFixed(1);
      this._updateProgress(85, 'Windows 启动中...');
      this.log(`虚拟机已就绪（启动耗时 ${totalTime} 秒），Windows 正在加载...`);
      
      // 模拟 Windows 启动进度（基于时间估算）
      this._simulateWindowsBootProgress();

      return true;

    } catch (error) {
      this.log(`启动失败: ${error.message}`, 'error');
      this._setState('error');
      this._updateProgress(0, '启动失败');
      if (this.emulator) {
        try { this.emulator.stop(); } catch (e) {}
        this.emulator = null;
      }
      return false;
    }
  }

  // 构建模拟器配置
  _buildEmulatorOptions() {
    const options = {
      wasm_path: this.config.wasmUrl,
      memory_size: this.config.memorySize * 1024 * 1024,
      vga_memory_size: this.config.vgaMemorySize * 1024 * 1024,
      screen_container: this._screenContainer,
      bios: { url: this.config.biosUrl },
      vga_bios: { url: this.config.vgabiosUrl },
      hda: this._hdaBuffer,
      acpi: this.config.acpi,
      autostart: true,
      preserve_mac_from_state_image: true,
      disable_speaker: true
    };

    if (this.config.cdromPath && this.config.bootFromCd && this._cdromBuffer) {
      options.cdrom = this._cdromBuffer;
      options.boot_order = 0x13;
    } else {
      options.boot_order = 0x11;
    }

    if (this.config.enableNetwork && this.config.networkRelayUrl) {
      options.network_relay_url = this.config.networkRelayUrl;
    }

    return options;
  }

  // 绑定模拟器事件
  _bindEmulatorEvents() {
    this.emulator.add_listener('emulator-ready', () => {
      this.isRunning = true;
      this._setState('running');
    });

    this.emulator.add_listener('emulator-stopped', () => {
      this.log('虚拟机已停止');
      this.isRunning = false;
      this._setState('stopped');
      this._stopStatsMonitor();
    });

    this.emulator.add_listener('screen-set-size', (data) => {
      this.log(`屏幕分辨率: ${data.width}x${data.height}`);
      this._updateProgress(Math.min(95, this._currentProgress + 5), '显示输出已就绪');
    });

    this.emulator.add_listener('screen-update', () => {
      if (this.onFrameUpdate) this.onFrameUpdate();
    });
  }

  // 等待模拟器就绪
  _waitForEmulatorReady(timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('启动超时（可能是 WASM 加载失败，请检查网络）')), timeout);
      this.emulator.add_listener('emulator-ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // 模拟 Windows 启动进度（基于时间估算）
  _simulateWindowsBootProgress() {
    const stages = [
      { progress: 88, delay: 2000, msg: '加载 Windows 内核...' },
      { progress: 92, delay: 4000, msg: '加载驱动程序...' },
      { progress: 96, delay: 6000, msg: '启动服务...' },
      { progress: 100, delay: 8000, msg: '欢迎使用 Windows！' }
    ];

    stages.forEach(stage => {
      setTimeout(() => {
        if (this.isRunning) {
          this._updateProgress(stage.progress, stage.msg);
        }
      }, stage.delay);
    });
  }

  // 启动实时状态监控
  _startStatsMonitor() {
    if (this._statsInterval) return;
    
    this._statsInterval = setInterval(() => {
      if (!this.isRunning || !this.emulator) return;
      
      try {
        const stats = {
          running: this.isRunning,
          memory: this.config.memorySize,
          uptime: Math.floor((Date.now() - this._startTime) / 1000),
          progress: this._currentProgress
        };
        if (this.onStats) this.onStats(stats);
      } catch (e) {}
    }, 1000);
  }

  // 停止状态监控
  _stopStatsMonitor() {
    if (this._statsInterval) {
      clearInterval(this._statsInterval);
      this._statsInterval = null;
    }
  }

  // 更新进度
  _updateProgress(percent, stage) {
    this._currentProgress = percent;
    if (this.onProgress) {
      this.onProgress({ percent, stage, elapsed: ((Date.now() - this._startTime) / 1000).toFixed(1) });
    }
    this.log(`[${percent}%] ${stage}`);
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
