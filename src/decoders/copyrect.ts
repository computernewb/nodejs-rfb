import { SocketBuffer } from "../socketbuffer";
import { IRectDecoder } from "./decoder";
import { getPixelBytePos } from "./util";

import { RectangleWithData, Color3 } from "../types";

export class CopyRectDecoder implements IRectDecoder {
	async decode(rect: RectangleWithData, fb: Buffer, bitsPerPixel: number, colorMap: Array<Color3>, screenW: number, screenH: number, socket: SocketBuffer, depth: number): Promise<void> {
		return new Promise(async (resolve, reject) => {
			await socket.waitBytes(4);
			rect.data = socket.readNBytesOffset(4);

			const x = rect.data.readUInt16BE();
			const y = rect.data.readUInt16BE(2);

			for (let h = 0; h < rect.height; h++) {
				for (let w = 0; w < rect.width; w++) {
					const fbOrigBytePosOffset = getPixelBytePos(x + w, y + h, screenW, screenH);
					const fbBytePosOffset = getPixelBytePos(rect.x + w, rect.y + h, screenW, screenH);

					fb.writeUInt8(fb.readUInt8(fbOrigBytePosOffset), fbBytePosOffset);
					fb.writeUInt8(fb.readUInt8(fbOrigBytePosOffset + 1), fbBytePosOffset + 1);
					fb.writeUInt8(fb.readUInt8(fbOrigBytePosOffset + 2), fbBytePosOffset + 2);
					fb.writeUInt8(fb.readUInt8(fbOrigBytePosOffset + 3), fbBytePosOffset + 3);
				}
			}

			resolve();
		});
	}
}
