import * as vscode from 'vscode';
import * as fs from 'fs';
import { RTTConsoleDecoderOpts, TerminalInputMode, TextEncoding, BinaryEncoding, HrTimer } from '../common';
import { IPtyTerminalOptions, magentaWrite, PtyTerminal } from './pty';
import { decoders as DECODER_MAP } from './swo/decoders/utils';
import { SocketRTTSource } from './swo/sources/socket';
import { RESET } from './ansi-helpers';

export class RTTTerminal {
    protected ptyTerm: PtyTerminal;
    protected ptyOptions: IPtyTerminalOptions;
    protected binaryFormatter: BinaryFormatter;
    private source: SocketRTTSource;
    private firstHeaderWrite = true;
    public inUse = true;
    protected logFd: number;
    protected hrTimer: HrTimer = new HrTimer();
    public get terminal(): vscode.Terminal {
        return this.ptyTerm ? this.ptyTerm.terminal : null;
    }

    constructor(
        protected context: vscode.ExtensionContext,
        public options: RTTConsoleDecoderOpts,
        src: SocketRTTSource) {
        this.ptyOptions = this.createTermOptions(null);
        this.createTerminal();
        this.sanitizeEncodings(this.options);
        this.connectToSource(src);
        this.openLogFile();
    }

    private connectToSource(src: SocketRTTSource) {
        this.hrTimer = new HrTimer();
        this.binaryFormatter = new BinaryFormatter(this.ptyTerm, this.options.encoding, this.options.scale);
        src.once('disconnected', () => { this.onClose(); });
        src.on('error', (e) => {
            const code: string = (e as any).code;
            if (code === 'ECONNRESET') {
                // Server closed the connection. We are done with this session
            } else if (code === 'ECONNREFUSED') {
                // We expect 'ECONNREFUSED' if the server has not yet started after all the retries
                magentaWrite(`${e}\n.`, this.ptyTerm);
            } else {
                magentaWrite(`${e}\n`, this.ptyTerm);
            }
        });
        src.on('data', (data) => { this.onData(data); });

        if (src.connError) {
            this.source = src;
            magentaWrite(`${src.connError.message}\n`, this.ptyTerm);
        } else if (src.connected) {
            this.source = src;
        } else {
            src.once('connected', () => {
                this.source = src;
            });
        }
    }

    private onClose() {
        this.source = null;
        this.inUse = false;
        if (!this.options.noclear && (this.logFd >= 0)) {
            try { fs.closeSync(this.logFd); } catch { }
        }
        this.logFd = -1;
        this.ptyTerm.write(RESET + '\n');
        magentaWrite(`RTT connection on TCP port ${this.options.tcpPort} ended. Waiting for next connection...`, this.ptyTerm);
    }

    /**
     * Write buffer data to the log file.
     * It does nothing if the file descriptor is not valid.
     * @param data - The data to write.
     */
    private writeLogFile(data: Buffer) {
        if (this.logFd >= 0) {
            fs.writeSync(this.logFd, data);
        }
    }

    /**
     * Write buffer data to the log file appending a header data before
     * it (normally used for adding a timestamp info).
     * Notes:
     * - It does nothing if the file descriptor is not valid.
     * - At first time execution, it writes the header data to ensure
     *   first data line written in file has the header.
     * - For the sake of speed, location of end-of-line characters is
     *   done by loop on each buffer byte. Also, the write to the file
     *   system is done just one time after all bytes prepared in RAM,
     *   this is why a list of Buffers is used to push each byte and
     *   concatenate it into a new buffer that is going to be written.
     * @param data - The data to write.
     */
    private writeLogFileWithHeader(data: Buffer, header: Buffer) {
        let toWriteList = [];
        if (this.logFd < 0) {
            return;
        }
        if (this.firstHeaderWrite) {
            toWriteList.push(header);
            this.firstHeaderWrite = false;
        }
        for (let i = 0; i < data.length; i++) {
            const chr = data[i];
            // Ignore if not ASCII printable
            // Allow Tabulation (9 == \t) and Line Feed (10 == \n)
            if ( (chr < 32) || (chr > 126) ) {
                if ( (chr != 9) && (chr != 10) ) {
                    continue;
                }
            }
            toWriteList.push(data.slice(i, i+1));
            if (chr == 10) {
                toWriteList.push(header);
            }
        }
        if (toWriteList.length > 0) {
            this.writeLogFile(Buffer.concat(toWriteList));
        }
    }

