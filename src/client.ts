import { IRectDecoder } from './decoders/decoder.js';
import { HextileDecoder } from './decoders/hextile.js';
import { RawDecoder } from './decoders/raw.js';
import { ZrleDecoder } from './decoders/zrle.js';
// import { TightDecoder } from "./decoders/tight.js";
import { CopyRectDecoder } from './decoders/copyrect.js';

import { EventEmitter } from 'node:events';

import { consts } from './constants.js';

import * as net from 'node:net';

import { SocketBuffer } from './socketbuffer.js';

import { RectangleWithData, Color3, PixelFormat, Cursor } from './types.js';
import { ISecurityType } from './security/securitytype.js';
import { NoneSecurityType } from './security/none.js';
import { VncSecurityType } from './security/vnc.js';
import { NtlmAuthInfo, NtlmSecurityType } from './security/ntlm.js';
export class VncClient extends EventEmitter {
	// These are in no particular order.

	public debug: boolean = false;

	private _connected: boolean = false;
	private _authenticated: boolean = false;
	private _version: string = '';
	private _auth: object = {};

	private _audioChannels: number = 2;
	private _audioFrequency: number = 22050;

	private _rects: number = 0;

	private _decoders: Array<IRectDecoder> = [];
	private _securityTypes: Array<ISecurityType> = [];

	private _fps: number;
	private _timerInterval: number;
	private _timerPointer: NodeJS.Timeout | null = null;

	public fb: Buffer = Buffer.from([]);

	private _waitingSecurityTypes: boolean = false;
	private _waitingServerInit: boolean = false;
	private _expectingChallenge: boolean = false;
	private _waitingSecurityResult: boolean = false;

	private _set8BitColor: boolean = false;
	private _frameBufferReady = false;
	private _firstFrameReceived = false;
	private _processingFrame = false;

	private _relativePointer: boolean = false;

	public clientWidth: number = 0;
	public clientHeight: number = 0;
	public clientName: string = '';

	public pixelFormat: PixelFormat = {
		bitsPerPixel: 0,
		depth: 0,
		bigEndianFlag: 0,
		trueColorFlag: 0,
		redMax: 0,
		greenMax: 0,
		blueMax: 0,
		redShift: 0,
		greenShift: 0,
		blueShift: 0
	};

	private _colorMap: Color3[] = [];
	private _audioData: Buffer = Buffer.from([]);

	private _cursor: Cursor = {
		width: 0,
		height: 0,
		x: 0,
		y: 0,
		cursorPixels: null,
		bitmask: null,
		posX: 0,
		posY: 0
	};

	private _securityType?: ISecurityType;

	public encodings: number[];

	private _connection: net.Socket | null = null;
	private _socketBuffer: SocketBuffer;

	static get consts() {
		return {
			encodings: consts.encodings
		};
	}

	/**
	 * Return if client is connected
	 */
	get connected() {
		return this._connected;
	}

	/**
	 * Return if client is authenticated
	 */
	get authenticated() {
		return this._authenticated;
	}

	/**
	 * Return negotiated protocol version
	 */
	get protocolVersion() {
		return this._version;
	}

	/**
	 * Return the local port used by the client
	 */
	get localPort() {
		return this._connection ? this._connection?.localPort : 0;
	}

