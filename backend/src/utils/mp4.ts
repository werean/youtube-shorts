/**
 * Utility para criar um arquivo MP4 mínimo válido para testes.
 */

export function createDummyMP4(): Buffer {
  // Criar um MP4 com estrutura mínima mas válida
  // ftyp + mdat + moov

  const buffers: Buffer[] = [];

  // === ftyp box ===
  const ftypSize = 20;
  const ftyp = Buffer.alloc(ftypSize);
  ftyp.writeUInt32BE(ftypSize, 0); // box size
  ftyp.write("ftyp", 4, "ascii"); // box type
  ftyp.write("isom", 8, "ascii"); // majorBrand
  // minor and compatible brands...
  buffers.push(ftyp);

  // === mdat box (minimal) ===
  const mdatSize = 8;
  const mdat = Buffer.alloc(mdatSize);
  mdat.writeUInt32BE(mdatSize, 0); // box size
  mdat.write("mdat", 4, "ascii"); // box type
  buffers.push(mdat);

  // === moov box (minimal but valid) ===
  // mvhd (required in moov)
  const mvhdSize = 108; // 100 + 8 for box header
  const mvhd = Buffer.alloc(mvhdSize);
  mvhd.writeUInt32BE(mvhdSize, 0); // box size
  mvhd.write("mvhd", 4, "ascii"); // box type
  mvhd.writeUInt32BE(0, 8); // version=0, flags=0
  mvhd.writeUInt32BE(0, 12); // creationTime
  mvhd.writeUInt32BE(0, 16); // modificationTime
  mvhd.writeUInt32BE(1000, 20); // timescale
  mvhd.writeUInt32BE(1000, 24); // duration = 1000 (1 second at 1000 timescale)
  mvhd.writeUInt32BE(0x00010000, 28); // playbackSpeed (1.0 fixed 16.16)
  mvhd.writeUInt16BE(0x0100, 32); // volume (1.0 fixed 8.8)
  // predefined (6 bytes) = 0
  // matrix (36 bytes) = identity
  mvhd.writeUInt32BE(0x00010000, 40); // matrix[0][0]
  mvhd.writeUInt32BE(0x00010000, 56); // matrix[1][1]
  mvhd.writeUInt32BE(0x40000000, 72); // matrix[2][2]
  mvhd.writeUInt32BE(0x00000001, 88); // nextTrackID

  const moovSize = mvhdSize + 8; // moov header + mvhd
  const moov = Buffer.alloc(moovSize);
  moov.writeUInt32BE(moovSize, 0); // box size
  moov.write("moov", 4, "ascii"); // box type
  mvhd.copy(moov, 8); // copy mvhd into moov
  buffers.push(moov);

  return Buffer.concat(buffers);
}
