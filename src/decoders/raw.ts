import { SocketBuffer } from '../socketbuffer';
import { IRectDecoder } from './decoder';
import { getPixelBytePos } from './util';

import { RectangleWithData, Color3 } from '../types';

export class RawDecoder implements IRectDecoder {
	async decode(rect: RectangleWithData, fb: Buffer, bitsPerPixel: number, colorMap: Array<Color3>, screenW: number, screenH: number, socket: SocketBuffer, depth: number): Promise<void> {
		return new Promise(async (resolve, reject) => {
			rect.data = await socket.readNBytesOffset(rect.width * rect.height * (bitsPerPixel / 8));

			for (let h = 0; h < rect.height; h++) {
				for (let w = 0; w < rect.width; w++) {
					const fbBytePosOffset = getPixelBytePos(rect.x + w, rect.y + h, screenW, screenH);
					if (bitsPerPixel === 8) {
						const bytePosOffset = h * rect.width + w;
						const index = rect.data.readUInt8(bytePosOffset);
						const color = colorMap[index];
						// RGB
						// fb.writeUInt8(color?.r || 255, fbBytePosOffset);
						// fb.writeUInt8(color?.g || 255, fbBytePosOffset + 1);
						// fb.writeUInt8(color?.b || 255, fbBytePosOffset + 2);

						// BGR
						fb.writeUInt8(color?.r || 255, fbBytePosOffset + 2);
						fb.writeUInt8(color?.g || 255, fbBytePosOffset + 1);
						fb.writeUInt8(color?.b || 255, fbBytePosOffset);

						fb.writeUInt8(255, fbBytePosOffset + 3);
					} else if (bitsPerPixel === 24) {
						const bytePosOffset = (h * rect.width + w) * 3;
						fb.writeUInt8(rect.data.readUInt8(bytePosOffset), fbBytePosOffset);
						fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 1), fbBytePosOffset + 1);
						fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 2), fbBytePosOffset + 2);
						fb.writeUInt8(255, fbBytePosOffset + 3);
					} else if (bitsPerPixel === 32) {
						const bytePosOffset = (h * rect.width + w) * 4;
						// RGB
						// fb.writeUInt8(rect.data.readUInt8(bytePosOffset), fbBytePosOffset);
						// fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 1), fbBytePosOffset + 1);
						// fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 2), fbBytePosOffset + 2);

						// BGR
						fb.writeUInt8(rect.data.readUInt8(bytePosOffset), fbBytePosOffset + 2);
						fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 1), fbBytePosOffset + 1);
						fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 2), fbBytePosOffset);
						// fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 3), fbBytePosOffset + 3);
						fb.writeUInt8(255, fbBytePosOffset + 3);
					}
				}
			}
			resolve();
		});
	}
}
