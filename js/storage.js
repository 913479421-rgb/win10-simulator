/**
 * 存储管理器
 * 使用 IndexedDB 在手机本地存储虚拟磁盘和 ISO 镜像
 * 支持大文件（数GB）分块存储
 */
class StorageManager {
  constructor() {
    this.dbName = 'Win10Simulator';
    this.dbVersion = 1;
    this.db = null;
    this.chunkSize = 4 * 1024 * 1024; // 4MB 分块
  }

  // 打开数据库
  async openDB() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 虚拟磁盘存储（分块）
        if (!db.objectStoreNames.contains('disks')) {
          const diskStore = db.createObjectStore('disks', { keyPath: 'id' });
          diskStore.createIndex('name', 'name', { unique: true });
        }

        // 磁盘数据块存储
        if (!db.objectStoreNames.contains('disk_chunks')) {
          const chunkStore = db.createObjectStore('disk_chunks', { keyPath: 'chunkId' });
          chunkStore.createIndex('diskId', 'diskId', { unique: false });
          chunkStore.createIndex('diskId_index', ['diskId', 'chunkIndex'], { unique: true });
        }

        // ISO 镜像存储
        if (!db.objectStoreNames.contains('isos')) {
          const isoStore = db.createObjectStore('isos', { keyPath: 'id' });
          isoStore.createIndex('name', 'name', { unique: true });
        }

        console.log('[Storage] 数据库初始化完成');
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error('无法打开数据库: ' + event.target.error));
      };
    });
  }

  // 检查磁盘是否存在
  async diskExists(name) {
    await this.openDB();
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['disks'], 'readonly');
      const store = transaction.objectStore('disks');
      const index = store.index('name');
      const request = index.get(name);
      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  }

  // 创建虚拟磁盘（稀疏文件，初始很小）
  async createDisk(name, sizeMB) {
    await this.openDB();

    const diskId = this._generateId();
    const totalChunks = Math.ceil((sizeMB * 1024 * 1024) / this.chunkSize);

    // 写入磁盘元数据
    await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disks'], 'readwrite');
      const store = transaction.objectStore('disks');
      const request = store.put({
        id: diskId,
        name: name,
        size: sizeMB * 1024 * 1024,
        totalChunks: totalChunks,
        chunkSize: this.chunkSize,
        createdAt: Date.now(),
        modifiedAt: Date.now()
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });

    console.log(`[Storage] 创建虚拟磁盘: ${name}, ${sizeMB} MB, ${totalChunks} 块`);
    return diskId;
  }

  // 加载虚拟磁盘为 ArrayBuffer
  async loadDisk(name) {
    await this.openDB();

    // 获取磁盘元数据
    const diskInfo = await this._getDiskInfo(name);
    if (!diskInfo) {
      throw new Error(`磁盘不存在: ${name}`);
    }

    console.log(`[Storage] 加载磁盘: ${name}, ${(diskInfo.size / 1024 / 1024).toFixed(1)} MB`);

    // 创建完整大小的 buffer
    const buffer = new ArrayBuffer(diskInfo.size);
    const view = new Uint8Array(buffer);

    // 读取所有已写入的块
    const chunks = await this._getAllChunks(diskInfo.id);
    for (const chunk of chunks) {
      const offset = chunk.chunkIndex * this.chunkSize;
      view.set(new Uint8Array(chunk.data), offset);
    }

    return buffer;
  }

  // 保存磁盘（从 ArrayBuffer 写回 IndexedDB）
  async saveDisk(name, buffer) {
    await this.openDB();

    const diskInfo = await this._getDiskInfo(name);
    if (!diskInfo) {
      throw new Error(`磁盘不存在: ${name}`);
    }

    console.log(`[Storage] 保存磁盘: ${name}`);

    const view = new Uint8Array(buffer);
    const totalChunks = Math.ceil(buffer.byteLength / this.chunkSize);

    // 分块写入
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * this.chunkSize;
      const chunkData = view.slice(offset, offset + this.chunkSize).buffer;

      await this._putChunk(diskInfo.id, i, chunkData);
    }

    // 更新元数据
    await this._updateDiskModified(diskInfo.id);
    console.log(`[Storage] 磁盘保存完成: ${totalChunks} 块`);
  }

  // 导入 ISO 镜像（从 File 对象）
  async importIso(file, onProgress) {
    await this.openDB();

    const isoId = this._generateId();
    const totalChunks = Math.ceil(file.size / this.chunkSize);

    // 写入 ISO 元数据
    await new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['isos'], 'readwrite');
      const store = transaction.objectStore('isos');
      const request = store.put({
        id: isoId,
        name: file.name,
        size: file.size,
        type: file.type,
        totalChunks: totalChunks,
        createdAt: Date.now()
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });

    // 分块读取并存储
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * this.chunkSize;
      const slice = file.slice(offset, offset + this.chunkSize);
      const data = await slice.arrayBuffer();

      await this._putChunk(isoId, i, data);

      if (onProgress) {
        onProgress(Math.round(((i + 1) / totalChunks) * 100), file.name);
      }
    }

    console.log(`[Storage] ISO 导入完成: ${file.name}, ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    return { id: isoId, name: file.name };
  }

  // 列出所有 ISO
  async listIsos() {
    await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['isos'], 'readonly');
      const store = transaction.objectStore('isos');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // 列出所有磁盘
  async listDisks() {
    await this.openDB();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disks'], 'readonly');
      const store = transaction.objectStore('disks');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // 删除磁盘
  async deleteDisk(name) {
    await this.openDB();
    const diskInfo = await this._getDiskInfo(name);
    if (!diskInfo) return false;

    // 删除所有块
    await this._deleteChunks(diskInfo.id);

    // 删除元数据
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disks'], 'readwrite');
      const store = transaction.objectStore('disks');
      const request = store.delete(diskInfo.id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // 获取存储使用情况
  async getStorageUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage,
        quota: estimate.quota,
        available: estimate.quota - estimate.usage,
        usagePercent: (estimate.usage / estimate.quota * 100).toFixed(1)
      };
    }
    return null;
  }

  // 请求更多存储（持久化存储）
  async requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.log(`[Storage] 持久化存储: ${isPersisted ? '已启用' : '未启用'}`);
      return isPersisted;
    }
    return false;
  }

  // === 内部方法 ===

  async _getDiskInfo(name) {
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['disks'], 'readonly');
      const store = transaction.objectStore('disks');
      const index = store.index('name');
      const request = index.get(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  async _getAllChunks(diskId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disk_chunks'], 'readonly');
      const store = transaction.objectStore('disk_chunks');
      const index = store.index('diskId');
      const request = index.getAll(diskId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async _putChunk(diskId, chunkIndex, data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disk_chunks'], 'readwrite');
      const store = transaction.objectStore('disk_chunks');
      const chunkId = `${diskId}_${chunkIndex}`;
      const request = store.put({
        chunkId: chunkId,
        diskId: diskId,
        chunkIndex: chunkIndex,
        data: data
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }

  async _deleteChunks(diskId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disk_chunks'], 'readwrite');
      const store = transaction.objectStore('disk_chunks');
      const index = store.index('diskId');
      const request = index.openCursor(diskId);

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async _updateDiskModified(diskId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['disks'], 'readwrite');
      const store = transaction.objectStore('disks');
      const request = store.get(diskId);
      request.onsuccess = () => {
        const disk = request.result;
        if (disk) {
          disk.modifiedAt = Date.now();
          store.put(disk);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
