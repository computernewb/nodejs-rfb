import { SocketBuffer } from '../socketbuffer';
import { ISecurityType } from './securitytype';
import * as net from 'node:net';
// @ts-ignore
import { DES } from 'des.js';

export type VncAuthInfo = {
	password: string;
};

export class VncSecurityType implements ISecurityType {
	getName(): string {
		return 'VNC DES Authentication';
	}

	/**
	 * Reverse bits order of a byte
	 * @param buf - Buffer to be flipped
	 */
	reverseBits(buf: Buffer) {
		for (let x = 0; x < buf.length; x++) {
			let newByte = 0;
			newByte += buf[x] & 128 ? 1 : 0;
			newByte += buf[x] & 64 ? 2 : 0;
			newByte += buf[x] & 32 ? 4 : 0;
			newByte += buf[x] & 16 ? 8 : 0;
			newByte += buf[x] & 8 ? 16 : 0;
			newByte += buf[x] & 4 ? 32 : 0;
			newByte += buf[x] & 2 ? 64 : 0;
			newByte += buf[x] & 1 ? 128 : 0;
			buf[x] = newByte;
		}
	}

	async authenticate(rfbVer: string, socket: SocketBuffer, connection: net.Socket, auth: VncAuthInfo): Promise<void> {
		if (!auth.password) {
			throw new Error('No password supplied for VNC authentication.');
		}

		const key = Buffer.alloc(8);
		key.fill(0);
		key.write(auth.password.slice(0, 8));

		this.reverseBits(key);

		const des = new DES({
			type: 'encrypt',
			key
		});

		const response = Buffer.alloc(16);

		response.fill(new Uint8Array(des.update(await socket.readNBytesOffset(8))), 0, 8);
		response.fill(new Uint8Array(des.update(await socket.readNBytesOffset(8))), 8, 16);

		connection.write(response);
	}
}