	constructor(options: any = { debug: false, fps: 0, encodings: [] }) {
		super();

		this._socketBuffer = new SocketBuffer(options.debug);

		this.resetState();
		this.debug = options.debug || false;
		this._fps = Number(options.fps) || 0;
		// Calculate interval to meet configured FPS
		this._timerInterval = this._fps > 0 ? 1000 / this._fps : 0;

		// Default encodings
		this.encodings =
			options.encodings && options.encodings.length
				? options.encodings
				: [consts.encodings.copyRect, consts.encodings.zrle, consts.encodings.hextile, consts.encodings.raw, consts.encodings.pseudoDesktopSize];

		this._audioChannels = options.audioChannels || 2;
		this._audioFrequency = options.audioFrequency || 22050;

		this._rects = 0;

		this._decoders[consts.encodings.raw] = new RawDecoder();
		// TODO: Implement tight encoding
		// this._decoders[encodings.tight] = new tightDecoder();
		this._decoders[consts.encodings.zrle] = new ZrleDecoder();
		this._decoders[consts.encodings.copyRect] = new CopyRectDecoder();
		this._decoders[consts.encodings.hextile] = new HextileDecoder();

		this._securityTypes[consts.security.None] = new NoneSecurityType();
		this._securityTypes[consts.security.VNC] = new VncSecurityType();
		this._securityTypes[consts.security.NTLM] = new NtlmSecurityType();

		if (this._timerInterval) {
			this._fbTimer();
		}
	}

	/**
	 * Timer used to limit the rate of frame update requests according to configured FPS
	 */
	private _fbTimer() {
		this._timerPointer = setTimeout(() => {
			this._fbTimer();
			if (this._firstFrameReceived && !this._processingFrame && this._fps > 0) {
				this.requestFrameUpdate();
			}
		}, this._timerInterval);
	}

	/**
	 * Adjuste the configured FPS
	 * @param fps {number} - Number of update requests send by second
	 */
	changeFps(fps: number) {
		if (!Number.isNaN(fps)) {
			this._fps = Number(fps);
			this._timerInterval = this._fps > 0 ? 1000 / this._fps : 0;

			if (this._timerPointer && !this._fps) {
				// If FPS was zeroed stop the timer
				clearTimeout(this._timerPointer);
				this._timerPointer = null;
			} else if (this._fps && !this._timerPointer) {
				// If FPS was zero and is now set, start the timer
				this._fbTimer();
			}
		} else {
			throw new Error('Invalid FPS. Must be a number.');
		}
	}

	/**
	 * Starts the connection with the VNC server
	 * @param options
	 */
	connect(
		options: any /* = {
			host: '',
			password: '',
			path: '',
			set8BitColor: false,
			port: 5900
		} */
	) {
		if (options.auth) {
			this._auth = options.auth;
		}

		this._set8BitColor = options.set8BitColor || false;

		if (options.path === null) {
			if (!options.host) {
				throw new Error('Host missing.');
			}
			this._connection = net.connect(options.port || 5900, options.host);

			// disable nagle's algorithm for TCP
			this._connection?.setNoDelay();
		} else {
			// unix socket. bodged in but oh well
			this._connection = net.connect(options.path);
		}

		this._connection?.on('connect', () => {
			this._connected = true;
			this.emit('connected');
			this._readWorker();
		});

		this._connection?.on('close', () => {
			this.resetState();
			this.emit('closed');
		});

		this._connection?.on('timeout', () => {
			this.emit('connectTimeout');
		});

		this._connection?.on('error', (err) => {
			this.emit('connectError', err);
		});

		this._connection?.on('data', async (data) => {
			this._socketBuffer.pushData(data);
		});
	}

	private async _readWorker() {
		while (this._connection?.readable) {
			if (this._version == '') {
				await this._handleVersion();
			} else if (this._waitingSecurityTypes) {
				await this._handleSecurityTypes();
			} else if (this._expectingChallenge) {
				await this._handleAuthChallenge();
			} else if (this._waitingSecurityResult) {
				await this._handleSecurityResult();
			} else if (this._waitingServerInit) {
				await this._handleServerInit();
			} else {
				await this._handleData();
			}

			this._socketBuffer.flush(true);
		}
	}

	/**
	 * Disconnect the client
	 */
	disconnect() {
		if (this._connection) {
			this._connection?.end();
			this.resetState();
			this.emit('disconnected');
		}
	}

