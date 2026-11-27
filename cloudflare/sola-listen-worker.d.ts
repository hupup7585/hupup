/* Types for the tests of the Sola hang-up helper (the Worker itself is plain JavaScript). */
export function frameRms(b64: string): number;
export function tryKey(secret: string, tryId: string | number): Promise<string>;
export class SolaListen {
  constructor(state: unknown);
  resultAt: number;
  onMessage(data: string): void;
  tick(): void;
}
declare const worker: { fetch(req: Request, env: unknown): Promise<Response> };
export default worker;
