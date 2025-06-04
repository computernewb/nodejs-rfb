export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type RectangleWithData = Rect & {
	encoding: number;
	data: Buffer | null; // ?
};

export type PixelFormat = {
	bitsPerPixel: number;
	depth: number;
	bigEndianFlag: number;
	trueColorFlag: number;
	redMax: number;
	greenMax: number;
	blueMax: number;
	redShift: number;
	blueShift: number;
	greenShift: number;
};

export type Cursor = Rect & {
	cursorPixels: Buffer | null;
	bitmask: Buffer | null;

	posX: number;
	posY: number;
};

export type Color3 = {
	r: number;
	g: number;
	b: number;
};

export type Color4 = Color3 & {
	a: number;
};
