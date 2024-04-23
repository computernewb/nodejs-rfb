/// this is a pretty poor name.
export class SocketBuffer {
	public buffer: Buffer;
	public offset: number; // :(

	constructor() {
		this.buffer = Buffer.from([]);
		this.offset = 0;
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

	includes(check: Buffer|number|string) {
		return this.buffer.includes(check);
	}

	pushData(data: Buffer) {
		this.buffer = Buffer.concat([this.buffer, data]);
	}

	readInt32BE() {
		const data = this.buffer.readInt32BE(this.offset);
		this.offset += 4;
		return data;
	}

	readInt32LE() {
		const data = this.buffer.readInt32LE(this.offset);
		this.offset += 4;
		return data;
	}

	readUInt32BE() {
		const data = this.buffer.readUInt32BE(this.offset);
		this.offset += 4;
		return data;
	}

	readUInt32LE() {
		const data = this.buffer.readUInt32LE(this.offset);
		this.offset += 4;
		return data;
	}

	readUInt16BE() {
		const data = this.buffer.readUInt16BE(this.offset);
		this.offset += 2;
		return data;
	}

	readUInt16LE() {
		const data = this.buffer.readUInt16LE(this.offset);
		this.offset += 2;
		return data;
	}

	readUInt8() {
		const data = this.buffer.readUInt8(this.offset);
		this.offset += 1;
		return data;
	}

	readInt8() {
		const data = this.buffer.readInt8(this.offset);
		this.offset += 1;
		return data;
	}

	readNBytes(bytes: number, offset = this.offset) {
		return this.buffer.slice(offset, offset + bytes);
	}

	readNBytesOffset(bytes: number) {
		const data = this.buffer.slice(this.offset, this.offset + bytes);
		this.offset += bytes;
		return data;
	}

	setOffset(n: number) {
		this.offset = n;
	}

	bytesLeft() {
		return this.buffer.length - this.offset;
	}

	// name is nullable because there are Many(yay....) times it just isn't passed
	async waitBytes(bytes: number, name: any | null = null): Promise<void> {
		if (this.bytesLeft() >= bytes) {
			return;
		}
		let counter = 0;
		return new Promise(async (resolve, reject) => {
			while (this.bytesLeft() < bytes) {
				counter++;
				// console.log('Esperando. BytesLeft: ' + this.bytesLeft() + '  Desejados: ' + bytes);
				await this.sleep(4);
				if (counter === 50) {
					console.log('Stucked on ' + name + '  -  Buffer Size: ' + this.buffer.length + '   BytesLeft: ' + this.bytesLeft() + '   BytesNeeded: ' + bytes);
				}
			}
			resolve();
		});
	}

	fill(data: Buffer) {
		this.buffer.fill(data, this.offset, this.offset + data.length);
		this.offset += data.length;
	}

	fillMultiple(data: Buffer, repeats: number) {
		this.buffer.fill(data, this.offset, this.offset + data.length * repeats);
		this.offset += data.length * repeats;
	}

	sleep(n: number): Promise<void> {
		return new Promise((resolve, reject) => {
			setTimeout(resolve, n);
		});
	}
}
