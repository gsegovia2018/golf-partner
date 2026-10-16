package expo.modules.golfswing

import kotlin.math.hypot

/** The clubhead one frame's boxes propose: [source] `model` (head box centre) or `model-shaft` (shaft-box corner). */
internal data class ClubHead(val x: Double, val y: Double, val source: String, val score: Double)

/**
 * Post-rules on the detector's boxes (plan 2026-10-16 §4.1, §4.2.3), ported from
 * tools/swing-lab/eval_yolo.py `drop_static` (`--frames checkpoints`) and `head_track` (with the
 * pose grip as the anchor). Display px throughout. Pure JVM so it can be unit-tested.
 */
internal object ClubRules {
  /**
   * A box present at ≥ this share of the checkpoint places is scenery (a spare club, a pole). 0.3,
   * not the lab's dense 0.5: on the 11 places L1 found 0.5 left part of a spare club on one clip,
   * 0.3 drops it and no true head (the swung head holds 2 places: address, impact).
   */
  const val STATIC_FRAC = 0.3
  const val STATIC_IOU = 0.5
  /** A head box farther than this from the grip is impossible (the shaft is ~105 cm). */
  const val MAX_HEAD_CM = 150.0
  /** Boxes per frame in the pass-2 output (most confident first). */
  const val MAX_BOXES = 10
  /** Scenery representatives stored per swing (`pass2.club.scenery`). */
  const val MAX_SCENERY = 20

  /** The place a checkpoint votes for: the head sits still around impact, so preImpact / impact / postImpact are one. */
  fun place(key: String) = if (key == "preImpact" || key == "postImpact") "impact" else key

  /**
   * Drops scenery: a box whose place (same class, IoU ≥ [minIou]) is occupied at ≥ [frac] of the
   * distinct places is not the swung club. Only the frames in [places] (frame → place) vote;
   * `hands` boxes are never dropped.
   */
  fun dropStatic(
    dets: Map<Int, List<ClubBox>>,
    places: Map<Int, String>,
    frac: Double = STATIC_FRAC,
    minIou: Double = STATIC_IOU,
  ): Map<Int, List<ClubBox>> = splitStatic(dets, places, frac, minIou).first

  /**
   * [dropStatic] that also returns what it removed: (kept, dropped), both frame → boxes, every
   * frame of [dets] in each (plan on demand §3.2: the dropped ones become `club.scenery`).
   */
  fun splitStatic(
    dets: Map<Int, List<ClubBox>>,
    places: Map<Int, String>,
    frac: Double = STATIC_FRAC,
    minIou: Double = STATIC_IOU,
  ): Pair<Map<Int, List<ClubBox>>, Map<Int, List<ClubBox>>> {
    val ref = places.filterKeys { it in dets }
    val n = ref.values.toSet().size
    if (n == 0) return Pair(dets, dets.mapValues { emptyList() })
    val all = ref.flatMap { (f, p) -> dets.getValue(f).map { p to it } }
    fun static(r: ClubBox) = all.filter { (_, o) -> o.cls == r.cls && ClubDecode.iou(o, r) >= minIou }.map { it.first }.toSet().size >= frac * n
    val split = dets.mapValues { (_, rows) -> rows.partition { it.cls == ClubDecode.HANDS || !static(it) } }
    return Pair(split.mapValues { it.value.first }, split.mapValues { it.value.second })
  }

  /**
   * The scenery one swing's static vote found, for frames that cannot vote (on demand §3.2): the
   * [dropped] boxes clustered (same class, IoU ≥ [minIou] with a kept representative → the same
   * thing; the highest score represents it), `hands` ignored, at most [max], most confident first.
   */
  fun scenery(dropped: Collection<ClubBox>, minIou: Double = STATIC_IOU, max: Int = MAX_SCENERY): List<ClubBox> {
    val reps = ArrayList<ClubBox>()
    for (b in dropped.filter { it.cls != ClubDecode.HANDS }.sortedByDescending { it.score }) {
      if (reps.size >= max) break
      if (reps.none { it.cls == b.cls && ClubDecode.iou(it, b) >= minIou }) reps += b
    }
    return reps
  }

  /** One frame's boxes without those matching a [scenery] box (same class, IoU ≥ [minIou]); `hands` always kept. */
  fun dropScenery(boxes: List<ClubBox>, scenery: List<ClubBox>, minIou: Double = STATIC_IOU): List<ClubBox> =
    if (scenery.isEmpty()) boxes
    else boxes.filter { b -> b.cls == ClubDecode.HANDS || scenery.none { it.cls == b.cls && ClubDecode.iou(it, b) >= minIou } }