    private onData(data: Buffer) {
        try {
            if (this.options.type === 'binary') {
                this.writeLogFile(data);
                this.binaryFormatter.writeBinary(data);
            } else {
                if (this.options.timestamp) {
                    let time = this.hrTimer.createDateTimestamp() + ' ';
                    let timeBuf = Buffer.from(time, 'utf-8')
                    this.writeLogFileWithHeader(data, timeBuf);
                }
                else {
                    this.writeLogFile(data);
                }
                this.writeNonBinary(data);
            }
        }
        catch (e) {
            magentaWrite(`Error writing data: ${e}\n`, this.ptyTerm);
        }
    }

    private openLogFile() {
        this.logFd = -1;
        if (this.options.logfile) {
            try {
                this.logFd = fs.openSync(this.options.logfile, 'w');
            }
            catch (e) {
                const msg = `Could not open file ${this.options.logfile} for writing. ${e.toString()}`;
                console.error(msg);
                magentaWrite(msg, this.ptyTerm);
            }
        }
    }

    private writeNonBinary(buf: Buffer) {
        let start = 0;
        let time = '';
        if (this.options.timestamp) {
            time = this.hrTimer.createDateTimestamp() + ' ';
        }
        for (let ix = 1; ix < buf.length; ix++ ) {
            if (buf[ix - 1] !== 0xff) { continue; }
            const chr = buf[ix];
            if (((chr >= 48) && (chr <= 57)) || ((chr >= 65) && (chr <= 90))) {
                if (ix >= 1) {
                    this.ptyTerm.writeWithHeader(buf.slice(start, ix - 1), time);
                }
                this.ptyTerm.write(`<switch to vTerm#${String.fromCharCode(chr)}>\n`);
                buf = buf.slice(ix + 1);
                ix = 0;
                start = 0;
            }
        }
        if (buf.length > 0) {
            this.ptyTerm.writeWithHeader(buf, time);
        }
    }

    protected createTermOptions(existing: string | null): IPtyTerminalOptions {
        const ret: IPtyTerminalOptions = {
            name: RTTTerminal.createTermName(this.options, existing),
            prompt: this.createPrompt(),
            inputMode: this.options.inputmode || TerminalInputMode.COOKED
        };
        return ret;
    }

    protected createTerminal() {
        this.ptyTerm = new PtyTerminal(this.createTermOptions(null));
        this.ptyTerm.on('data', this.sendData.bind(this));
        this.ptyTerm.on('close', this.terminalClosed.bind(this));
    }

    protected createPrompt(): string {
        return this.options.noprompt ? '' : this.options.prompt || `RTT:${this.options.port}> `;
    }

    protected static createTermName(options: RTTConsoleDecoderOpts, existing: string | null): string {
        const suffix = options.type === 'binary' ? `enc:${getBinaryEncoding(options.encoding)}` : options.type;
        const orig = options.label || `RTT Ch:${options.port} ${suffix}`;
        let ret = orig;
        let count = 1;
        while (vscode.window.terminals.findIndex((t) => t.name === ret) >= 0) {
            if (existing === ret) {
                return existing;
            }
            ret = `${orig}-${count}`;
            count++;
        }
        return ret;
    }

    protected terminalClosed() {
        this.dispose();
    }

    public sendData(str: string | Buffer) {
        if (this.source) {
            try {
                if (((typeof str === 'string') || (str instanceof String)) &&
                    (this.options.inputmode === TerminalInputMode.COOKED)) {
                    str = Buffer.from(str as string, this.options.iencoding);
                }
                this.source.write(str);
            }
            catch (e) {
                console.error(`RTTTerminal:sendData failed ${e}`);
            }
        }
    }