	/**
	 * Request the server a frame update
	 * @param full - If the server should send all the frame buffer or just the last changes
	 * @param incremental - Incremental number for not full requests
	 * @param x - X position of the update area desired, usually 0
	 * @param y - Y position of the update area desired, usually 0
	 * @param width - Width of the update area desired, usually client width
	 * @param height - Height of the update area desired, usually client height
	 */
	requestFrameUpdate(full = false, incremental = 1, x = 0, y = 0, width = this.clientWidth, height = this.clientHeight) {
		if ((this._frameBufferReady || full) && this._connection && !this._rects) {
			// Request data
			const message = Buffer.alloc(10);
			message.writeUInt8(3); // Message type
			message.writeUInt8(full ? 0 : incremental, 1); // Incremental
			message.writeUInt16BE(x, 2); // X-Position
			message.writeUInt16BE(y, 4); // Y-Position
			message.writeUInt16BE(width, 6); // Width
			message.writeUInt16BE(height, 8); // Height

			this._connection?.write(message);

			this._frameBufferReady = true;
		}
	}

	/**
	 * Handle handshake msg
	 */
	private async _handleVersion() {
		let ver = (await this._socketBuffer.readNBytesOffset(12)).toString('ascii');
		// Handshake, negotiating protocol version
		if (ver === consts.versionString.V3_003) {
			this._log('Sending 3.3', true);
			this._connection?.write(consts.versionString.V3_003);
			this._version = '3.3';
		} else if (ver === consts.versionString.V3_006) {
			this._log('Sending 3.6 (VMRC)', true);
			this._connection?.write(consts.versionString.V3_006);
			this._version = '3.6';
		} else if (ver === consts.versionString.V3_007) {
			this._log('Sending 3.7', true);
			this._connection?.write(consts.versionString.V3_007);
			this._version = '3.7';
		} else if (ver === consts.versionString.V3_008) {
			this._log('Sending 3.8', true);
			this._connection?.write(consts.versionString.V3_008);
			this._version = '3.8';
		} else {
			this._log(`Unknown Protocol Version (not an RFB server?)`, true);
			this._log(ver, true);
			this.disconnect();
			return;
		}

		this._waitingSecurityTypes = true;
	}

	private async _handleSecurityTypes() {
		this._waitingSecurityTypes = false;
		let selectedType;
		// Negotiating auth mechanism
		if (this._version === '3.7' || this._version === '3.8') {
			// Read number of security types
			let securityTypesCount = await this._socketBuffer.readUInt8();

			if (securityTypesCount === 0) {
				let errorLen = await this._socketBuffer.readUInt32BE();
				let error = (await this._socketBuffer.readNBytesOffset(errorLen)).toString('utf8');
				this._log(`Connection error: ${error}`, true);
				this.disconnect();
				return;
			}

			let availableSecurityTypes = Array.from(await this._socketBuffer.readNBytesOffset(securityTypesCount));
			this._log(`Server offers security types: ${JSON.stringify(availableSecurityTypes)}`, true);

			selectedType = availableSecurityTypes.find((t) => this._securityTypes[t] != undefined);

			// Send selected type
			if (selectedType) {
				this._connection?.write(Buffer.from([selectedType]));
			}
		} else {
			// Server dictates security type
			selectedType = await this._socketBuffer.readUInt32BE();
		}

		if (!selectedType || !this._securityTypes[selectedType]) {
			this._log('No supported security types.', true);
			this.disconnect();
			return;
		}

		this._log(`Security type: ${selectedType}`, true);

		this._securityType = this._securityTypes[selectedType];

		if (selectedType === consts.security.None && this._version !== '3.8') {
			this._log('Using no authentication', true);
			this._authenticated = true;
			this.emit('authenticated');
			this._sendClientInit();
		} else {
			this._expectingChallenge = true;
		}
	}

	/**
	 * Handle VNC auth challenge
	 */
	private async _handleAuthChallenge() {
		if (!this._securityType) {
			throw new Error('Security type was null somehow');
		}

		this._log(`Authenticating using ${this._securityType.getName()}`, true);
		await this._securityType.authenticate(this._version, this._socketBuffer, this._connection!, this._auth);
		this._log('Authentication finished, waiting for SecurityResult', true);
		this._expectingChallenge = false;
		this._waitingSecurityResult = true;
	}

