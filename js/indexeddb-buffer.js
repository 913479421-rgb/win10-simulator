/**
 * IndexedDB Buffer - 实现 v86 期望的磁盘 buffer 接口
 * v86 buffer 接口:
 *   load(): void - 初始化
 *   get(start, len, fn): void - 读取 len 字节，回调 fn(Uint8Array)
 *   set(start, slice, fn): void - 写入 slice，回调 fn()
 *   get_buffer(fn): void - 获取整个 buffer（可选，用于保存状态）
 */
class IndexedDBBuffer {
  /**
   * @param {StorageManager} storageManager - 存储管理器
   * @param {string} diskName - 磁盘名称
   * @param {number} size - 磁盘大小（字节）
   * @param {boolean} isIso - 是否为 ISO（只读）
   */
  constructor(storageManager, diskName, size, isIso = false) {
    this.storage = storageManager;
    this.diskName = diskName;
    this.size = size;
    this.isIso = isIso;
    this.loaded = false;
    this._cache = new Map(); // 块缓存
    this._cacheSize = 64; // 最多缓存 64 个块 (256MB)
  }

  // v86 接口：初始化
  load() {
    this.loaded = true;
    return Promise.resolve();
  }

  // v86 接口：读取指定范围
  async get(start, len, fn) {
    try {
      const data = await this.storage.readDiskRange(this.diskName, start, len, this.isIso);
      fn(data);
    } catch (err) {
      console.error('IndexedDBBuffer get error:', err);
      fn(new Uint8Array(len));
    }
  }

  // v86 接口：写入指定范围
  async set(start, slice, fn) {
    if (this.isIso) {
      // ISO 只读，忽略写入
      fn();
      return;
    }

    try {
      await this.storage.writeDiskRange(this.diskName, start, slice);
      fn();
    } catch (err) {
      console.error('IndexedDBBuffer set error:', err);
      fn();
    }
  }

  // v86 接口：获取整个 buffer（用于保存状态，大磁盘可能内存溢出）
  async get_buffer(fn) {
    try {
      // 对于大磁盘，不建议调用此方法
      console.warn('IndexedDBBuffer.get_buffer called - may cause OOM for large disks');
      const data = await this.storage.readDiskRange(this.diskName, 0, this.size, this.isIso);
      fn(data);
    } catch (err) {
      console.error('IndexedDBBuffer get_buffer error:', err);
      fn(new Uint8Array(this.size));
    }
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IndexedDBBuffer;
}
