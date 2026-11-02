/** MD5 of a text, as hex - Mailchimp names a member by the MD5 of their lower-case e-mail. */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array((((bytes.length + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; i++) words[i >>> 2]! |= bytes[i]! << ((i % 4) * 8);
  words[bytes.length >>> 2]! |= 0x80 << ((bytes.length % 4) * 8);
  words[words.length - 2] = (bytes.length * 8) >>> 0;
  words[words.length - 1] = Math.floor(bytes.length / 0x20000000);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      const round = i >>> 4;
      let f: number, g: number;
      if (round === 0) { f = (b & c) | (~b & d); g = i; }
      else if (round === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (round === 2) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + K[i]! + words[chunk + g]!) >>> 0;
      const shift = S[round * 4 + (i % 4)]!;
      a = d; d = c; c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map(n => [0, 8, 16, 24].map(s => ((n >>> s) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}
