import { Duplex } from 'node:stream';
import { SocketBuffer } from '../socketbuffer';

export interface ISecurityType {
	getName(): string;
	authenticate(rfbVer: string, socket: SocketBuffer, connection: Duplex, auth: object): Promise<void>;
}
