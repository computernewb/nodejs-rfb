import { SocketBuffer } from '../socketbuffer';
import { IRectDecoder } from './decoder';
import { applyColor, getPixelBytePos } from './util';

import { RectangleWithData, Color3 } from '../types';

export class HextileDecoder implements IRectDecoder {
	async decode(rect: RectangleWithData, fb: Buffer, bitsPerPixel: number, colorMap: Array<Color3>, screenW: number, screenH: number, socket: SocketBuffer, depth: number): Promise<void> {
		return new Promise(async (resolve, reject) => {
			let dataSize = 0;

			let lastSubEncoding = 0;

			const backgroundColor = { r: 0, g: 0, b: 0, a: 255 };
			const foregroundColor = { r: 0, g: 0, b: 0, a: 255 };

			let tilesX = Math.ceil(rect.width / 16);
			let tilesY = Math.ceil(rect.height / 16);
			let tiles = tilesX * tilesY;
			let totalTiles = tiles;

			while (tiles) {
				const subEncoding = await socket.readUInt8();
				const currTile = totalTiles - tiles;

				// Calculate tile position and size
				const tileX = currTile % tilesX;
				const tileY = Math.floor(currTile / tilesX);
				const tx = rect.x + tileX * 16;
				const ty = rect.y + tileY * 16;
				const tw = Math.min(16, rect.x + rect.width - tx);
				const th = Math.min(16, rect.y + rect.height - ty);

				if (subEncoding === 0) {
					if (lastSubEncoding & 0x01) {
						// We need to ignore zeroed tile after a raw tile
					} else {
						// If zeroed tile and last tile was not raw, use the last backgroundColor
						applyColor(tw, th, tx, ty, screenW, screenH, backgroundColor, fb);
					}
				} else if (subEncoding & 0x01) {
					// If Raw, ignore all other bits
					dataSize += th * tw * (bitsPerPixel / 8);
					for (let h = 0; h < th; h++) {
						for (let w = 0; w < tw; w++) {
							const fbBytePosOffset = getPixelBytePos(tx + w, ty + h, screenW, screenH);
							if (bitsPerPixel === 8) {
								const index = await socket.readUInt8();
								const color = colorMap[index];
								// RGB
								// fb.writeUInt8(color?.r || 255, fbBytePosOffset);
								// fb.writeUInt8(color?.g || 255, fbBytePosOffset + 1);
								// fb.writeUInt8(color?.b || 255, fbBytePosOffset + 2);

								// BGR
								fb.writeUInt8(color?.r || 255, fbBytePosOffset + 2);
								fb.writeUInt8(color?.g || 255, fbBytePosOffset + 1);
								fb.writeUInt8(color?.b || 255, fbBytePosOffset);
							} else if (bitsPerPixel === 24) {
								fb.writeUInt8(await socket.readUInt8(), fbBytePosOffset);
								fb.writeUInt8(await socket.readUInt8(), fbBytePosOffset + 1);
								fb.writeUInt8(await socket.readUInt8(), fbBytePosOffset + 2);
							} else if (bitsPerPixel === 32) {
								// RGB
								// fb.writeUInt8(rect.data.readUInt8(bytePosOffset), fbBytePosOffset);
								// fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 1), fbBytePosOffset + 1);
								// fb.writeUInt8(rect.data.readUInt8(bytePosOffset + 2), fbBytePosOffset + 2);

								// BGR
								fb.writeUInt8(await socket.readUInt8(), fbBytePosOffset + 2);
								fb.writeUInt8(await socket.readUInt8(), fbBytePosOffset + 1);
								fb.writeUInt8(await socket.readUInt8(), fbBytePosOffset);
								socket.readUInt8();
							}
							// Alpha, always 255
							fb.writeUInt8(255, fbBytePosOffset + 3);
						}
					}
					lastSubEncoding = subEncoding;
				} else {
					// Background bit
					if (subEncoding & 0x02) {
						switch (bitsPerPixel) {
							case 8:
								const index = await socket.readUInt8();
								dataSize++;
								backgroundColor.r = colorMap[index].r || 255;
								backgroundColor.g = colorMap[index].g || 255;
								backgroundColor.b = colorMap[index].b || 255;
								break;

							case 24:
								dataSize += 3;
								backgroundColor.r = await socket.readUInt8();
								backgroundColor.g = await socket.readUInt8();
								backgroundColor.b = await socket.readUInt8();
								break;

							case 32:
								dataSize += 4;
								backgroundColor.r = await socket.readUInt8();
								backgroundColor.g = await socket.readUInt8();
								backgroundColor.b = await socket.readUInt8();
								backgroundColor.a = await socket.readUInt8();
								break;
						}
					}

					// Foreground bit
					if (subEncoding & 0x04) {
						switch (bitsPerPixel) {
							case 8:
								const index = await socket.readUInt8();
								dataSize++;
								foregroundColor.r = colorMap[index].r || 255;
								foregroundColor.g = colorMap[index].g || 255;
								foregroundColor.b = colorMap[index].b || 255;
								break;

							case 24:
								dataSize += 3;
								foregroundColor.r = await socket.readUInt8();
								foregroundColor.g = await socket.readUInt8();
								foregroundColor.b = await socket.readUInt8();
								break;

							case 32:
								dataSize += 4;
								foregroundColor.r = await socket.readUInt8();
								foregroundColor.g = await socket.readUInt8();
								foregroundColor.b = await socket.readUInt8();
								foregroundColor.a = await socket.readUInt8();
								break;
						}
					}

					// Initialize tile with the background color
					applyColor(tw, th, tx, ty, screenW, screenH, backgroundColor, fb);

					// AnySubrects bit
					if (subEncoding & 0x08) {
						let subRects = await socket.readUInt8();

						if (subRects) {
							while (subRects) {
								subRects--;
								const color = { r: 0, g: 0, b: 0, a: 255 };

								// SubrectsColoured
								if (subEncoding & 0x10) {
									switch (bitsPerPixel) {
										case 8:
											const index = await socket.readUInt8();
											dataSize++;
											color.r = colorMap[index].r || 255;
											color.g = colorMap[index].g || 255;
											color.b = colorMap[index].b || 255;
											break;

										case 24:
											dataSize += 3;
											color.r = await socket.readUInt8();
											color.g = await socket.readUInt8();
											color.b = await socket.readUInt8();
											break;

										case 32:
											dataSize += 4;
											color.r = await socket.readUInt8();
											color.g = await socket.readUInt8();
											color.b = await socket.readUInt8();
											color.a = await socket.readUInt8();
											break;
									}
								} else {
									color.r = foregroundColor.r;
									color.g = foregroundColor.g;
									color.b = foregroundColor.b;
									color.a = foregroundColor.a;
								}

								const xy = await socket.readUInt8();
								const wh = await socket.readUInt8();
								dataSize += 2;

								const sx = xy >> 4;
								const sy = xy & 0x0f;
								const sw = (wh >> 4) + 1;
								const sh = (wh & 0x0f) + 1;

								applyColor(sw, sh, tx + sx, ty + sy, screenW, screenH, color, fb);
							}
						} else {
							applyColor(tw, th, tx, ty, screenW, screenH, backgroundColor, fb);
						}
					} else {
						applyColor(tw, th, tx, ty, screenW, screenH, backgroundColor, fb);
					}

					lastSubEncoding = subEncoding;
				}

				tiles--;
			}
			resolve();
		});
	}
}