    private sanitizeEncodings(obj: RTTConsoleDecoderOpts) {
        obj.encoding = getBinaryEncoding(obj.encoding);
        obj.iencoding = getTextEncoding(obj.iencoding);
    }

    // If all goes well, this will reset the terminal options. Label for the VSCode terminal has to match
    // since there no way to rename it. If successful, tt will reset the Terminal options and mark it as
    // used (inUse = true) as well
    public tryReuse(options: RTTConsoleDecoderOpts, src: SocketRTTSource): boolean {
        if (!this.ptyTerm || !this.ptyTerm.terminal) { return false; }
        this.sanitizeEncodings(this.options);
        const newTermName = RTTTerminal.createTermName(options, this.ptyOptions.name);
        if (newTermName === this.ptyOptions.name) {
            this.inUse = true;
            if (!this.options.noclear || (this.options.type !== options.type)) {
                this.ptyTerm.clearTerminalBuffer();
                try {
                    if (this.logFd >= 0) {
                        fs.closeSync(this.logFd);
                        this.logFd = -1;
                    }
                    this.openLogFile();
                }
                catch (e) {
                    magentaWrite(`Error: closing fille ${e}\n`, this.ptyTerm);
                }
            }
            this.options = options;
            this.ptyOptions = this.createTermOptions(newTermName);
            this.ptyTerm.resetOptions(this.ptyOptions);
            this.connectToSource(src);
            return true;
        }
        return false;
    }

    public dispose() {
        this.ptyTerm.dispose();
        if (this.logFd >= 0) {
            try { fs.closeSync(this.logFd); } catch {}
            this.logFd = -1;
        }
    }
}

function parseEncoded(buffer: Buffer, encoding: string) {
    return DECODER_MAP[encoding] ? DECODER_MAP[encoding](buffer) : DECODER_MAP.unsigned(buffer);
}

function padLeft(str: string, len: number, chr = ' '): string {
    if (str.length >= len) {
        return str;
    }
    str = chr.repeat(len - str.length) + str;
    return str;
}

function getBinaryEncoding(enc: string): BinaryEncoding {
    enc =  enc ? enc.toLowerCase() : '';
    if (!(enc in  BinaryEncoding)) {
        enc = BinaryEncoding.UNSIGNED;
    }
    return enc as BinaryEncoding;
}

function getTextEncoding(enc: string): TextEncoding {
    enc =  enc ? enc.toLowerCase() : '';
    if (!(enc in TextEncoding)) {
        return TextEncoding.UTF8;
    }
    return enc as TextEncoding;
}
class BinaryFormatter {
    private readonly bytesNeeded = 4;
    private buffer = Buffer.alloc(4);
    private bytesRead = 0;
    private hrTimer = new HrTimer();

    constructor(
        protected ptyTerm: PtyTerminal,
        protected encoding: string,
        protected scale: number) {
        this.bytesRead = 0;
        this.encoding = getBinaryEncoding(encoding);
        this.scale = scale || 1;
    }

    public writeBinary(input: string | Buffer) {
        const data: Buffer = Buffer.from(input);
        const timestamp = this.hrTimer.createDateTimestamp();
        for (const chr of data) {
            this.buffer[this.bytesRead] = chr;
            this.bytesRead = this.bytesRead + 1;
            if (this.bytesRead === this.bytesNeeded) {
                let chars = '';
                for (const byte of this.buffer) {
                    if (byte <= 32 || (byte >= 127 && byte <= 159)) {
                        chars += '.';
                    } else {
                        chars += String.fromCharCode(byte);
                    }
                }
                const blah = this.buffer.toString();
                const hexvalue = padLeft(this.buffer.toString('hex'), 8, '0');
                const decodedValue = parseEncoded(this.buffer, this.encoding);
                const decodedStr = padLeft(`${decodedValue}`, 12);
                const scaledValue = padLeft(`${decodedValue * this.scale}`, 12);

                this.ptyTerm.write(`${timestamp} ${chars}  0x${hexvalue} - ${decodedStr} - ${scaledValue}\n`);
                this.bytesRead = 0;
            }
        }
    }
}
