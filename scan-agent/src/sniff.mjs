// Magic-byte sniffing (plan D9) — Node twin of the edge fn's sniffMime.
// The scanner's declared extension is advisory; bytes decide.

export function sniffMime(bytes) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf"; // %PDF
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = Buffer.from(bytes.slice(8, 12)).toString("ascii");
    if (["heic", "heix", "hevc", "mif1", "msf1", "heif"].includes(brand)) return "image/heic";
  }
  return null;
}
