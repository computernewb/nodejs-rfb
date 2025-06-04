import { SocketBuffer } from '../socketbuffer';
import { Color3, RectangleWithData } from '../types';

export interface IRectDecoder {
	decode(rect: RectangleWithData, fb: Buffer, bitsPerPixel: number, colorMap: Array<Color3>, screenW: number, screenH: number, socket: SocketBuffer, depth: number): Promise<void>;
}