	private async _handleSecurityResult() {
		if ((await this._socketBuffer.readUInt32BE()) === 0) {
			// Auth success
			this._log('SecurityResult success', true);
			this._authenticated = true;
			this._waitingSecurityResult = false;
			this.emit('authenticated');
			this._sendClientInit();
		} else {
			// Auth fail
			this.emit('authError');
			this.resetState();
		}
	}

	/**
	 * Handle server init msg
	 */
	private async _handleServerInit() {
		this._waitingServerInit = false;

		this.clientWidth = await this._socketBuffer.readUInt16BE();
		this.clientHeight = await this._socketBuffer.readUInt16BE();

		this._log(`Resolution: ${this.clientWidth}x${this.clientHeight}`, true);

		let pixelFormat = await this._socketBuffer.readNBytesOffset(16);
		this.readPixelFormat(pixelFormat);
		this.updateFbSize();

		this._log(`Pixel format: ${JSON.stringify(this.pixelFormat)}`, true);
		let clientNameLen = await this._socketBuffer.readUInt32BE();
		this.clientName = (await this._socketBuffer.readNBytesOffset(clientNameLen)).toString();
		this._log(`Client name: ${this.clientName}`, true);

		// FIXME: Removed because these are noise
		//this._log(`Screen size: ${this.clientWidth}x${this.clientHeight}`);
		//this._log(`Client name: ${this.clientName}`);
		//this._log(`pixelFormat: ${JSON.stringify(this.pixelFormat)}`);

		if (this._set8BitColor) {
			//this._log(`8 bit color format requested, only raw encoding is supported.`);
			this._setPixelFormatToColorMap();
		}
		if (this._version === '3.6') {
			this._connection?.write(Buffer.from([0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x2a]));
			let vm = (this._auth as NtlmAuthInfo).vm ?? '';

			let buf = Buffer.alloc(12 + vm.length);
			buf[0] = 0x07;
			buf[1] = 0x02;
			buf[7] = 0x02;
			buf.writeUint32BE(vm.length, 8);
			buf.write(vm, 12, 'utf8');
			this._connection?.write(buf);
			this.setPixelFormat({
				bitsPerPixel: 32,
				depth: 24,
				bigEndianFlag: 0,
				trueColorFlag: 1,
				redMax: 255,
				greenMax: 255,
				blueMax: 255,
				redShift: 0,
				greenShift: 8,
				blueShift: 16
			});
			this.requestFrameUpdate(true);
		} else {
			this._sendEncodings();
			setTimeout(() => {
				this.requestFrameUpdate(true);
			}, 1000);
		}
	}

	private readPixelFormat(pixelFormat: Buffer) {
		this.pixelFormat.bitsPerPixel = pixelFormat.readUInt8(0);
		this.pixelFormat.depth = pixelFormat.readUInt8(1);
		this.pixelFormat.bigEndianFlag = pixelFormat.readUInt8(2);
		this.pixelFormat.trueColorFlag = pixelFormat.readUInt8(3);
		this.pixelFormat.redMax = this.pixelFormat.bigEndianFlag ? pixelFormat.readUInt16BE(4) : pixelFormat.readUInt16LE(4);
		this.pixelFormat.greenMax = this.pixelFormat.bigEndianFlag ? pixelFormat.readUInt16BE(6) : pixelFormat.readUInt16LE(6);
		this.pixelFormat.blueMax = this.pixelFormat.bigEndianFlag ? pixelFormat.readUInt16BE(8) : pixelFormat.readUInt16LE(8);
		this.pixelFormat.redShift = pixelFormat.readInt8(10);
		this.pixelFormat.greenShift = pixelFormat.readInt8(11);
		this.pixelFormat.blueShift = pixelFormat.readInt8(12);
	}

	/**
	 * Update the frame buffer size according to client width and height (RGBA)
	 */
	updateFbSize() {
		this.fb = Buffer.alloc(this.clientWidth * this.clientHeight * (this.pixelFormat.bitsPerPixel / 8));
	}

