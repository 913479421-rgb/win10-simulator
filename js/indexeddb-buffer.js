/**
 * IndexedDB Buffer - 高性能磁盘缓冲（优化版）
 * 
 * 优化特性：
 * - 大容量 LRU 缓存（512MB）
 * - 预读机制
 * - 异步延迟写入
 * - 读写合并
 */
class IndexedDBBuffer {
  constructor(storageManager, diskName, size, isIso = false) {
    this.storage = storageManager;
    this.diskName = diskName;
    this.size = size;
    this.isIso = isIso;
    this.loaded = false;
    
    // 高性能缓存配置
    this._cache = new Map(); // LRU 缓存
    this._cacheMax = 128; // 最多缓存 128 个块 (512MB @ 4MB/块)
    this._readAheadSize = 8 * 1024 * 1024; // 预读 8MB
    this._writeQueue = []; // 延迟写入队列
    this._writeTimer = null;
    this._writeDelay = 500; // 500ms 批量写入
  }

  async load() {
    this.loaded = true;
    return Promise.resolve();
  }

  // 高性能读取（带 LRU 缓存和预读）
  async get(start, len, fn) {
    try {
      // 检查缓存
      const cacheKey = `${start}_${len}`;
      if (this._cache.has(cacheKey)) {
        // LRU: 移动到末尾（最近使用）
        const data = this._cache.get(cacheKey);
        this._cache.delete(cacheKey);
        this._cache.set(cacheKey, data);
        fn(data);
        return;
      }

      // 从存储读取
      const data = await this.storage.readDiskRange(this.diskName, start, len, this.isIso);
      
      // 存入缓存（LRU）
      this._cache.set(cacheKey, data);
      this._evictCache();
      
      // 预读后续数据（异步，不阻塞当前请求）
      if (!this.isIso && len < this._readAheadSize) {
        this._readAhead(start + len);
      }
      
      fn(data);
    } catch (err) {
      console.error('IndexedDBBuffer get error:', err);
      fn(new Uint8Array(len));
    }
  }

  // 预读
  async _readAhead(start) {
    try {
      const end = Math.min(start + this._readAheadSize, this.size);
      const len = end - start;
      if (len <= 0) return;
      
      const cacheKey = `${start}_${len}`;
      if (this._cache.has(cacheKey)) return;
      
      const data = await this.storage.readDiskRange(this.diskName, start, len, this.isIso);
      this._cache.set(cacheKey, data);
      this._evictCache();
    } catch (e) {
      // 预读失败忽略
    }
  }

  // LRU 淘汰
  _evictCache() {
    while (this._cache.size > this._cacheMax) {
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
  }

  get_and_cache(start, len, fn) {
    this.get(start, len, fn);
  }

  get_from_cache(start, len) {
    const cacheKey = `${start}_${len}`;
    return this._cache.get(cacheKey) || new Uint8Array(0);
  }

  // 高性能写入（延迟批量写入）
  async set(start, slice, fn) {
    if (this.isIso) {
      if (fn) fn();
      return;
    }

    try {
      // 清除相关缓存
      this._invalidateCache(start, slice ? slice.length : 0);
      
      // 加入写入队列
      this._writeQueue.push({ start, data: slice });
      
      // 延迟批量写入
      if (!this._writeTimer) {
        this._writeTimer = setTimeout(() => this._flushWrites(), this._writeDelay);
      }
      
      if (fn) fn();
    } catch (err) {
      console.error('IndexedDBBuffer set error:', err);
      if (fn) fn();
    }
  }

  // 批量刷新写入
  async _flushWrites() {
    if (this._writeQueue.length === 0) return;
    
    const queue = this._writeQueue;
    this._writeQueue = [];
    this._writeTimer = null;
    
    // 合并相邻的写入
    const merged = this._mergeWrites(queue);
    
    for (const write of merged) {
      try {
        await this.storage.writeDiskRange(this.diskName, write.start, write.data);
      } catch (e) {
        console.error('批量写入失败:', e);
      }
    }
  }

  // 合并相邻写入
  _mergeWrites(writes) {
    if (writes.length <= 1) return writes;
    
    writes.sort((a, b) => a.start - b.start);
    const merged = [writes[0]];
    
    for (let i = 1; i < writes.length; i++) {
      const last = merged[merged.length - 1];
      const curr = writes[i];
      
      if (curr.start <= last.start + last.data.length) {
        // 合并
        const end = Math.max(last.start + last.data.length, curr.start + curr.data.length);
        const newData = new Uint8Array(end - last.start);
        newData.set(new Uint8Array(last.data), 0);
        newData.set(new Uint8Array(curr.data), curr.start - last.start);
        last.data = newData;
      } else {
        merged.push(curr);
      }
    }
    
    return merged;
  }

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

  _invalidateCache(start, length) {
    for (const key of this._cache.keys()) {
      const [cacheStart, cacheLen] = key.split('_').map(Number);
      if (start < cacheStart + cacheLen && start + length > cacheStart) {
        this._cache.delete(key);
      }
    }
  }

  // 强制刷新所有待写入
  async flush() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    await this._flushWrites();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IndexedDBBuffer;
}
