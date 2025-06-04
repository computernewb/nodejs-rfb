import { Socket } from 'net';
import { SocketBuffer } from '../socketbuffer';
import { ISecurityType } from './securitytype';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
// @ts-ignore
import MD4 from 'js-md4';

const NTLM_SIGNATURE = 'NTLMSSP\0';
const NTLM_NEGOTIATE_FLAGS = 2718478855;

enum NtLmMessageType {
	NtLmNegotiate = 1,
	NtLmChallenge = 2,
	NtLmAuthenticate = 3
}

type NtLmChallenge = {
	realm: string;
	negotiateFlags: number;
	serverChallenge: Buffer;
	targetInfo: Buffer;
};

export type NtlmAuthInfo = {
	username: string;
	password: string;
	domain: string;
	workstation: string;
	vm: string;
};

export class NtlmSecurityType implements ISecurityType {
	getName(): string {
		return 'Windows NTLM';
	}

	async authenticate(rfbVer: string, socket: SocketBuffer, connection: Socket, auth: NtlmAuthInfo): Promise<void> {
		if (!auth.username || !auth.password) {
			throw new Error('No username or password supplied for NTLM authentication.');
		}

		if (!auth.domain) {
			auth.domain = 'WORKGROUP';
		}

		if (!auth.workstation) {
			auth.workstation = 'NODEJSRFB';
		}

		// Send NTLM negotiate
		this.sendNtlmNegotiate(connection, auth.workstation, auth.domain);
		// Read NTLM challenge
		let chal = await this.readNtlmChallenge(socket);
		// add fields to target info
		chal.targetInfo = this.completeTargetInfo(chal.targetInfo, auth);
		// Get response key
		let responseKey = this.NTOWFv2(auth.domain, auth.username, auth.password);
		// Get challenge response
		let challengeResponse = this.computeChallengeResponse(responseKey, chal);
		// Send authenticate
		await this.sendNtlmAuthenticate(connection, chal, challengeResponse, auth);
		// Get result
		let result = await socket.readUInt32BE();
		if (result !== 0) {
			throw new Error('NTLM Authentication Failed.');
		}
	}

	private writeNtlmMsgHeader(buf: Buffer, len: number, type: NtLmMessageType) {
		buf.writeUint32BE(len, 0);
		// signature
		buf.write(NTLM_SIGNATURE, 4, 'ascii');
		// type
		buf.writeUInt32LE(type, 12);
	}

	private writeVersion(buf: Buffer, offset: number) {
		// windows major
		buf.writeUint8(5, offset);
		// windows minor
		buf.writeUint8(1, offset + 1);
		// product build
		buf.writeUint16LE(2600, offset + 2);
		// ntlm revision
		buf.writeUint8(15, offset + 7);
	}

	private sendNtlmNegotiate(connection: Socket, workstation: string, domain: string) {
		let len = 40 + workstation.length + domain.length;
		let buf = Buffer.alloc(len + 4);
		// header
		this.writeNtlmMsgHeader(buf, len, NtLmMessageType.NtLmNegotiate);
		// negotiate flags
		buf.writeUint32LE(NTLM_NEGOTIATE_FLAGS, 16);
		// domain name length
		buf.writeUint16LE(domain.length, 20);
		buf.writeUint16LE(domain.length, 22);
		// domain name offset
		buf.writeUint32LE(40 + workstation.length, 24);
		// workstation name length
		buf.writeUint16LE(workstation.length, 28);
		buf.writeUint16LE(workstation.length, 30);
		// workstation name offset
		buf.writeUint32LE(40, 32);
		// version
		this.writeVersion(buf, 36);
		// workstation name
		buf.write(workstation, 44, 'ascii');
		// domain name
		buf.write(domain, 44 + workstation.length, 'ascii');

		connection.write(buf);
	}

	private async readNtlmChallenge(socket: SocketBuffer): Promise<NtLmChallenge> {
		// Read NTLM challenge len
		let challengeLen = await socket.readUInt32BE();
		// Read NTLM challenge
		let challengeBuf = await socket.readNBytesOffset(challengeLen);
		// Verify signature
		if (challengeBuf.toString('ascii', 0, 8) !== NTLM_SIGNATURE) {
			throw new Error('Invalid NTLM signature from server');
		}
		// Verify message type
		let typ = challengeBuf.readUint32LE(8);
		if (typ !== NtLmMessageType.NtLmChallenge) {
			throw new Error(`Invalid NTLM message type ${typ} (expected NTLM_CHALLENGE)`);
		}
		// Realm
		let realmLen = challengeBuf.readUint16LE(12);
		let realmOffset = challengeBuf.readUint32LE(16);
		let realm = challengeBuf.toString('utf16le', realmOffset, realmOffset + realmLen);
		// Negotiate flags
		let negotiateFlags = challengeBuf.readUint32LE(20);
		// Server challenge
		let serverChallenge = challengeBuf.subarray(24, 32);
		// Target info
		let targetInfoLen = challengeBuf.readUint16LE(40);
		let targetInfoOffset = challengeBuf.readUint32LE(44);
		let targetInfo = challengeBuf.subarray(targetInfoOffset, targetInfoOffset + targetInfoLen);
		return {
			realm,
			negotiateFlags,
			serverChallenge,
			targetInfo
		};
	}

