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

import { EOL } from 'os';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { dirname } from 'path';
import { CmsisRequestArguments } from './cmsis-debug-session';
import * as nodeProcess from 'process';

const TIMEOUT = 1000 * 10; // 10 seconds

export abstract class AbstractServer extends EventEmitter {

    protected process?: ChildProcess;
    protected outBuffer: string = '';
    protected errBuffer: string = '';
    protected launchResolve?: () => void;
    protected launchReject?: (error: any) => void;
    protected timer?: NodeJS.Timer;

    constructor(protected args: CmsisRequestArguments) {
        super();
    }

    public spawn(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            this.launchResolve = resolve;
            this.launchReject = reject;

            try {
                this.timer = setTimeout(() => this.onSpawnError(new Error('Timeout waiting for gdb server to start')), TIMEOUT);

                const command = this.args.gdbServer || 'gdb-server';
                const serverArguments = await this.resolveServerArguments(this.args.gdbServerArguments);
                this.process = spawn(command, serverArguments, {
                    cwd: dirname(command),
                    env: this.resolveServerEnv(this.args.gdbServerEnv ? this.args.gdbServerEnv as NodeJS.ProcessEnv : undefined )
                });

                if (!this.process) {
                    throw new Error('Unable to spawn gdb server');
                }

                this.process.on('exit', this.onExit.bind(this));
                this.process.on('error', this.onSpawnError.bind(this));

                if (this.process.stdout) {
                    this.process.stdout.on('data', this.onStdout.bind(this));
                }
                if (this.process.stderr) {
                    this.process.stderr.on('data', this.onStderr.bind(this));
                }
            } catch (error) {
                this.onSpawnError(error);
            }
        });
    }

    public kill() {
        if (this.process) {
            this.process.kill('SIGINT');
        }
    }

    public resolveGdbPort(port: number): number {
        return port;
    }

    protected async resolveServerArguments(serverArguments?: string[]): Promise<string[]> {
        return serverArguments || [];
    }

    private resolveServerEnv(serverEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
        return serverEnv || nodeProcess.env;
    }

    protected onExit(code: number, signal: string) {
        this.emit('exit', code, signal);

        // Code can be undefined, null or 0 and we want to ignore those values
        if (!!code) {
            this.emit('error', `GDB server stopped unexpectedly with exit code ${code}`);
        }
    }

    protected onSpawnError(error: Error) {
        if (this.launchReject) {
            this.clearTimer();
            this.launchReject(error);
            this.clearPromises();
        }
    }

    protected onStdout(chunk: string | Buffer) {
        this.onData(chunk, 'stdout');
    }

    protected onStderr(chunk: string | Buffer) {
        this.onData(chunk, 'stderr');
    }

    protected onData(chunk: string | Buffer, event: 'stdout' | 'stderr') {
        const bufferName = event === 'stdout' ? 'outBuffer' : 'errBuffer';
        this[bufferName] += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

        const end = this[bufferName].lastIndexOf('\n');
        if (end !== -1) {
            const data = this[bufferName].substring(0, end);
            this.emit(event, data);
            this.handleData(data);
            this[bufferName] = this[bufferName].substring(end + 1);
        }
    }

    protected handleData(data: string) {
        if (this.launchResolve && this.serverStarted(data)) {
            this.clearTimer();
            this.launchResolve();
            this.clearPromises();
        }

        if (this.serverError(data)) {
            this.emit('error', data.split(EOL)[0]);
        }
    }

    protected clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    protected clearPromises() {
        this.launchResolve = undefined;
        this.launchReject = undefined;
    }

    protected abstract serverStarted(data: string): boolean;
    protected abstract serverError(data: string): boolean;
}
