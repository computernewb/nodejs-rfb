
import { Color3 } from "../types";

export function	getPixelBytePos(x: number, y: number, width: number, height: number, stride: number = 4): number {
	return (y * width + x) * stride;
}

// Apply color to a rect on buffer
export function applyColor(tw: number, th: number, tx: number, ty: number, screenW: number, screenH: number, color: Color3, fb: Buffer) {
	for (let h = 0; h < th; h++) {
		for (let w = 0; w < tw; w++) {
			const fbBytePosOffset = getPixelBytePos(tx + w, ty + h, screenW, screenH);
			fb.writeUInt8(color.r || 255, fbBytePosOffset + 2);
			fb.writeUInt8(color.g || 255, fbBytePosOffset + 1);
			fb.writeUInt8(color.b || 255, fbBytePosOffset);
			fb.writeUInt8(255, fbBytePosOffset + 3);
		}
	}
}
