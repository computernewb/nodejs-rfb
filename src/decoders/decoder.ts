import { SocketBuffer } from "../socketbuffer";
import { Color3, VncRectangle } from "../types";


export interface IRectDecoder {
	decode(rect: VncRectangle, fb: Buffer, bitsPerPixel: number, colorMap: Array<Color3>, screenW: number, screenH: number, socket: SocketBuffer, depth: number): Promise<void>;
}
