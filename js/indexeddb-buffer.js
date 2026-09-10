/**
 * IndexedDB Buffer - 实现 v86 期望的磁盘 buffer 接口
 * 
 * v86 buffer 完整接口（从源码分析）:
 *   load(): Promise - 初始化
 *   get(start, len, fn): void - 读取 len 字节，回调 fn(Uint8Array)
 *   set(start, slice, fn): void - 写入 slice，回调 fn()
 *   get_buffer(fn): void - 获取整个 buffer
 *   get_and_cache(start, len, fn): void - 读取并缓存（默认调用 get）
 *   get_from_cache(start, len): Uint8Array - 从缓存读取
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
    this._cache = new Map(); // 简单块缓存
    this._cacheMax = 32; // 最多缓存 32 个块 (128MB)
  }

  // v86 接口：初始化
  async load() {
    this.loaded = true;
    return Promise.resolve();
  }

  // v86 接口：读取指定范围（带缓存）
  async get(start, len, fn) {
    try {
      // 检查缓存（简单的整范围缓存）
      const cacheKey = `${start}_${len}`;
      if (this._cache.has(cacheKey)) {
        fn(this._cache.get(cacheKey));
        return;
      }

      const data = await this.storage.readDiskRange(this.diskName, start, len, this.isIso);
      
      // 存入缓存（小范围才缓存）
      if (len <= 1024 * 1024) {
        this._cache.set(cacheKey, data);
        if (this._cache.size > this._cacheMax) {
          const firstKey = this._cache.keys().next().value;
          this._cache.delete(firstKey);
        }
      }
      
      fn(data);
    } catch (err) {
      console.error('IndexedDBBuffer get error:', err);
      fn(new Uint8Array(len));
    }
  }

  // v86 接口：读取并缓存（默认实现就是调用 get）
  get_and_cache(start, len, fn) {
    this.get(start, len, fn);
  }

  // v86 接口：从缓存读取（如果未缓存返回空）
  get_from_cache(start, len) {
    const cacheKey = `${start}_${len}`;
    return this._cache.get(cacheKey) || new Uint8Array(0);
  }

  // v86 接口：写入指定范围
  async set(start, slice, fn) {
    if (this.isIso) {
      // ISO 只读，忽略写入
      if (fn) fn();
      return;
    }

    try {
      // 写入时清除相关缓存
      this._invalidateCache(start, slice ? slice.length : 0);
      
      await this.storage.writeDiskRange(this.diskName, start, slice);
      if (fn) fn();
    } catch (err) {
      console.error('IndexedDBBuffer set error:', err);
      if (fn) fn();
    }
  }

  // v86 接口：获取整个 buffer（用于保存状态，大磁盘可能内存溢出）
  async get_buffer(fn) {
    try {
      console.warn('IndexedDBBuffer.get_buffer called - may cause OOM for large disks');
      const data = await this.storage.readDiskRange(this.diskName, 0, this.size, this.isIso);
      fn(data);
    } catch (err) {
      console.error('IndexedDBBuffer get_buffer error:', err);
      fn(new Uint8Array(this.size));
    }
  }

  // 使指定范围的缓存失效
  _invalidateCache(start, length) {
    for (const key of this._cache.keys()) {
      const [cacheStart, cacheLen] = key.split('_').map(Number);
      // 检查范围是否重叠
      if (start < cacheStart + cacheLen && start + length > cacheStart) {
        this._cache.delete(key);
      }
    }
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IndexedDBBuffer;
}
