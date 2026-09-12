import type { BridgeErrorCode } from '../protocol.js';

export class BridgeError extends Error
{
  code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string)
  {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}
