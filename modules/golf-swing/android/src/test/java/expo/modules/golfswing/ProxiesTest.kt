package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProxiesTest {
  @Test
  fun everyFourthFrameOfTheWholeClip() {
    val f = Proxies.frames(960, 4)
    assertEquals(240, f.size)
    assertEquals(listOf(0, 4, 8), f.take(3))
    assertEquals(956, f.last())
    assertEquals(listOf(0, 4, 8), Proxies.frames(9, 4)) // a partial last step still gets its frame
  }

  @Test
  fun onlyTheSwingWindowAlignedToEvery() {
    assertEquals(listOf(100, 104, 108), Proxies.frames(960, 4, 99..110))
    assertEquals(listOf(952, 956), Proxies.frames(960, 4, 950..2000)) // clamped to the clip
    assertEquals(listOf(0, 4), Proxies.frames(960, 4, -50..6))
    assertTrue(Proxies.frames(960, 4, 500..400).isEmpty())
  }

  @Test
  fun everySecondFrameInsideTheWindow() {
    // apiVersion 6: the JS asks for every 2nd frame (frames.js proxyEvery)
    assertEquals(listOf(100, 102, 104, 106, 108, 110), Proxies.frames(960, 2, 99..110))
  }

  @Test
  fun noProxiesWhenOff() {
    assertTrue(Proxies.frames(960, 0).isEmpty())
    assertTrue(Proxies.frames(0, 4).isEmpty())
  }

  @Test
  fun shortSideIs240AndTheAspectIsKept() {
    assertEquals(Pair(240, 427), Proxies.size(1080, 1920)) // portrait 9:16
    assertEquals(Pair(240, 320), Proxies.size(720, 960)) // the mock's 3:4
    assertEquals(Pair(427, 240), Proxies.size(1920, 1080)) // landscape
    assertEquals(Pair(120, 200), Proxies.size(120, 200)) // never upscaled
  }

  @Test
  fun pixelsAreTheDisplayOrientedFrameAtProxySize() {
    // a 90° clip: coded 1920 × 1080, displayed 1080 × 1920
    val f = YuvFrame(1920, 1080, 90, true)
    f.y.fill(0xFF.toByte()) // white luma, neutral chroma
    f.u.fill(0x80.toByte())
    f.v.fill(0x80.toByte())
    val (px, w, h) = Proxies.pixels(f)
    assertEquals(Pair(240, 427), Pair(w, h))
    assertEquals(240 * 427, px.size)
    assertEquals(0xFFFFFFFF.toInt(), px[0])
  }
}
