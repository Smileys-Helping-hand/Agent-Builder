import fs from "fs/promises";
import path from "path";
import { Logger } from "../utils/Logger.js";

export type WasmExecutionResult = {
  output: string;
  metrics: {
    durationMs: number;
    memoryBytes?: number;
  };
};

export class WasmRuntime {
  private instance: WebAssembly.Instance | null = null;
  private modulePath: string;

  constructor(modulePath: string) {
    this.modulePath = modulePath;
  }

  async initialize(): Promise<void> {
    if (this.instance) {
      return;
    }
    const source = await fs.readFile(this.modulePath);
    const module = await WebAssembly.compile(source);
    const imports = {
      env: {
        log: (ptr: number, len: number) => {
          Logger.log("WASM", `log(${ptr}, ${len}) emitted without linear memory binding`);
        }
      }
    };
    const instantiated = await WebAssembly.instantiate(module, imports);
    this.instance = instantiated;
  }

  async execute(payload: Record<string, unknown>): Promise<WasmExecutionResult> {
    await this.initialize();
    const started = Date.now();
    const exports = this.instance?.exports ?? {};
    const entry = (exports.handle_task ?? exports.main) as
      | ((ptr: number, len: number) => number)
      | undefined;

    if (!entry) {
      throw new Error("WASM module does not expose handle_task or main entry point");
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const memory = exports.memory as WebAssembly.Memory | undefined;
    if (!memory) {
      throw new Error("WASM module is missing exported linear memory");
    }

    const encoded = encoder.encode(JSON.stringify(payload));
    const buffer = new Uint8Array(memory.buffer);
    const ptr = this.allocate(buffer, encoded);
    const len = encoded.length;
    const resultPtr = entry(ptr, len);

    const view = new DataView(memory.buffer);
    const outputLen = view.getUint32(resultPtr, true);
    const outputPtr = view.getUint32(resultPtr + 4, true);
    const output = decoder.decode(new Uint8Array(memory.buffer, outputPtr, outputLen));

    return {
      output,
      metrics: {
        durationMs: Date.now() - started,
        memoryBytes: memory.buffer.byteLength
      }
    } satisfies WasmExecutionResult;
  }

  private allocate(buffer: Uint8Array, data: Uint8Array): number {
    if (buffer.length < data.length + 8) {
      throw new Error("WASM linear memory too small for payload");
    }
    buffer.set(data, 8);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, data.length, true);
    view.setUint32(4, 8, true);
    return 0;
  }
}

export const loadWasmRuntime = async (modulePath: string): Promise<WasmRuntime> => {
  const resolved = path.isAbsolute(modulePath) ? modulePath : path.resolve(process.cwd(), modulePath);
  const runtime = new WasmRuntime(resolved);
  await runtime.initialize();
  return runtime;
};