	setPixelFormat(format: PixelFormat) {
		const message = Buffer.alloc(20);

		message.writeUint8(format.bitsPerPixel, 4);
		message.writeUint8(format.depth, 5);
		message.writeUint8(format.bigEndianFlag, 6);
		message.writeUint8(format.trueColorFlag, 7);
		message.writeUint16BE(format.redMax, 8);
		message.writeUint16BE(format.greenMax, 10);
		message.writeUint16BE(format.blueMax, 12);
		message.writeUint8(format.redShift, 14);
		message.writeUint8(format.greenShift, 15);
		message.writeUint8(format.blueShift, 16);

		this._connection?.write(message);
		this.pixelFormat = format;
	}

	/**
	 * Request the server to change to 8bit color format (Color palette). Only works with Raw encoding.
	 */
	private _setPixelFormatToColorMap() {
		this._log(`Requesting PixelFormat change to ColorMap (8 bits).`, true);
		this.setPixelFormat({
			bitsPerPixel: 8,
			depth: 8,
			bigEndianFlag: 0,
			trueColorFlag: 0,
			redMax: 255,
			greenMax: 255,
			blueMax: 255,
			redShift: 0,
			greenShift: 8,
			blueShift: 16
		});
	}

	/**
	 * Send supported encodings
	 */
	private _sendEncodings() {
		//this._log('Sending encodings.');
		// If this._set8BitColor is set, only copyrect and raw encodings are supported
		const message = Buffer.alloc(4 + (!this._set8BitColor ? this.encodings.length : 2) * 4);
		message.writeUInt8(2); // Message type
		message.writeUInt8(0, 1); // Padding
		message.writeUInt16BE(!this._set8BitColor ? this.encodings.length : 2, 2); // Padding

		let offset = 4;
		// If 8bits is not set, send all encodings configured
		if (!this._set8BitColor) {
			for (const e of this.encodings) {
				message.writeInt32BE(e, offset);
				offset += 4;
			}
		} else {
			message.writeInt32BE(consts.encodings.copyRect, offset);
			message.writeInt32BE(consts.encodings.raw, offset + 4);
		}

		this._connection?.write(message);
	}

	/**
	 * Send client init msg
	 */
	private _sendClientInit() {
		//this._log(`Sending clientInit`);
		this._waitingServerInit = true;
		// Shared bit set
		this._connection?.write('1');
	}

	/**
	 * Handle data msg
	 */
	private async _handleData() {
		let msg = await this._socketBuffer.readUInt8(true);
		switch (msg) {
			case consts.serverMsgTypes.fbUpdate:
				await this._handleFbUpdate();
				return;

			case consts.serverMsgTypes.setColorMap:
				await this._handleSetColorMap();
				return;

			case consts.serverMsgTypes.bell:
				this.emit('bell');
				await this._socketBuffer.readUInt8();
				return;

			case consts.serverMsgTypes.cutText:
				await this._handleCutText();
				return;

			case consts.serverMsgTypes.qemuAudio:
				await this._handleQemuAudio();
				return;
		}
		if (this._version === '3.6') {
			switch (msg) {
				case 0x04: {
					// Read display update
					let displayUpdate = await this._socketBuffer.readNBytesOffset(28);

					let nameWidth = displayUpdate.readUint32BE(24);
					this.clientName = (await this._socketBuffer.readNBytesOffset(nameWidth)).toString('utf-8');
					this._log(`VMRC Client Name: ${this.clientName}`, true);

					this.clientWidth = displayUpdate.readUInt16BE(4);
					this.clientHeight = displayUpdate.readUInt16BE(6);
					this._log(`VM resolution: ${this.clientWidth}x${this.clientHeight}`, true);

					this.readPixelFormat(displayUpdate.subarray(8, 24));

					this.updateFbSize();
					this.emit('desktopSizeChanged', { width: this.clientWidth, height: this.clientHeight });

					this._sendEncodings();

					this.setPixelFormat({
						bitsPerPixel: 32,
						depth: 24,
						bigEndianFlag: 0,
						trueColorFlag: 1,
						redMax: 255,
						greenMax: 255,
						blueMax: 255,
						redShift: 0,
						greenShift: 8,
						blueShift: 16
					});
					this.requestFrameUpdate(true);
					break;
				}
				default: {
					// hopefully doesnt cause problems tm
					this._log(`Unknown VMRC command ${msg}`, true);
					this._socketBuffer.flush(false);
					break;
				}
			}
		}
	}

