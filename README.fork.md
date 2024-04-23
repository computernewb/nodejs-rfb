# Notice

This fork contains a few very drastic changes:

- converted to (strict) TypeScript
	- Also, actually use interfaces, and reduce the amount of code duplicated significantly in the rect decoders.
- use parcel for bundling (TODO actually deal with publishing etc)
- all modules rewritten to be ES modules (and parcel exports esm output) 
- some noisy debug prints removed
- (some, very tiny) code cleanup
