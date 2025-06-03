import { SocketBuffer } from '../socketbuffer';
import * as net from 'node:net';

export interface ISecurityType {
	getName(): string;
	authenticate(rfbVer: string, socket: SocketBuffer, connection: net.Socket, auth: object): Promise<void>;
}