	/**
	 * Cut message (text was copied to clipboard on server)
	 */
	private async _handleCutText(): Promise<void> {
		await this._socketBuffer.readNBytesOffset(4);
		const length = await this._socketBuffer.readUInt32BE();
		this.emit('cutText', (await this._socketBuffer.readNBytesOffset(length)).toString());
	}

	/**
	 * Gets the pseudocursor framebuffer
	 */
	private _getPseudoCursor() {
		if (!this._cursor.width)
			return {
				width: 1,
				height: 1,
				data: Buffer.alloc(4)
			};
		const { width, height, bitmask, cursorPixels } = this._cursor;

		if (bitmask == null || cursorPixels == null) throw new Error('No cursor data to get!');

		const data = Buffer.alloc(height * width * 4);
		for (var y = 0; y < height; y++) {
			for (var x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				const active = (bitmask[Math.floor((width + 7) / 8) * y + Math.floor(x / 8)] >> (7 - (x % 8))) & 1;
				if (active) {
					switch (this.pixelFormat.bitsPerPixel) {
						case 8:
							const index = cursorPixels.readUInt8(offset);
							// @ts-ignore (This line is extremely suspect anyways. I bet this is horribly broken!!)
							const color = this._colorMap[index] | 0xff;
							data.writeIntBE(color, offset, 4);
							break;
						case 32:
							// TODO: compatibility with VMware actually using the alpha channel
							const b = cursorPixels.readUInt8(offset);
							const g = cursorPixels.readUInt8(offset + 1);
							const r = cursorPixels.readUInt8(offset + 2);
							data.writeUInt8(r, offset);
							data.writeUInt8(g, offset + 1);
							data.writeUInt8(b, offset + 2);
							data.writeUInt8(0xff, offset + 3);
							break;
						default:
							data.writeIntBE(cursorPixels.readIntBE(offset, this.pixelFormat.bitsPerPixel / 8), offset, this.pixelFormat.bitsPerPixel / 8);
							break;
					}
				}
			}
		}
		return {
			x: this._cursor.x,
			y: this._cursor.y,
			width,
			height,
			data
		};
	}

