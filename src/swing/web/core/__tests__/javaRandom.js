// java.util.Random (the 48-bit LCG), so the ported Kotlin tests draw the same seeded inputs.

const MULT = 0x5DEECE66Dn;
const MASK = (1n << 48n) - 1n;

export class JavaRandom {
  constructor(seed) {
    this.seed = (BigInt(seed) ^ MULT) & MASK;
  }

  next(bits) {
    this.seed = (this.seed * MULT + 0xBn) & MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  nextInt(bound) {
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n) | 0;
    let bits;
    let val;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  }
}
