const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export const HOSTS_MAGIC = 0x4d584842;
export const HOSTS_VERSION = 1;

export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(input.toLowerCase())) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash;
}

export function encodeHosts(hosts: Iterable<string>): Uint8Array {
  const hashes = [...new Set([...hosts].map((host) => fnv1a64(host)))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const buffer = new ArrayBuffer(12 + hashes.length * 8);
  const view = new DataView(buffer);
  view.setUint32(0, HOSTS_MAGIC, false);
  view.setUint32(4, HOSTS_VERSION, false);
  view.setUint32(8, hashes.length, false);
  hashes.forEach((hash, index) => {
    view.setBigUint64(12 + index * 8, hash, false);
  });
  return new Uint8Array(buffer);
}

export class HostSet {
  private readonly view: DataView;
  private readonly count: number;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.byteLength < 12 ||
      this.view.getUint32(0, false) !== HOSTS_MAGIC ||
      this.view.getUint32(4, false) !== HOSTS_VERSION
    ) {
      throw new Error('Invalid hosts.bin header');
    }
    this.count = this.view.getUint32(8, false);
    if (bytes.byteLength !== 12 + this.count * 8) {
      throw new Error('Corrupt hosts.bin length');
    }
  }

  get size(): number {
    return this.count;
  }

  private containsHash(hash: bigint): boolean {
    let low = 0;
    let high = this.count - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const value = this.view.getBigUint64(12 + mid * 8, false);
      if (value === hash) {
        return true;
      }
      if (value < hash) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return false;
  }

  matches(host: string): boolean {
    const parts = host.toLowerCase().split('.');
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (this.containsHash(fnv1a64(parts.slice(i).join('.')))) {
        return true;
      }
    }
    return false;
  }
}