	/**
	 * Handle a rects of update message
	 */
	private async _handleRect() {
		this._processingFrame = true;
		const sendFbUpdate = this._rects;

		while (this._rects) {
			const rect: RectangleWithData = {
				x: await this._socketBuffer.readUInt16BE(),
				y: await this._socketBuffer.readUInt16BE(),
				width: await this._socketBuffer.readUInt16BE(),
				height: await this._socketBuffer.readUInt16BE(),
				encoding: await this._socketBuffer.readInt32BE(),
				data: null // for now
			};

			if (rect.encoding === consts.encodings.pseudoQemuAudio) {
				this.sendAudio(true);
				this.sendAudioConfig(this._audioChannels, this._audioFrequency); //todo: future: setFrequency(...) to update mid thing
			} else if (rect.encoding === consts.encodings.pseudoQemuPointerMotionChange) {
				this._relativePointer = rect.x == 0;
			} else if (rect.encoding === consts.encodings.pseudoCursor) {
				const dataSize = rect.width * rect.height * (this.pixelFormat.bitsPerPixel / 8);
				const bitmaskSize = Math.floor((rect.width + 7) / 8) * rect.height;
				this._cursor.width = rect.width;
				this._cursor.height = rect.height;
				this._cursor.x = rect.x;
				this._cursor.y = rect.y;
				this._cursor.cursorPixels = await this._socketBuffer.readNBytesOffset(dataSize);
				this._cursor.bitmask = await this._socketBuffer.readNBytesOffset(bitmaskSize);
				rect.data = Buffer.concat([this._cursor.cursorPixels, this._cursor.bitmask]);
				this.emit('cursorChanged', this._getPseudoCursor());
			} else if (rect.encoding === consts.encodings.pseudoDesktopSize) {
				this._log('Frame Buffer size change requested by the server', true);
				this.clientHeight = rect.height;
				this.clientWidth = rect.width;
				this.updateFbSize();
				this.emit('desktopSizeChanged', { width: this.clientWidth, height: this.clientHeight });
			} else if (this._decoders[rect.encoding]) {
				await this._decoders[rect.encoding].decode(
					rect,
					this.fb,
					this.pixelFormat.bitsPerPixel,
					this._colorMap,
					this.clientWidth,
					this.clientHeight,
					this._socketBuffer,
					this.pixelFormat.depth
				);
				this.emit('rectUpdateProcessed', {
					x: rect.x,
					y: rect.y,
					width: rect.width,
					height: rect.height
				});
			} else {
				this._log('Non supported update received. Encoding: ' + rect.encoding);
			}
			this._rects--;
			this.emit('rectProcessed', rect);
		}

		if (sendFbUpdate) {
			if (!this._firstFrameReceived) {
				this._firstFrameReceived = true;
				this.emit('firstFrameUpdate', this.fb);
			}
			this._log('Frame buffer updated.', true);
			this.emit('frameUpdated', this.fb);
		}

		this._processingFrame = false;

		if (this._fps === 0) {
			// If FPS is not set, request a new update as soon as the last received has been processed
			this.requestFrameUpdate();
		}
	}

	private async _handleFbUpdate() {
		await this._socketBuffer.readNBytesOffset(2);
		this._rects = await this._socketBuffer.readUInt16BE();
		this._log('Frame update received. Rects: ' + this._rects, true);
		await this._handleRect();
	}

	/**
	 * Handle setColorMap msg
	 */
	private async _handleSetColorMap(): Promise<void> {
		await this._socketBuffer.readNBytesOffset(2);
		let firstColor = await this._socketBuffer.readUInt16BE();
		const numColors = await this._socketBuffer.readUInt16BE();

		this._log(`ColorMap received. Colors: ${numColors}.`, true);

		for (let x = 0; x < numColors; x++) {
			this._colorMap[firstColor] = {
				r: Math.floor(((await this._socketBuffer.readUInt16BE()) / 65535) * 255),
				g: Math.floor(((await this._socketBuffer.readUInt16BE()) / 65535) * 255),
				b: Math.floor(((await this._socketBuffer.readUInt16BE()) / 65535) * 255)
			};
			firstColor++;
		}

		this.emit('colorMapUpdated', this._colorMap);
	}

	async _handleQemuAudio() {
		await this._socketBuffer.readNBytesOffset(2);
		let operation = await this._socketBuffer.readUInt16BE();
		if (operation == 2) {
			const length = await this._socketBuffer.readUInt32BE();

			//this._log(`Audio received. Length: ${length}.`)

			let audioBuffer = await this._socketBuffer.readNBytesOffset(length);

			this._audioData = audioBuffer;
		}

		this.emit('audioStream', this._audioData);
	}

