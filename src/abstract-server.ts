/*
* CMSIS Debug Adapter
* Copyright (c) 2017-2019 Marcel Ball
* Copyright (c) 2019 Arm Limited
*
* The MIT License (MIT)
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { dirname } from 'path';
import { CmsisRequestArguments } from './cmsis-debug-session';

export abstract class AbstractServer extends EventEmitter {

    protected process?: ChildProcess;
    protected outBuffer: string = '';
    protected errBuffer: string = '';
    protected launchResolve?: () => void;
    protected launchReject?: (error: any) => void;

    public spawn(args: CmsisRequestArguments): Promise<void> {
        return new Promise(async (resolve, reject) => {
            this.launchResolve = resolve;
            this.launchReject = reject;

            try {
                const command = args.gdbServer || 'gdb-server';
                this.process = spawn(command, args.gdbServerArguments, {
                    cwd: dirname(command),
                });

                if (this.process) {
                    this.process.on('exit', this.onExit.bind(this));
                    this.process.on('error', this.onError.bind(this));

                    if (this.process.stdout) {
                        this.process.stdout.on('data', this.onStdout.bind(this));
                    }
                    if (this.process.stderr) {
                        this.process.stderr.on('data', this.onStderr.bind(this));
                    }
                }
            } catch (error) {
                return reject(error);
            }
        });
    }

    public kill() {
        if (this.process) {
            this.process.kill('SIGINT');
        }
    }

    protected onExit(code: number, signal: string) {
        this.emit('exit', code, signal);
    }

    protected onError(error: Error) {
        this.emit('error', error);

        if (this.launchReject) {
            this.launchReject(error);
            this.clearPromise();
        }
    }

    protected onStdout(chunk: string | Buffer) {
        this.onData(chunk, this.outBuffer);
    }

    protected onStderr(chunk: string | Buffer) {
        this.onData(chunk, this.errBuffer);
    }

    protected onData(chunk: string | Buffer, buffer: string) {
        buffer += typeof chunk === 'string' ? chunk
                : chunk.toString('utf8');

        const end = buffer.lastIndexOf('\n');
        if (end !== -1) {
            this.handleData(buffer.substring(0, end));
            buffer = buffer.substring(end + 1);
        }
    }

    protected handleData(data: string) {
        this.emit('data', data);
        if (this.launchResolve && this.serverStarted(data)) {
            this.launchResolve();
            this.clearPromise();
        }
    }

    protected clearPromise() {
        this.launchResolve = undefined;
        this.launchReject = undefined;
    }

    protected abstract serverStarted(data: string): boolean;
}
