package expo.modules.golfswing.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecordingModeTest {
  private fun mode(w: Int, h: Int, fps: Int, hs: Boolean, cam: String = "0") = RecordingMode(cam, w, h, fps, hs)

  @Test
  fun prefers240Over120AndHighSpeedOverOrdinary() {
    val ranked = ModeRanking.rank(
      listOf(
        mode(1920, 1080, 30, false),
        mode(1920, 1080, 120, true),
        mode(1280, 720, 60, false),
        mode(1280, 720, 240, true),
        mode(1280, 720, 120, true),
      )
    )
    assertEquals(listOf(240, 120, 120, 60, 30), ranked.map { it.fps })
    assertEquals(1280, ranked[0].width)
  }

  @Test
  fun at720pBeats1080pAtTheSameRate() {
    val ranked = ModeRanking.rank(listOf(mode(1920, 1080, 120, true), mode(1280, 720, 120, true)))
    assertEquals(listOf(1280, 1920), ranked.map { it.width })
  }

  @Test
  fun dropsOversizeAndDuplicatesKeepingTheFirstCamera() {
    val ranked = ModeRanking.rank(
      listOf(
        mode(3840, 2160, 240, true),
        mode(1280, 720, 240, true, cam = "0"),
        mode(1280, 720, 240, true, cam = "2"),
      )
    )
    assertEquals(1, ranked.size)
    assertEquals("0", ranked[0].cameraId)
  }

  @Test
  fun highSpeedUsesFixedRangesAndTheWidestPreviewRange() {
    val modes = ModeRanking.highSpeedModes("0", 1280, 720, listOf(30 to 240, 240 to 240, 30 to 120, 120 to 120, 60 to 60))
    assertEquals(listOf(240, 120), modes.map { it.fps })
    assertEquals(30, modes[0].previewMin)
    assertEquals(240, modes[0].recordMin)
  }

  @Test
  fun ordinaryModeRespectsTheSizeFrameDuration() {
    val ranges = listOf(15 to 30, 30 to 30, 7 to 60, 60 to 60)
    val at30 = ModeRanking.ordinaryMode("0", 1920, 1080, 33_333_333L, ranges)!!
    assertEquals(30, at30.fps)
    assertEquals(30, at30.recordMin)
    assertEquals(60, ModeRanking.ordinaryMode("0", 1280, 720, 16_666_666L, ranges)!!.fps)
    assertNull(ModeRanking.ordinaryMode("0", 1280, 720, 100_000_000L, ranges))
  }
}
