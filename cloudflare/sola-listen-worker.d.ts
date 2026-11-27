/* Types for the tests of the Sola hang-up helper (the Worker itself is plain JavaScript). */
export function frameRms(b64: string): number;
export function sameKey(a: string, b: string | null): boolean;
export class SolaListen {
  constructor(state: unknown);
  resultAt: number;
  key: string;
  fetch(req: Request): Promise<Response>;
  onMessage(data: string): void;
  tick(): void;
}
declare const worker: { fetch(req: Request, env: unknown): Promise<Response> };
export default worker;