	/**
	 * Reset the class state
	 */
	resetState() {
		if (this._connection) {
			this._connection?.end();
		}

		if (this._timerPointer) {
			clearInterval(this._timerPointer);
		}

		this._timerPointer = null;

		//this._connection = null;

		this._connected = false;
		this._authenticated = false;
		this._version = '';

		this._auth = {};

		this._audioChannels = 2;
		this._audioFrequency = 22050;

		this._waitingSecurityTypes = false;

		this._expectingChallenge = false;
		this._waitingSecurityResult = false;

		this._frameBufferReady = false;
		this._firstFrameReceived = false;
		this._processingFrame = false;

		this.clientWidth = 0;
		this.clientHeight = 0;
		this.clientName = '';

		this.pixelFormat = {
			bitsPerPixel: 0,
			depth: 0,
			bigEndianFlag: 0,
			trueColorFlag: 0,
			redMax: 0,
			greenMax: 0,
			blueMax: 0,
			redShift: 0,
			blueShift: 0,
			greenShift: 0
		};

		this._rects = 0;

		this._colorMap = [];
		this.fb = Buffer.from([]);

		this._socketBuffer?.flush(false);

		this._cursor = {
			width: 0,
			height: 0,
			x: 0,
			y: 0,
			cursorPixels: null,
			bitmask: null,
			posX: 0,
			posY: 0
		};

		this._securityType = undefined;
	}

	/**
	 * Send a key event
	 * @param key - Key code (keysym) defined by X Window System, check https://wiki.linuxquestions.org/wiki/List_of_keysyms
	 * @param down - True if the key is pressed, false if it is not
	 */
	sendKeyEvent(key: number, down: boolean = false) {
		const message = Buffer.alloc(8);
		message.writeUInt8(4); // Message type
		message.writeUInt8(down ? 1 : 0, 1); // Down flag
		message.writeUInt8(0, 2); // Padding
		message.writeUInt8(0, 3); // Padding

		message.writeUInt32BE(key, 4); // Key code

		this._connection?.write(message);
	}

	/**
	 * Send a raw pointer event
	 * @param xPosition - X Position
	 * @param yPosition - Y Position
	 * @param mask - Raw RFB button mask
	 */
	sendPointerEvent(xPosition: number, yPosition: number, buttonMask: number) {
		const message = Buffer.alloc(6);
		message.writeUInt8(consts.clientMsgTypes.pointerEvent); // Message type
		message.writeUInt8(buttonMask, 1); // Button Mask
		const reladd = this._relativePointer ? 0x7fff : 0;
		message.writeUInt16BE(xPosition + reladd, 2); // X Position
		message.writeUInt16BE(yPosition + reladd, 4); // Y Position

		this._cursor.posX = xPosition;
		this._cursor.posY = yPosition;

		this._connection?.write(message);
	}

	/**
	 * Send client cut message to server
	 * @param text - latin1 encoded
	 */
	clientCutText(text: string) {
		const textBuffer = Buffer.from(text, 'latin1');
		const message = Buffer.alloc(8 + textBuffer.length);
		message.writeUInt8(6); // Message type
		message.writeUInt8(0, 1); // Padding
		message.writeUInt8(0, 2); // Padding
		message.writeUInt8(0, 3); // Padding
		message.writeUInt32BE(textBuffer.length, 4); // Padding
		textBuffer.copy(message, 8);

		this._connection?.write(message);
	}

	sendAudio(enable: boolean) {
		const message = Buffer.alloc(4);
		message.writeUInt8(consts.clientMsgTypes.qemuAudio); // Message type
		message.writeUInt8(1, 1); // Submessage Type
		message.writeUInt16BE(enable ? 0 : 1, 2); // Operation
		this._connection?.write(message);
	}

	sendAudioConfig(channels: number, frequency: number) {
		const message = Buffer.alloc(10);
		message.writeUInt8(consts.clientMsgTypes.qemuAudio); // Message type
		message.writeUInt8(1, 1); // Submessage Type
		message.writeUInt16BE(2, 2); // Operation
		message.writeUInt8(0 /*U8*/, 4); // Sample Format
		message.writeUInt8(channels, 5); // Number of Channels
		message.writeUInt32BE(frequency, 6); // Frequency
		this._connection?.write(message);
	}

	/**
	 * Print log info
	 * @param text
	 * @param debug
	 */
	private _log(text: string, debug = false) {
		if (!debug || (debug && this.debug)) {
			console.log(text);
		}
	}
}