	private getNtTimestamp(date: Date): bigint {
		return (BigInt(date.getTime()) + 11644473600000n) * 10000n;
	}

	private completeTargetInfo(targetInfo: Buffer, auth: NtlmAuthInfo): Buffer {
		// target name
		let targetName = `${auth.domain}\\${auth.username}`;
		// Find current EOL
		let offset = targetInfo.length - 4;
		// Allocate new buffer

		let newBuf = Buffer.alloc(targetInfo.length + 76 + targetName.length * 2);
		targetInfo.copy(newBuf, 0, 0, targetInfo.length);
		// Single host
		newBuf.writeUint16LE(8, offset);
		newBuf.writeUint16LE(48, offset + 2);
		newBuf.writeUint32LE(48, offset + 4);
		newBuf.writeUint32LE(1, offset + 12);
		newBuf.writeUint32LE(8192, offset + 16);
		crypto.randomFillSync(newBuf, offset + 20, 32);
		// Channel bindings
		newBuf.writeUint16LE(10, offset + 52);
		newBuf.writeUint16LE(16, offset + 54);
		// Target name
		newBuf.writeUint16LE(9, offset + 72);
		newBuf.writeUint16LE(targetName.length * 2, offset + 74);
		newBuf.write(targetName, offset + 76, 'utf16le');

		return newBuf;
	}

	private NTOWFv2(domain: string, username: string, password: string): Buffer {
		// hash key
		let md4 = MD4.create();
		md4.update(Buffer.from(password, 'utf16le'));
		let key = md4.arrayBuffer();
		// create hmac
		let hmac = crypto.createHmac('md5', key);
		hmac.update(username.toUpperCase() + domain, 'utf16le');
		let responseKey = hmac.digest();
		hmac.destroy();
		return responseKey;
	}

	private computeChallengeResponse(responseKey: Buffer, ntlmChallenge: NtLmChallenge): Buffer {
		var clientChallenge = crypto.randomBytes(8);

		let headr = Buffer.alloc(32 + ntlmChallenge.targetInfo.length);
		// version
		headr.writeUint8(1, 0);
		headr.writeUint8(1, 1);
		// time
		let nttime = this.getNtTimestamp(new Date());
		headr.writeBigUint64LE(nttime, 8);
		// client challenge
		clientChallenge.copy(headr, 16, 0, 8);
		// target info
		ntlmChallenge.targetInfo.copy(headr, 28, 0, ntlmChallenge.targetInfo.length);

		let hmac = crypto.createHmac('md5', responseKey);
		hmac.update(Buffer.concat([ntlmChallenge.serverChallenge, headr]));
		let ntProofStr = hmac.digest();
		hmac.destroy();

		let ntChallengeResponse = Buffer.concat([ntProofStr, headr]);

		return ntChallengeResponse;
	}

	private async sendNtlmAuthenticate(connection: Socket, challenge: NtLmChallenge, ntChallengeResponse: Buffer, auth: NtlmAuthInfo) {
		let workstationLengthW = auth.workstation.length * 2;
		let usernameLengthW = auth.username.length * 2;
		let domainLengthW = auth.domain.length * 2;

		let len = 112 + ntChallengeResponse.length + domainLengthW + usernameLengthW + workstationLengthW;
		let buf = Buffer.alloc(len + 4);

		// header
		this.writeNtlmMsgHeader(buf, len, NtLmMessageType.NtLmAuthenticate);
		// LM challenge response length
		buf.writeUint16LE(24, 16);
		buf.writeUint16LE(24, 18);
		// LM challenge offset
		buf.writeUint32LE(88 + domainLengthW + usernameLengthW + workstationLengthW, 20);
		// NT challenge length
		buf.writeUint16LE(ntChallengeResponse.length, 24);
		buf.writeUint16LE(ntChallengeResponse.length, 26);
		// NT challenge offset
		buf.writeUint32LE(112 + domainLengthW + usernameLengthW + workstationLengthW, 28);
		// Domain length
		buf.writeUint16LE(domainLengthW, 32);
		buf.writeUint16LE(domainLengthW, 34);
		// Domain offset
		buf.writeUint32LE(88, 36);
		// Username length
		buf.writeUint16LE(usernameLengthW, 40);
		buf.writeUint16LE(usernameLengthW, 42);
		// Username offset
		buf.writeUint32LE(88 + domainLengthW, 44);
		// Workstation length
		buf.writeUint16LE(workstationLengthW, 48);
		buf.writeUint16LE(workstationLengthW, 50);
		// Workstation offset
		buf.writeUint32LE(88 + domainLengthW + usernameLengthW, 52);
		// Encrypted session key (empty)
		buf.writeUint32LE(len, 60);
		// NegotiateFlags
		buf.writeUint32LE(challenge.negotiateFlags, 64);
		// Version
		this.writeVersion(buf, 68);
		// Domain
		buf.write(auth.domain, 92, 'utf16le');
		// Username
		buf.write(auth.username, 92 + domainLengthW, 'utf16le');
		// Workstation
		buf.write(auth.workstation, 92 + domainLengthW + usernameLengthW, 'utf16le');
		// NT challenge
		ntChallengeResponse.copy(buf, 116 + domainLengthW + usernameLengthW + workstationLengthW, 0, ntChallengeResponse.length);

		connection.write(buf);
	}
}
