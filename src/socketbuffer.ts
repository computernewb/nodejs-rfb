class SocketBufferAwaiter {
	bytesWanted: number;
	resolve: () => void;

	constructor(bytesWanted: number, resolve: () => void) {
		this.resolve = resolve;

		this.bytesWanted = bytesWanted;
	}
}

/// this is a pretty poor name.
export class SocketBuffer {
	private buffer: Buffer;
	private offset: number;
	private debug: boolean;
	private awaiters: SocketBufferAwaiter[] = [];

	constructor(debug: boolean) {
		this.buffer = Buffer.from([]);
		this.offset = 0;
		this.debug = debug;
		this.flush();
	}

	flush(keep = true) {
		if (keep && this.buffer?.length) {
			this.buffer = this.buffer.subarray(this.offset);
			this.offset = 0;
		} else {
			this.buffer = Buffer.from([]);
			this.offset = 0;
		}
	}

	toString() {
		return this.buffer.toString();
	}

	includes(check: Buffer | number | string) {
		return this.buffer.includes(check);
	}

	pushData(data: Buffer) {
		this.buffer = Buffer.concat([this.buffer, data]);
		if (data.length < 1024) {
			this._log(`S: ${data.toString('hex')}`, true);
		}
		for (let i = 0; i < this.awaiters.length; i++) {
			if (this.bytesLeft() >= this.awaiters[i].bytesWanted) {
				this.awaiters[i].resolve();
				this.awaiters.splice(i, 1);
			}
		}
	}

	async readInt32BE() {
		await this.waitBytes(4);
		const data = this.buffer.readInt32BE(this.offset);
		this.offset += 4;
		return data;
	}

	async readInt32LE() {
		await this.waitBytes(4);
		const data = this.buffer.readInt32LE(this.offset);
		this.offset += 4;
		return data;
	}

	async readUInt32BE() {
		await this.waitBytes(4);
		const data = this.buffer.readUInt32BE(this.offset);
		this.offset += 4;
		return data;
	}

	async readUInt32LE() {
		await this.waitBytes(4);
		const data = this.buffer.readUInt32LE(this.offset);
		this.offset += 4;
		return data;
	}

	async readUInt16BE() {
		await this.waitBytes(2);
		const data = this.buffer.readUInt16BE(this.offset);
		this.offset += 2;
		return data;
	}

	async readUInt16LE() {
		await this.waitBytes(2);
		const data = this.buffer.readUInt16LE(this.offset);
		this.offset += 2;
		return data;
	}

	async readUInt8(peek: boolean = false) {
		await this.waitBytes(1);
		const data = this.buffer.readUInt8(this.offset);
		if (!peek) {
			this.offset += 1;
		}
		return data;
	}

	async readInt8() {
		await this.waitBytes(1);
		const data = this.buffer.readInt8(this.offset);
		this.offset += 1;
		return data;
	}

	async readNBytesOffset(bytes: number) {
		await this.waitBytes(bytes);
		const data = this.buffer.subarray(this.offset, this.offset + bytes);
		this.offset += bytes;
		return data;
	}

	bytesLeft() {
		return this.buffer.length - this.offset;
	}

	private waitBytes(bytes: number): Promise<void> {
		return new Promise((resolve) => {
			if (this.bytesLeft() >= bytes) {
				resolve();
				return;
			}
			let awaiter = new SocketBufferAwaiter(bytes, () => resolve());
			this.awaiters.push(awaiter);
			return awaiter;
		});
	}

	waitData(): Promise<void> {
		return this.waitBytes(1);
	}

	fill(data: Buffer) {
		this.buffer.fill(data, this.offset, this.offset + data.length);
		this.offset += data.length;
	}

	fillMultiple(data: Buffer, repeats: number) {
		this.buffer.fill(data, this.offset, this.offset + data.length * repeats);
		this.offset += data.length * repeats;
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
