/**
 * VNC (RFB 协议) 客户端
 * 用于连接远程 QEMU VNC 服务器，作为 WebAssembly 模式的备用方案
 */
class VncClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.framebufferWidth = 0;
    this.framebufferHeight = 0;
    this.canvas = null;
    this.ctx = null;
    this.imageData = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.onFrameUpdate = null;
    this._receiveLoopRunning = false;
  }

  // 设置显示画布
  setCanvas(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  // 连接到 VNC 服务器
  async connect(host, port, password = '') {
    return new Promise((resolve, reject) => {
      // 使用 WebSocket 连接（需要 WebSocket-to-TCP 代理，如 websockify）
      const url = `ws://${host}:${port}`;
      this.socket = new WebSocket(url);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        console.log('[VNC] WebSocket 已连接');
        this._handshake().then(resolve).catch(reject);
      };

      this.socket.onerror = (error) => {
        console.error('[VNC] 连接错误', error);
        if (this.onError) this.onError('连接失败');
        reject(error);
      };

      this.socket.onclose = () => {
        this.connected = false;
        this._receiveLoopRunning = false;
        if (this.onDisconnect) this.onDisconnect();
      };

      this.socket.onmessage = (event) => {
        this._handleMessage(event.data);
      };
    });
  }

  // 协议握手
  async _handshake() {
    // 1. 接收版本
    const version = await this._readString(12);
    console.log('[VNC] 服务器版本:', version.trim());

    // 2. 发送版本
    this._sendString('RFB 003.008\n');

    // 3. 安全类型协商
    const numTypes = await this._readByte();
    const types = [];
    for (let i = 0; i < numTypes; i++) {
      types.push(await this._readByte());
    }

    // 选择无密码认证
    if (types.includes(1)) {
      this._sendByte(1);
      const result = await this._readUInt32();
      if (result !== 0) throw new Error('安全认证失败');
    } else {
      throw new Error('不支持的安全类型');
    }

    // 4. 客户端初始化
    this._sendByte(1); // shared

    // 5. 服务器初始化
    await this._serverInit();

    // 6. 设置像素格式
    this._setPixelFormat();

    // 7. 设置编码
    this._setEncodings();

    this.connected = true;
    this._startReceiveLoop();
    this.requestFrameUpdate(false);

    if (this.onConnect) this.onConnect();
    console.log('[VNC] 握手完成');
  }

  async _serverInit() {
    this.framebufferWidth = await this._readUInt16();
    this.framebufferHeight = await this._readUInt16();

    await this._readByte(); // bits-per-pixel
    await this._readByte(); // depth
    await this._readByte(); // big-endian
    await this._readByte(); // true-color

    await this._readUInt16(); // red-max
    await this._readUInt16(); // green-max
    await this._readUInt16(); // blue-max
    await this._readByte(); // red-shift
    await this._readByte(); // green-shift
    await this._readByte(); // blue-shift
    await this._readByte(); // padding
    await this._readByte();
    await this._readByte();

    const nameLength = await this._readUInt32();
    const name = await this._readString(nameLength);
    console.log(`[VNC] 桌面: ${name}, ${this.framebufferWidth}x${this.framebufferHeight}`);

    // 初始化画布
    if (this.canvas) {
      this.canvas.width = this.framebufferWidth;
      this.canvas.height = this.framebufferHeight;
      this.imageData = this.ctx.createImageData(this.framebufferWidth, this.framebufferHeight);
    }
  }

  _setPixelFormat() {
    const msg = new Uint8Array(20);
    msg[0] = 0; // SetPixelFormat
    // 32bpp, 24 depth, little endian, true color
    msg[4] = 32; msg[5] = 24; msg[6] = 0; msg[7] = 1;
    // red-max, green-max, blue-max = 255
    msg[8] = 0; msg[9] = 255;
    msg[10] = 0; msg[11] = 255;
    msg[12] = 0; msg[13] = 255;
    // shifts
    msg[14] = 16; msg[15] = 8; msg[16] = 0;
    this.socket.send(msg.buffer);
  }

  _setEncodings() {
    const encodings = [0, 1, -223]; // RAW, CopyRect, DesktopSize
    const msg = new Uint8Array(4 + encodings.length * 4);
    msg[0] = 2; // SetEncodings
    msg[2] = (encodings.length >> 8) & 0xFF;
    msg[3] = encodings.length & 0xFF;
    encodings.forEach((enc, i) => {
      const offset = 4 + i * 4;
      msg[offset] = (enc >> 24) & 0xFF;
      msg[offset + 1] = (enc >> 16) & 0xFF;
      msg[offset + 2] = (enc >> 8) & 0xFF;
      msg[offset + 3] = enc & 0xFF;
    });
    this.socket.send(msg.buffer);
  }

  // 请求帧更新
  requestFrameUpdate(incremental) {
    const msg = new Uint8Array(10);
    msg[0] = 3; // FramebufferUpdateRequest
    msg[1] = incremental ? 1 : 0;
    // x, y = 0
    // width, height
    msg[6] = (this.framebufferWidth >> 8) & 0xFF;
    msg[7] = this.framebufferWidth & 0xFF;
    msg[8] = (this.framebufferHeight >> 8) & 0xFF;
    msg[9] = this.framebufferHeight & 0xFF;
    this.socket.send(msg.buffer);
  }

  // 发送指针事件
  sendPointerEvent(x, y, buttonMask) {
    const msg = new Uint8Array(6);
    msg[0] = 5; // PointerEvent
    msg[1] = buttonMask;
    msg[2] = (x >> 8) & 0xFF;
    msg[3] = x & 0xFF;
    msg[4] = (y >> 8) & 0xFF;
    msg[5] = y & 0xFF;
    this.socket.send(msg.buffer);
  }

  // 发送键盘事件
  sendKeyEvent(keysym, down) {
    const msg = new Uint8Array(8);
    msg[0] = 4; // KeyEvent
    msg[1] = down ? 1 : 0;
    msg[4] = (keysym >> 24) & 0xFF;
    msg[5] = (keysym >> 16) & 0xFF;
    msg[6] = (keysym >> 8) & 0xFF;
    msg[7] = keysym & 0xFF;
    this.socket.send(msg.buffer);
  }

  // 断开连接
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this._receiveLoopRunning = false;
  }

  // === 内部方法 ===

  _handleMessage(data) {
    // 处理服务端消息
    const view = new DataView(data);
    const msgType = view.getUint8(0);

    switch (msgType) {
      case 0: // FramebufferUpdate
        this._handleFramebufferUpdate(view);
        break;
      case 2: // Bell
        break;
      case 3: // ServerCutText
        break;
    }
  }

  _handleFramebufferUpdate(view) {
    const numRects = view.getUint16(2);
    let offset = 4;

    for (let i = 0; i < numRects; i++) {
      const x = view.getUint16(offset);
      const y = view.getUint16(offset + 2);
      const width = view.getUint16(offset + 4);
      const height = view.getUint16(offset + 6);
      const encoding = view.getInt32(offset + 8);
      offset += 12;

      if (encoding === 0) { // RAW
        const pixelData = new Uint8Array(view.buffer, offset, width * height * 4);
        this._drawRawRect(x, y, width, height, pixelData);
        offset += width * height * 4;
      } else if (encoding === 1) { // CopyRect
        const srcX = view.getUint16(offset);
        const srcY = view.getUint16(offset + 2);
        this._copyRect(x, y, width, height, srcX, srcY);
        offset += 4;
      }
    }

    if (this.onFrameUpdate) this.onFrameUpdate();
    this.requestFrameUpdate(true);
  }

  _drawRawRect(x, y, width, height, pixelData) {
    if (!this.imageData) return;
    const data = this.imageData.data;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const srcOffset = (py * width + px) * 4;
        const dstOffset = ((y + py) * this.framebufferWidth + (x + px)) * 4;
        // BGRA -> RGBA
        data[dstOffset] = pixelData[srcOffset + 2];
        data[dstOffset + 1] = pixelData[srcOffset + 1];
        data[dstOffset + 2] = pixelData[srcOffset];
        data[dstOffset + 3] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  _copyRect(x, y, width, height, srcX, srcY) {
    const temp = this.ctx.getImageData(srcX, srcY, width, height);
    this.ctx.putImageData(temp, x, y);
  }

  _startReceiveLoop() {
    this._receiveLoopRunning = true;
  }

  async _readByte() {
    const data = await this._read(1);
    return new Uint8Array(data)[0];
  }

  async _readUInt16() {
    const data = await this._read(2);
    const view = new DataView(data);
    return view.getUint16(0);
  }

  async _readUInt32() {
    const data = await this._read(4);
    const view = new DataView(data);
    return view.getUint32(0);
  }

  async _readString(length) {
    const data = await this._read(length);
    return new TextDecoder().decode(data);
  }

  _read(length) {
    return new Promise((resolve) => {
      const handleMessage = (event) => {
        this.socket.removeEventListener('message', handleMessage);
        resolve(event.data);
      };
      this.socket.addEventListener('message', handleMessage);
    });
  }

  _sendByte(byte) {
    this.socket.send(new Uint8Array([byte]));
  }

  _sendString(str) {
    this.socket.send(new TextEncoder().encode(str));
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VncClient;
}
