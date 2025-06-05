# nodejs-rfb
Pure node.js implementation of RFC 6143 (RFB Protocol / VNC) client with no external dependencies. Supports Raw, CopyRect, Hextile and ZRLE encodings.

Fork by Computernewb of Filipe Calaça's original [vnc-rfb-client](https://github.com/ayunami2000/vnc-rfb-client) project mainly for use with the CollabVM project.

## Credits

### Filipe Calaça 
- Original library
### ayunami2000
- QEMU Audio (PCM)
- QEMU Relative Pointer
### dithercat
- Pseudo-cursor support
- General codebase improvements
### Modeco80
- Ported to TypeScript
- Large amounts of refactoring and improvements
### ElijahR2411
- Security/Authentication refactor

## Installation
```sh
yarn add @computernewb/nodejs-rfb # Yarn
npm install @computernewb/nodejs-rfb # NPM
```

## Usage

```ts
import { VncClient } from '@computernewb/nodejs-rfb';

const initOptions = {
    debug: false, // Set debug logging
    encodings: [ // Encodings sent to server, in order of preference
        VncClient.consts.encodings.copyRect,
        VncClient.consts.encodings.zrle,
        VncClient.consts.encodings.hextile,
        VncClient.consts.encodings.raw,
        VncClient.consts.encodings.pseudoDesktopSize,
    ]
};

const client = new VncClient(initOptions);

const connectionOptions = {
    host: '', // VNC Server
    path: null, // UNIX domain socket
    auth: {
      password: '' // Password
    },
    set8BitColor: false, // If set to true, client will request 8 bit color, only supported with Raw encoding
    port: 5900 // Remote server port
}
client.connect(connectionOptions);

// Client successfully connected
client.on('connected', () => {
    console.log('Client connected.');
});

// Connection timed out
client.on('connectTimeout', () => {
    console.log('Connection timeout.');
});

// Client successfully authenticated
client.on('authenticated', () => {
    console.log('Client authenticated.');
});

// Authentication error
client.on('authError', () => {
    console.log('Client authentication error.');
});

// Bell received from server
client.on('bell', () => {
    console.log('Bell received');
});

// Client disconnected
client.on('disconnect', () => {
    console.log('Client disconnected.');
    process.exit();
});

// Clipboard event on server
client.on('cutText', (text) => {
    console.log('clipboard text received: ' + text);
});

// Frame buffer updated
client.on('firstFrameUpdate', (fb) => {
   console.log('First Framebuffer update received.');
});

// Frame buffer updated
client.on('frameUpdated', (fb) => {
    console.log('Framebuffer updated.');
});

// Color map updated (8 bit color only)
client.on('colorMapUpdated', (colorMap) => {
    console.log('Color map updated. Colors: ' + colorMap.length);
});

// Rect processed
client.on('rectProcessed', (rect) => {
    console.log('rect processed');
});

```

## Examples

### Save frame to jpg

```javascript
import { VncClient } from '@computernewb/nodejs-rfb';
import { Jimp } from 'jimp';

const client = new VncClient();

// Just 1 update per second
client.changeFps(1);
client.connect({host: '127.0.0.1', port: 5900, path: null, password: 'abc123'});

client.on('frameUpdated', (data) => {
   new Jimp({width: client.clientWidth, height: client.clientHeight, data}, (err, image) => {
      if (err) {
         console.log(err);
      }
      const fileName = `${Date.now()}.jpg`;
      console.log(`Saving frame to file. ${fileName}`);
      image.write(`${fileName}`);
   });
});

client.on('connectError', (err) => {
   console.log(err);
});

client.on('authError', () => {
   console.log('Authentication failed.');
});
```

### Record session with FFMPEG

```javascript
import { VncClient } from '@computernewb/nodejs-rfb';
import { spawn } from 'child_process';
const fps = 10;

let timerRef;
const client = new VncClient({fps});
let out;

client.connect({host: '127.0.0.1', port: 5900, path: null, password: 'abc123'});

client.on('firstFrameUpdate', () => {
   console.log('Start recording...');
   out = spawn('./ffmpeg.exe',
           `-loglevel error -hide_banner -y -f rawvideo -vcodec rawvideo -an -pix_fmt rgba -s ${client.clientWidth}x${client.clientHeight} -r ${fps} -i - -an -r ${fps} -vcodec libx264rgb session.h264`.split(' '));
   timer();
});

process.on('SIGINT', function () {
   console.log("Exiting.");
   close();
});

function timer() {
   timerRef = setTimeout(() => {
      timer();
      out?.stdin?.write(client.fb);
   }, 1000 / fps);
}

function close() {
   if (timerRef) {
      clearTimeout(timerRef);
   }
   if (out) {
      out.kill('SIGINT');
      out.on('exit', () => {
         process.exit(0);
      });
   }
}

client.on('disconnect', () => {
   console.log('Client disconnected.');
   close();
});

```

## Methods

```javascript
/**
 * Request a frame update to the server
 */
client.requestFrameUpdate(full, increment, x, y, width, height);

/**
 * Change the rate limit of frame buffer requests
 * If set to 0, a new update request will be sent as soon as the last update finish processing
 */
client.changeFps(10);

/**
 * Start the connection with the server
 */
const connectionOptions = {
    host: '', // VNC Server
    path: null, // UNIX domain socket
    auth: {
      password: '' // Password
    }
    set8BitColor: false, // If set to true, client will request 8 bit color, only supported with Raw encoding
    port: 5900 // Remote server port
}
client.connect(connectionOptions);

/**
 * Send a key board event
 * Check https://wiki.linuxquestions.org/wiki/List_of_keysyms for keycodes
 * down = true for keydown and down = false for keyup
 */
client.sendKeyEvent(keysym, down);

/**
 * Send pointer event (mouse or touch)
 * xPosition - X Position of the pointer
 * yPosition - Y Position of the pointer
 * button1 to button 8 - True for down, false for up
 */
client.sendPointerEvent(xPosition, yPosition, button1, button2, button3, button4, button5, button6, button7, button8);

/**
 * Send clipboard event to server
 * text - Text copied to clipboard
 */
client.clientCutText(text);

client.resetState(); // Reset the state of the client, clear the frame buffer and purge all data
```

## License

Distributed under the MIT License. See `LICENSE` for more information.