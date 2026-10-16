package expo.modules.golfswing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The club detector's Kotlin side (plan 2026-10-16 §3.4–3.5, §4.2): decode + NMS against the lab's
 * golden fixtures (src/test/resources/club, written by tools/swing-lab/export_tflite.py from the
 * TFLite model's own raw output), the input tensor layout, and the post-rules. The interpreter
 * itself has no desktop JVM build; the on-device clubSelfTest covers it.
 */
class ClubDetectorTest {
  private val clips = listOf("marcos-2026-10-10-556", "swing-2026-10-13-88125330-557", "swing-2026-10-14-b5e60f31-650")

  private fun bytes(name: String): ByteArray =
    javaClass.getResourceAsStream("/club/$name")!!.use { it.readBytes() }

  private fun raw(clip: String): FloatArray {
    val fb = ByteBuffer.wrap(bytes("$clip.raw.bin")).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
    return FloatArray(fb.remaining()).also { fb.get(it) }
  }

  /** The boxes of one array of boxes.json (a flat list of {cls, score, x1..y2}; no JSON library on the test classpath). */
  private fun expected(clip: String, array: String): List<ClubBox> {
    val json = String(bytes("$clip.boxes.json"))
    val body = Regex("\"$array\"\\s*:\\s*\\[(.*?)]", RegexOption.DOT_MATCHES_ALL).find(json)!!.groupValues[1]
    return Regex("\\{(.*?)}", RegexOption.DOT_MATCHES_ALL).findAll(body).map { m ->
      fun num(k: String) = Regex("\"$k\"\\s*:\\s*(-?[0-9.eE+-]+)").find(m.groupValues[1])!!.groupValues[1].toDouble()
      ClubBox(num("cls").toInt(), num("score"), num("x1"), num("y1"), num("x2"), num("y2"))
    }.toList()
  }

  private fun field(clip: String, k: String) =
    Regex("\"$k\"\\s*:\\s*([0-9]+)").find(String(bytes("$clip.boxes.json")))!!.groupValues[1].toInt()

  private fun assertBoxes(want: List<ClubBox>, got: List<ClubBox>, what: String) {
    assertEquals("$what: count", want.size, got.size)
    for ((i, p) in want.zip(got).withIndex()) {
      val (w, g) = p
      assertEquals("$what[$i] cls", w.cls, g.cls)
      assertEquals("$what[$i] score", w.score, g.score, 1e-3)
      assertEquals("$what[$i] x1", w.x1, g.x1, 0.5)
      assertEquals("$what[$i] y1", w.y1, g.y1, 0.5)
      assertEquals("$what[$i] x2", w.x2, g.x2, 0.5)
      assertEquals("$what[$i] y2", w.y2, g.y2, 0.5)
    }
  }

  @Test
  fun decodeAndNmsMatchTheLabOnEachGoldenFrame() {
    for (clip in clips) {
      val r = raw(clip)
      assertEquals(ClubDecode.ROWS * ClubDecode.COLS, r.size)
      val got = ClubDecode.boxes(r)
      assertBoxes(expected(clip, "boxes640"), got, clip)
      // display px: x by frameW / 640, y by frameH / 640 (what Checkpoints hands to the rules)
      val sx = field(clip, "frameW") / 640.0
      val sy = field(clip, "frameH") / 640.0
      assertBoxes(expected(clip, "boxesDisplay"), got.map { it.scaled(sx, sy) }, "$clip display")
    }
  }

  @Test
  fun nmsIsPerClassAndKeepsTheBestOfAnOverlap() {
    fun row(cx: Float, cy: Float, w: Float, h: Float, obj: Float, shaft: Float, head: Float, hands: Float) =
      floatArrayOf(cx, cy, w, h, obj, shaft, head, hands)
    val raw = row(100f, 100f, 20f, 20f, 0.9f, 0.1f, 0.9f, 0.1f) + // head 0.81
      row(102f, 100f, 20f, 20f, 0.8f, 0.1f, 0.8f, 0.1f) + // head 0.64, IoU 0.82: suppressed
      row(101f, 100f, 20f, 20f, 0.7f, 0.9f, 0.1f, 0.1f) + // shaft 0.63 on the same spot: another class, kept
      row(300f, 300f, 20f, 20f, 0.1f, 0.1f, 0.2f, 0.1f) // head 0.02 < 0.03: dropped
    val b = ClubDecode.boxes(raw, n = 4)
    assertEquals(listOf(ClubDecode.HEAD, ClubDecode.SHAFT), b.map { it.cls })
    assertEquals(0.81, b[0].score, 1e-6)
    assertEquals(90.0, b[0].x1, 1e-6)
    assertEquals(110.0, b[0].y2, 1e-6)
  }

  @Test
  fun theInputTensorIsTheLabsBgrBytesAsFloats() {
    // input.bin is the uint8 HWC BGR tensor the lab fed; YuvFrame.toRgb gives R, G, B
    val bgr = bytes("${clips[0]}.input.bin")
    val px = ClubDecode.SIZE * ClubDecode.SIZE
    assertEquals(px * 3, bgr.size)
    val rgb = ByteArray(bgr.size)
    for (p in 0 until px) {
      rgb[3 * p] = bgr[3 * p + 2]
      rgb[3 * p + 1] = bgr[3 * p + 1]
      rgb[3 * p + 2] = bgr[3 * p]
    }
    val nhwc = ByteBuffer.allocateDirect(4 * px * 3).order(ByteOrder.nativeOrder()).asFloatBuffer()
    ClubDecode.fill(rgb, nhwc, nchw = false)
    for (i in bgr.indices step 997) assertEquals((bgr[i].toInt() and 0xFF).toFloat(), nhwc.get(i), 0f)
    val nchw = ByteBuffer.allocateDirect(4 * px * 3).order(ByteOrder.nativeOrder()).asFloatBuffer()
    ClubDecode.fill(rgb, nchw, nchw = true)
    for (p in 0 until px step 991) for (c in 0 until 3) {
      assertEquals((bgr[3 * p + c].toInt() and 0xFF).toFloat(), nchw.get(c * px + p), 0f)
    }
  }

  // --- post-rules -----------------------------------------------------------------------------

  /** The 13 pass-2 checkpoints at frames 100, 110, … (runAnalysis.js PASS2_KEYS order). */
  private val keys = listOf(
    "address", "takeaway", "leadArm", "top", "transition", "shaftDown", "impact", "shaftThrough", "trailArm", "finish",
    "lateBackswing", "preImpact", "postImpact",
  )
  private val frameOf = keys.withIndex().associate { (i, k) -> k to 100 + 10 * i }
  private val places = keys.associate { frameOf.getValue(it) to ClubRules.place(it) }

  private fun box(cls: Int, x: Double, y: Double, half: Double = 10.0, score: Double = 0.5) =
    ClubBox(cls, score, x - half, y - half, x + half, y + half)

  @Test
  fun thirteenCheckpointsAreElevenPlaces() {
    assertEquals(11, places.values.toSet().size)
    assertEquals("impact", ClubRules.place("preImpact"))
    assertEquals("impact", ClubRules.place("postImpact"))
    assertEquals("top", ClubRules.place("top"))
  }

  @Test
  fun aBoxThatHoldsItsPlaceAtFourOfElevenPlacesIsScenery() {
    val spare = box(ClubDecode.HEAD, 50.0, 800.0)
    val at = listOf("takeaway", "top", "shaftDown", "finish").map(frameOf::getValue).toSet()
    val dets = frameOf.values.associateWith { f -> if (f in at) listOf(spare) else emptyList() }
    val kept = ClubRules.dropStatic(dets, places)
    assertTrue(kept.values.all { it.isEmpty() })
    // at three places it is still a candidate (3 < 0.3 × 11)
    val three = frameOf.values.associateWith { f -> if (f in at && f != frameOf["finish"]) listOf(spare) else emptyList() }
    assertEquals(3, ClubRules.dropStatic(three, places).values.sumOf { it.size })
  }

  @Test
  fun theSwungHeadStillAtAddressAndImpactIsKeptBecauseTheImpactTrioIsOnePlace() {
    val head = box(ClubDecode.HEAD, 400.0, 900.0)
    val still = listOf("address", "preImpact", "impact", "postImpact").map(frameOf::getValue).toSet()
    val dets = frameOf.values.associateWith { f -> if (f in still) listOf(head) else emptyList() }
    assertEquals(4, ClubRules.dropStatic(dets, places).values.sumOf { it.size })
    // counted per frame (4 of 13 = 31 %) the same head would have been dropped
    val perFrame = frameOf.values.associateWith { it.toString() }
    assertEquals(0, ClubRules.dropStatic(dets, perFrame).values.sumOf { it.size })
  }

  @Test
  fun handsBoxesAreNeverDroppedAndOtherClassesDoNotVote() {
    val hands = box(ClubDecode.HANDS, 300.0, 500.0)
    val shaft = box(ClubDecode.SHAFT, 300.0, 500.0)
    val dets = frameOf.values.associateWith { listOf(hands) } + mapOf(frameOf.getValue("top") to listOf(hands, shaft))
    val kept = ClubRules.dropStatic(dets, places)
    assertEquals(13, kept.values.sumOf { r -> r.count { it.cls == ClubDecode.HANDS } })
    assertEquals(1, kept.values.sumOf { r -> r.count { it.cls == ClubDecode.SHAFT } })
  }

  @Test
  fun aHeadBoxBeyond150CmOfTheGripIsIgnored() {
    val grip = Pt(500f, 500f)
    val pxPerCm = 2.0 // 150 cm = 300 px
    val near = box(ClubDecode.HEAD, 500.0, 790.0, score = 0.3)
    val far = box(ClubDecode.HEAD, 500.0, 810.0, score = 0.9)
    val h = ClubRules.head(listOf(far, near), grip, pxPerCm)!!
    assertEquals("model", h.source)
    assertEquals(790.0, h.y, 1e-9)
    assertEquals(0.3, h.score, 1e-9)
    // only the far one: no head, and no shaft box to fall back on
    assertNull(ClubRules.head(listOf(far), grip, pxPerCm))
    // without a scale the rule cannot apply
    assertEquals(810.0, ClubRules.head(listOf(far, near), grip, null)!!.y, 1e-9)
  }

  @Test
  fun noHeadBoxFallsBackToTheShaftCornerFarthestFromTheGrip() {
    val shaft = ClubBox(ClubDecode.SHAFT, 0.7, 300.0, 400.0, 360.0, 600.0)
    val weak = ClubBox(ClubDecode.SHAFT, 0.2, 0.0, 0.0, 20.0, 20.0)
    val fromTopLeft = ClubRules.head(listOf(weak, shaft), Pt(305f, 405f), 2.0)!!
    assertEquals("model-shaft", fromTopLeft.source)
    assertEquals(Pair(360.0, 600.0), Pair(fromTopLeft.x, fromTopLeft.y))
    assertEquals(0.7, fromTopLeft.score, 1e-9)
    // a left-hander's (or a mirrored) shaft: grip at the top right, head at the bottom left
    val fromTopRight = ClubRules.head(listOf(shaft), Pt(358f, 402f), 2.0)!!
    assertEquals(Pair(300.0, 600.0), Pair(fromTopRight.x, fromTopRight.y))
  }

  @Test
  fun withoutAPoseGripTheHandsBoxIsTheAnchor() {
    val shaft = ClubBox(ClubDecode.SHAFT, 0.7, 300.0, 400.0, 360.0, 600.0)
    val hands = box(ClubDecode.HANDS, 355.0, 405.0) // the grip at the top right
    val h = ClubRules.head(listOf(shaft, hands), null, 2.0)!!
    assertEquals(Pair(300.0, 600.0), Pair(h.x, h.y))
    // the hands box also anchors the 150 cm rule
    val far = box(ClubDecode.HEAD, 355.0, 800.0)
    assertEquals("model-shaft", ClubRules.head(listOf(far, shaft, hands), null, 2.0)!!.source)
    // no anchor at all: a head box is still a head (no distance rule), a shaft corner cannot be chosen
    assertEquals("model", ClubRules.head(listOf(far), null, 2.0)!!.source)
    assertNull(ClubRules.head(listOf(shaft), null, 2.0))
  }

  // --- entries --------------------------------------------------------------------------------

  private val prior = mapOf("head" to null, "hidden" to false, "conf" to 0.1, "source" to "prior")
  private val edge = mapOf("head" to listOf(410.0, 905.0), "hidden" to false, "conf" to 0.6, "source" to "edge", "angleDeg" to 80, "lengthPx" to 200.0)
  private val base = linkedMapOf("100" to edge, "110" to prior, "160" to edge, "170" to prior)

  @Test
  fun aDetectorThatDidNotRunLeavesTheEntriesAsToday() {
    assertSame(base, ClubRules.merge(base, null, emptyMap(), 2.0))
  }

  @Test
  fun bestSourceFirstModelThenShaftCornerThenEdgeThenPrior() {
    val head = box(ClubDecode.HEAD, 400.0, 900.0, score = 0.0456)
    val shaft = ClubBox(ClubDecode.SHAFT, 0.7, 300.0, 400.0, 360.0, 600.0)
    val hands = box(ClubDecode.HANDS, 305.0, 405.0)
    val grip = Pt(305f, 405f)
    val dets = mapOf(100 to listOf(hands), 110 to listOf(shaft), 160 to listOf(head), 170 to emptyList())
    val grips = dets.keys.associateWith { grip } + mapOf(160 to Pt(400f, 700f)) // impact: the head 100 cm below the grip
    val out = ClubRules.merge(base, dets, grips, 2.0)
    assertEquals(listOf("100", "110", "160", "170"), out.keys.toList())
    // address: nothing but hands → today's edge entry, plus the boxes
    assertEquals(edge, out.getValue("100") - "boxes")
    assertEquals(listOf(mapOf("cls" to "hands", "score" to 0.5, "box" to listOf(295.0, 395.0, 315.0, 415.0))), out.getValue("100")["boxes"])
    // a shaft box alone: its far corner
    assertEquals("model-shaft", out.getValue("110")["source"])
    assertEquals(listOf(360.0, 600.0), out.getValue("110")["head"])
    // a head box beats the edge heuristic; conf is the detector's score
    val imp = out.getValue("160")
    assertEquals("model", imp["source"])
    assertEquals(listOf(400.0, 900.0), imp["head"])
    assertEquals(false, imp["hidden"])
    assertEquals(0.046, imp["conf"])
    assertNull(imp["angleDeg"])
    // the detector ran and found nothing: prior, with an empty box list
    assertEquals(prior + ("boxes" to emptyList<Any>()), out.getValue("170"))
    assertNotNull(out.getValue("170")["boxes"])
  }

  @Test
  fun atMostTenBoxesPerFrameMostConfidentFirst() {
    val many = (0 until 14).map { box(ClubDecode.HANDS, 100.0 * it, 100.0, score = 0.9 - 0.05 * it) }
    val out = ClubRules.merge(base, mapOf(170 to many), emptyMap(), null)
    @Suppress("UNCHECKED_CAST")
    val shown = out.getValue("170")["boxes"] as List<Map<String, Any?>>
    assertEquals(ClubRules.MAX_BOXES, shown.size)
    assertEquals(0.9, shown[0]["score"])
  }

  // --- scenery (on demand, plan 2026-10-16 on demand §3.2) -------------------------------------

  @Test
  fun splitStaticReturnsExactlyWhatDropStaticRemoves() {
    val spare = box(ClubDecode.HEAD, 50.0, 800.0, score = 0.4)
    val pole = box(ClubDecode.SHAFT, 900.0, 300.0, half = 40.0, score = 0.6)
    val head = box(ClubDecode.HEAD, 400.0, 900.0, score = 0.7)
    val hands = box(ClubDecode.HANDS, 50.0, 800.0)
    val dets = frameOf.values.associateWith { f -> listOf(spare, pole, hands) + if (f == frameOf["impact"]) listOf(head) else emptyList() }
    val (kept, dropped) = ClubRules.splitStatic(dets, places)
    assertEquals(ClubRules.dropStatic(dets, places), kept)
    assertEquals(dets.keys, dropped.keys)
    for (f in dets.keys) {
      assertEquals(dets.getValue(f).toSet(), (kept.getValue(f) + dropped.getValue(f)).toSet())
      assertEquals(listOf(spare, pole), dropped.getValue(f))
    }
    assertEquals(listOf(head, hands).toSet(), kept.getValue(frameOf.getValue("impact")).toSet())
    // nothing votes: everything kept, nothing dropped
    val (k0, d0) = ClubRules.splitStatic(dets, emptyMap())
    assertSame(dets, k0)
    assertTrue(d0.values.all { it.isEmpty() })
  }

  @Test
  fun sceneryClustersSameClassOverlapsIntoTheBestScoreIgnoresHandsAndCapsAtTwenty() {
    val a1 = box(ClubDecode.HEAD, 50.0, 800.0, score = 0.3)
    val a2 = box(ClubDecode.HEAD, 52.0, 801.0, score = 0.5) // IoU ≈ 0.75 with a1: the same spare club
    val a3 = box(ClubDecode.SHAFT, 51.0, 800.0, score = 0.9) // same place, another class: its own entry
    val far = box(ClubDecode.HEAD, 60.0, 800.0, score = 0.2) // IoU 0.33: another thing
    val hands = box(ClubDecode.HANDS, 50.0, 800.0, score = 0.99)
    val s = ClubRules.scenery(listOf(a1, a3, a2, far, hands))
    assertEquals(listOf(a3, a2, far), s)
    val many = (0 until 30).map { box(ClubDecode.SHAFT, 100.0 * it, 100.0, score = 0.01 * it) }
    val capped = ClubRules.scenery(many)
    assertEquals(ClubRules.MAX_SCENERY, capped.size)
    assertEquals(0.29, capped[0].score, 1e-9)
    assertTrue(ClubRules.scenery(emptyList()).isEmpty())
  }

  @Test
  fun dropSceneryDropsASameClassMatchKeepsOtherClassesAndHandsThenHeadFindsTheSwungOne() {
    val spare = box(ClubDecode.HEAD, 50.0, 800.0)
    val scenery = listOf(spare, box(ClubDecode.HANDS, 400.0, 500.0))
    val spareHere = box(ClubDecode.HEAD, 53.0, 801.0, score = 0.9) // IoU ≈ 0.68 with the stored spare
    val edgeCase = ClubBox(ClubDecode.HEAD, 0.8, 40.0, 790.0, 60.0, 810.0 + 20.0 / 3) // IoU exactly 0.75 ≥ 0.5 too
    val shaftHere = box(ClubDecode.SHAFT, 50.0, 800.0) // same place, other class
    val hands = box(ClubDecode.HANDS, 400.0, 500.0)
    val swung = box(ClubDecode.HEAD, 420.0, 760.0, score = 0.2)
    val kept = ClubRules.dropScenery(listOf(spareHere, edgeCase, shaftHere, hands, swung), scenery)
    assertEquals(listOf(shaftHere, hands, swung), kept)
    // IoU just under 0.5 survives
    val half = box(ClubDecode.HEAD, 50.0 + 20.0 / 3 + 0.1, 800.0) // IoU < 0.5
    assertTrue(ClubDecode.iou(half, spare) < 0.5)
    assertEquals(listOf(half), ClubRules.dropScenery(listOf(half), scenery))
    // the head is the swung one, not the (more confident) spare club
    val grip = Pt(400f, 500f)
    assertEquals(53.0, ClubRules.head(listOf(spareHere, swung), grip, null)!!.x, 1e-9) // unfiltered: the spare club
    val h = ClubRules.head(kept, grip, 2.0)!!
    assertEquals(Pair(420.0, 760.0), Pair(h.x, h.y))
    // no scenery: the same list back
    val all = listOf(spareHere, swung)
    assertSame(all, ClubRules.dropScenery(all, emptyList()))
  }

  // --- on demand entries --------------------------------------------------------------------

  @Test
  fun anOnDemandEntryIsInDisplayPxWithSceneryDroppedAndTheSameShapeAsPass2() {
    // 1080 × 1920 portrait: 640 units → x × 1.6875, y × 3
    val sx = 1080 / 640.0
    val sy = 1920 / 640.0
    val head640 = ClubBox(ClubDecode.HEAD, 0.61234, 300.0, 300.0, 310.0, 310.0) // centre (305, 305) → (514.6875, 915)
    val spare640 = ClubBox(ClubDecode.HEAD, 0.9, 20.0, 260.0, 30.0, 270.0)
    val spareDisp = spare640.scaled(sx, sy)
    val e = ClubOnDemand.entry(listOf(spare640, head640), sx, sy, Pt(540f, 700f), 2.0, listOf(spareDisp))
    assertEquals(setOf("head", "hidden", "conf", "source", "boxes"), e.keys)
    assertEquals("model", e["source"])
    assertEquals(false, e["hidden"])
    assertEquals(0.612, e["conf"])
    @Suppress("UNCHECKED_CAST")
    val hd = e["head"] as List<Double>
    assertEquals(305 * sx, hd[0], 1e-9)
    assertEquals(305 * sy, hd[1], 1e-9)
    @Suppress("UNCHECKED_CAST")
    val boxes = e["boxes"] as List<Map<String, Any?>>
    assertEquals(1, boxes.size)
    assertEquals("head", boxes[0]["cls"])
    assertEquals(listOf(300 * sx, 300 * sy, 310 * sx, 310 * sy), boxes[0]["box"])
    // without the scenery the more confident spare club wins (swings analysed before apiVersion 5)
    val unfiltered = ClubOnDemand.entry(listOf(spare640, head640), sx, sy, Pt(540f, 700f), null, emptyList())
    assertEquals(25 * sx, (unfiltered["head"] as List<*>)[0] as Double, 1e-9)
    // nothing found: no head, null source and conf, the boxes still there
    val none = ClubOnDemand.entry(listOf(ClubBox(ClubDecode.HANDS, 0.5, 0.0, 0.0, 10.0, 10.0)), sx, sy, null, null, emptyList())
    assertEquals(mapOf("head" to null, "hidden" to false, "conf" to null, "source" to null), none - "boxes")
    assertEquals(1, (none["boxes"] as List<*>).size)
    // a pass-2 entry from the same boxes is the same map
    assertEquals(ClubRules.frameEntry(listOf(head640.scaled(sx, sy)), Pt(540f, 700f), 2.0), ClubOnDemand.entry(listOf(head640), sx, sy, Pt(540f, 700f), 2.0, emptyList()))
  }

  @Test
  fun sceneryFromTheJsIsParsedAndMalformedOnesAreSkipped() {
    assertEquals(ClubBox(ClubDecode.SHAFT, 0.4, 1.0, 2.0, 3.0, 4.0), ClubOnDemand.sceneryBox("shaft", listOf(1.0, 2.0, 3.0, 4.0), 0.4))
    assertEquals(0.0, ClubOnDemand.sceneryBox("head", listOf(1.0, 2.0, 3.0, 4.0), null)!!.score, 0.0)
    assertNull(ClubOnDemand.sceneryBox("ball", listOf(1.0, 2.0, 3.0, 4.0), 0.4))
    assertNull(ClubOnDemand.sceneryBox("head", listOf(1.0, 2.0, 3.0), 0.4))
    assertNull(ClubOnDemand.sceneryBox("head", listOf(1.0, Double.NaN, 3.0, 4.0), 0.4))
  }

  private class FakeModel(val boxes: (ByteArray) -> List<ClubBox>) : ClubModel {
    override val delegate = "gpu"
    var closed = false
    override fun detect(rgb: ByteArray) = boxes(rgb)
    override fun close() {
      closed = true
    }
  }

  @Test
  fun detectClubAnswersPerFrameAFailedFrameCarriesItsErrorAndTheOthersStillAnswer() {
    var opens = 0
    val warm = ClubWarm({ opens++; FakeModel { rgb -> if (rgb[0] == 1.toByte()) throw IllegalStateException("interpreter") else listOf(ClubBox(ClubDecode.HEAD, 0.5, 300.0, 300.0, 310.0, 310.0)) } }, IdleScheduler { _, _ -> {} })
    val stills = mapOf(
      "file:///s/10.jpg" to ClubStill(ByteArray(3) { 0 }, 540, 960), // a decimated still: its size does not matter
      "file:///s/11.jpg" to ClubStill(ByteArray(3) { 1 }, 1080, 1920),
    )
    val req = ClubDemand(
      frames = listOf(ClubFrameSpec(10, "file:///s/10.jpg", Pt(0.5f, 0.4f)), ClubFrameSpec(11, "file:///s/11.jpg", null), ClubFrameSpec(12, "file:///s/12.jpg", null)),
      width = 1080.0, height = 1920.0, pxPerCm = 2.0, scenery = emptyList(),
    )
    var now = 0L
    val out = ClubOnDemand.run(req, warm, decode = { stills[it] ?: throw IllegalArgumentException("no still at $it") }, clock = { now += 5; now })
    assertEquals(setOf("frames", "timings"), out.keys)
    @Suppress("UNCHECKED_CAST")
    val frames = out["frames"] as Map<String, Map<String, Any?>>
    assertEquals(listOf("10", "11", "12"), frames.keys.toList())
    assertEquals("model", frames.getValue("10")["source"])
    assertEquals(listOf(305 * 1080 / 640.0, 305 * 1920 / 640.0), frames.getValue("10")["head"])
    assertNull(frames.getValue("10")["error"])
    for ((k, why) in listOf("11" to "interpreter", "12" to "no still at file:///s/12.jpg")) {
      val e = frames.getValue(k)
      assertEquals(why, e["error"])
      assertNull(e["head"])
      assertNull(e["source"])
      assertEquals(false, e["hidden"])
      assertEquals(emptyList<Any>(), e["boxes"])
    }
    @Suppress("UNCHECKED_CAST")
    val t = out["timings"] as Map<String, Any?>
    assertEquals(setOf("openMs", "inferMs", "decodeMs", "delegate", "warm"), t.keys)
    assertEquals("gpu", t["delegate"])
    assertEquals(false, t["warm"])
    // the second call: warm, nothing opened again; frames [] only warms
    val again = ClubOnDemand.run(ClubDemand(emptyList(), 1.0, 1.0, null, emptyList()), warm, decode = { error("unused") }, clock = { 0L })
    assertEquals(emptyMap<String, Any?>(), again["frames"])
    assertEquals(true, (again["timings"] as Map<*, *>)["warm"])
    assertEquals(1, opens)
  }

  @Test
  fun aDetectorThatCannotOpenThrowsOnceAndLeavesNothingOpen() {
    val warm = ClubWarm<FakeModel>({ throw UnsatisfiedLinkError("no libtensorflowlite_jni") }, IdleScheduler { _, _ -> {} })
    val req = ClubDemand(listOf(ClubFrameSpec(1, "x", null)), 10.0, 10.0, null, emptyList())
    try {
      ClubOnDemand.run(req, warm, decode = { error("unused") }, clock = { 0L })
      throw AssertionError("expected a throw")
    } catch (e: UnsatisfiedLinkError) {
      assertEquals("no libtensorflowlite_jni", e.message)
    }
    assertTrue(!warm.isOpen)
  }

  @Test
  fun pass2StillMergesThroughTheSharedFrameEntry() {
    val head = box(ClubDecode.HEAD, 400.0, 900.0, score = 0.5)
    val out = ClubRules.merge(base, mapOf(160 to listOf(head)), mapOf(160 to Pt(400f, 700f)), 2.0)
    assertEquals(ClubRules.frameEntry(listOf(head), Pt(400f, 700f), 2.0), out.getValue("160"))
  }
}
