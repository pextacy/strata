// pngjs ships no types and it is only ever used to read a PNG back in tests and
// in scripts/verify.mjs. This is the part of its surface Strata touches — a
// declaration rather than another dependency for four lines of API.

declare module "pngjs" {
  export interface DecodedPng {
    width: number;
    height: number;
    data: Uint8Array;
  }

  export const PNG: {
    sync: {
      read(buffer: Uint8Array): DecodedPng;
      write(png: DecodedPng): Buffer;
    };
  };
}
