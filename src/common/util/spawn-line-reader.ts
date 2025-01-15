import { EventEmitter } from 'events';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as stream from 'stream';
const readline = require('readline');

//
// You have two choices.
// 1. Get events that you subscribe to or
// 2. get immediate callback and you will not get events
//
// There are three events
//  emit('error', err)                -- only emit
//  emit('close') and cb(null)
//  emit('line', line)  or cb(line)   -- NOT both, line can be empty ''
//  emit('exit', code, signal)        -- Only emit, NA for a stream Readable
//
// Either way, you will get a promise though. On Error though no rejection is issued and instead, it will
// emit and error and resolve to false
//
// You can chose to change the callback anytime -- perhaps based on the state of your parser. The
// callback has to return true to continue reading or false to end reading
//
// On exit for program, you only get an event. No call back.
//
// Why? Stuff like objdump/nm can produce very large output and reading them into a mongo
// string is a disaster waiting to happen. It is slow and will fail at some point. On small
// output, it may be faster but not on large ones. Tried using temp files but that was also
// slow. In this mechanism we use streams and NodeJS readline to hook things up and read
// things line at a time. Most of that kind of output needs to be parsed line at a time anyways
//
// Another benefit was we can run two programs at the same time and get the output of both in
// the same time as running just one. NodeJS is amazing juggling stuff and although not-multi threaded
// it almost look like it
//
// Finally, you can also use a file or a stream to read instead of a program to run.
//
export class SpawnLineReader extends EventEmitter {
    public callback: (line: string) => boolean;
    private promise: Promise<boolean>;
    constructor() {
        super();
    }

    public startWithProgram(
        prog: string, args: readonly string[] = [],
        spawnOpts: childProcess.SpawnOptions = {}, cb: (line: string) => boolean = null): Promise<boolean> {
        if (this.promise) { throw new Error('SpawnLineReader: can\'t reuse this object'); }
        this.callback = cb;
        this.promise = new Promise<boolean>((resolve) => {
            try {
                const child = childProcess.spawn(prog, args, spawnOpts);
                child.on('error', (err) => {
                    this.emit('error', err);
                    resolve(false);
                });
                child.on('exit', (code: number, signal: string) => {
                    this.emit('exit', code, signal);
                    // read-line will resolve. Not us
                });
                this.doReadline(child.stdout, resolve);
            }
            catch (e) {
                this.emit('error', e);
            }
        });
        return this.promise;
    }

    public startWithStream(rStream: stream.Readable, cb: (line: string) => boolean = null): Promise<boolean> {
        if (this.promise) { throw new Error('SpawnLineReader: can\'t reuse this object'); }
        this.callback = cb;
        this.promise =  new Promise<boolean>((resolve) => {
            this.doReadline(rStream, resolve);
        });
        return this.promise;
    }

    public startWithFile(filename: fs.PathLike, options: string | any = null, cb: (line: string, err?: any) => boolean = null): Promise<boolean> {
        if (this.promise) { throw new Error('SpawnLineReader: can\'t reuse this object'); }
        this.callback = cb;
        this.promise = new Promise<boolean>((resolve) => {
            const readStream = fs.createReadStream(filename, options || {flags: 'r'});
            readStream.on('error', ((e) => {
                this.emit('error', e);
                resolve(false);
            }));
            readStream.on('open', (() => {
                this.doReadline(readStream, resolve);
            }));
        });
        return this.promise;
    }

    private doReadline(rStream: stream.Readable, resolve) {
        try {
            const rl = readline.createInterface({
                input: rStream,
                crlfDelay: Infinity,
                console: false
            });
            rl.on('line', (line) => {
                if (this.callback) {
                    if (!this.callback(line)) {
                        rl.close();
                    }
                } else {
                    this.emit('line', line);
                }
            });
            rl.once('close', () => {
                if (this.callback) {
                    this.callback(null);
                }
                rStream.destroy();
                this.emit('close');
                resolve(true);
            });
        }
        catch (e) {
            this.emit('error', e);
        }
    }
}
