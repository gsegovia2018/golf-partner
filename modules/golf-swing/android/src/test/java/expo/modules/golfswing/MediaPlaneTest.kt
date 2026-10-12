package expo.modules.golfswing

import org.junit.Assert.assertArrayEquals
import org.junit.Test
import java.nio.ByteBuffer

/** Media.plane: how decoder Image planes (strides, padding, crop, P010) become packed bytes. */
class MediaPlaneTest {
  /** A plane of [rows] rows, [rowStride] bytes apart, the last row cut after its last pixel (as Image buffers are). */
  private fun planeBuf(rows: Int, rowStride: Int, lastRowBytes: Int, value: (row: Int, byte: Int) -> Int): ByteBuffer {
    val size = (rows - 1) * rowStride + lastRowBytes
    val b = ByteArray(size) { value(it / rowStride, it % rowStride).toByte() }
    return ByteBuffer.wrap(b)
  }

  @Test
  fun packedLumaWithRowPadding() {
    // 3 × 2 visible, rows padded to 8 bytes
    val buf = planeBuf(2, 8, 3) { r, c -> if (c < 3) 10 * r + c else 99 }
    val dst = ByteArray(6)
    Media.plane(buf, 8, 1, 0, 0, 0, 3, 2, 1, dst)
    assertArrayEquals(byteArrayOf(0, 1, 2, 10, 11, 12), dst)
  }

  @Test
  fun interleavedChromaPixelStrideTwo() {
    // NV12-style U plane view: U at even bytes, V at odd; 3 samples per row, row stride 8,
    // last row ends at its last U sample (5 bytes), like an Image's U plane
    val buf = planeBuf(2, 8, 5) { r, c -> if (c % 2 == 0) 10 * r + c / 2 else 77 }
    val dst = ByteArray(6)
    Media.plane(buf, 8, 2, 0, 0, 0, 3, 2, 1, dst)
    assertArrayEquals(byteArrayOf(0, 1, 2, 10, 11, 12), dst)
  }

  @Test
  fun oddCropOffsetsTheReadInBothAxes() {
    // crop starting at (1, 1) of a 4 × 3 plane, 2 × 2 out
    val buf = planeBuf(3, 4, 4) { r, c -> 10 * r + c }
    val dst = ByteArray(4)
    Media.plane(buf, 4, 1, 0, 1, 1, 2, 2, 1, dst)
    assertArrayEquals(byteArrayOf(11, 12, 21, 22), dst)
    // the same crop on an interleaved plane (pixel stride 2): x0 counts samples, not bytes
    val nv = planeBuf(3, 8, 8) { r, c -> if (c % 2 == 0) 10 * r + c / 2 else 77 }
    Media.plane(nv, 8, 2, 0, 1, 1, 2, 2, 1, dst)
    assertArrayEquals(byteArrayOf(11, 12, 21, 22), dst)
  }

  @Test
  fun p010KeepsTheHighByte() {
    // 16-bit little-endian samples, value v << 8 | 0x3F (10 bits in the high bits)
    val buf = planeBuf(2, 8, 6) { r, c -> if (c % 2 == 1) 10 * r + c / 2 else 0x3F }
    val dst = ByteArray(6)
    Media.plane(buf, 8, 2, 1, 0, 0, 3, 2, 1, dst)
    assertArrayEquals(byteArrayOf(0, 1, 2, 10, 11, 12), dst)
  }

  @Test
  fun decimationTakesEverySecondPixelAndRow() {
    val buf = planeBuf(4, 4, 4) { r, c -> 10 * r + c }
    val dst = ByteArray(4)
    Media.plane(buf, 4, 1, 0, 0, 0, 2, 2, 2, dst)
    assertArrayEquals(byteArrayOf(0, 2, 20, 22), dst)
  }
}