  /**
   * The clubhead from one frame's (static-dropped) boxes. Anchor = the pose [grip], else the most
   * confident `hands` box. With an anchor and [pxPerCm], head boxes beyond [MAX_HEAD_CM] are
   * ignored. Head = centre of the most confident remaining `head` box; else the corner of the most
   * confident `shaft` box farthest from the anchor (the grip sits at the other end of its
   * diagonal); without an anchor no corner can be told from the grip, so none.
   */
  fun head(boxes: List<ClubBox>, grip: Pt?, pxPerCm: Double?): ClubHead? {
    val anchor = grip?.let { Pair(it.x.toDouble(), it.y.toDouble()) }
      ?: best(boxes, ClubDecode.HANDS)?.let { Pair(it.cx, it.cy) }
    val heads = boxes.filter {
      it.cls == ClubDecode.HEAD && (anchor == null || pxPerCm == null || hypot(it.cx - anchor.first, it.cy - anchor.second) <= MAX_HEAD_CM * pxPerCm)
    }
    best(heads, ClubDecode.HEAD)?.let { return ClubHead(it.cx, it.cy, "model", it.score) }
    val s = best(boxes, ClubDecode.SHAFT) ?: return null
    anchor ?: return null
    val corners = listOf(Pair(s.x1, s.y1), Pair(s.x2, s.y1), Pair(s.x1, s.y2), Pair(s.x2, s.y2))
    var far = corners[0]
    for (c in corners) if (hypot(c.first - anchor.first, c.second - anchor.second) > hypot(far.first - anchor.first, far.second - anchor.second)) far = c
    return ClubHead(far.first, far.second, "model-shaft", s.score)
  }

  /**
   * Pass-2 `shaft` entries (frame → entry), best source first (§4.2.4): a model head, else a
   * shaft-box corner, else the [base] entry (today's `edge` at address / impact, `prior`
   * elsewhere). [dets] = frame → display-px boxes after [dropStatic], null when the detector did
   * not run (a failure never fails pass 2): then [base] as it is. Every frame the detector ran on
   * carries its boxes (≤ [MAX_BOXES]) so the lab can re-score the phone without the phone.
   * [grips] = frame → the pose grip of that frame's checkpoint.
   */
  fun merge(
    base: Map<String, Map<String, Any?>>,
    dets: Map<Int, List<ClubBox>>?,
    grips: Map<Int, Pt?>,
    pxPerCm: Double?,
  ): Map<String, Map<String, Any?>> {
    if (dets == null) return base
    val out = LinkedHashMap(base)
    for ((f, boxes) in dets) {
      val k = f.toString()
      val e = frameEntry(boxes, grips[f], pxPerCm)
      out[k] = if (e["source"] != null) e else (out[k] ?: continue) + ("boxes" to e["boxes"])
    }
    return out
  }

  /**
   * One frame's entry from its display-px boxes (pass 2's [merge] and on demand):
   * `{ head: [x, y] | null, hidden: false, conf, source: 'model' | 'model-shaft' | null, boxes }`;
   * conf and source are null when [head] finds nothing. [boxes] ≤ [MAX_BOXES], as given.
   */
  fun frameEntry(boxes: List<ClubBox>, grip: Pt?, pxPerCm: Double?): Map<String, Any?> {
    val h = head(boxes, grip, pxPerCm)
    return mapOf(
      "head" to h?.let { listOf(it.x, it.y) }, "hidden" to false, "conf" to h?.let { round3(it.score) }, "source" to h?.source,
      "boxes" to boxJson(boxes.take(MAX_BOXES)),
    )
  }

  /** `[{ cls: 'shaft' | 'head' | 'hands', score, box: [x1, y1, x2, y2] }]`: pass 2's `boxes` and `club.scenery`. */
  fun boxJson(boxes: List<ClubBox>): List<Map<String, Any?>> =
    boxes.map { mapOf("cls" to ClubDecode.NAMES[it.cls], "score" to round3(it.score), "box" to listOf(it.x1, it.y1, it.x2, it.y2)) }

  private fun round3(v: Double) = Math.round(v * 1000) / 1000.0

  /** The most confident box of [cls] (the first on a tie, like Python's max). */
  private fun best(boxes: List<ClubBox>, cls: Int): ClubBox? {
    var b: ClubBox? = null
    for (r in boxes) if (r.cls == cls && (b == null || r.score > b.score)) b = r
    return b
  }
}
