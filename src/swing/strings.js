// All copy of the swing analyzer in one module (plan 5.7, D1). The app has no i18n
// layer, so a later translation is a one-file change. English only.

const r0 = (v) => Math.round(v);

export const SWING_STRINGS = {
  privacy: 'Your video and analysis stay on this phone. Nothing is uploaded.',
  approximate: 'approx.',
  statusWord: { green: 'Good', yellow: 'Watch', red: 'Fix', unknown: 'Hidden' },

  // D12: what the processing screen says when analyze() returns { error }.
  errors: {
    no_pose: 'No golfer found. Keep your whole body in frame.',
    partial_pose: 'Part of the swing could not be tracked. Film again with your whole body in frame, from behind.',
    too_long: 'This clip is too long. Trim the video to the swing.',
  },

  checkpoint: {
    address: 'Address', takeaway: 'Takeaway', leadArm: 'Lead arm', top: 'Top', transition: 'Transition',
    shaftDown: 'Shaft down', impact: 'Impact', trailArm: 'Trail arm', finish: 'Finish',
    lateBackswing: 'Late backswing', preImpact: 'Pre-impact', postImpact: 'Post-impact',
  },

  phase: { setup: 'Setup', backswing: 'Backswing', transition: 'Transition', impact: 'Impact', finish: 'Finish' },

  checkLabel: {
    posture_address: 'Posture at address',
    hands_between_planes: 'Hands between the planes',
    butt_extension: 'Butt end points at the ball',
    top_direction: 'Shaft direction at the top',
    downswing_path: 'Downswing path',
    clubhead_vs_plane: 'Clubhead on the plane',
    hands_height_impact: 'Hands height at impact',
    hands_out_impact: 'Hands toward the ball at impact',
    shaft_angle_impact: 'Shaft angle at impact',
    spine_loss: 'Spine angle kept',
    hip_drift: 'Hips hold their line',
    head_drift: 'Head stays put',
    tempo: 'Tempo',
    finish_balance: 'Finish balance',
  },

  fault: {
    early_extension: 'Early extension',
    over_the_top: 'Over the top',
    steep_backswing: 'Steep backswing',
    flat_backswing: 'Flat backswing',
    across_the_line: 'Across the line',
    laid_off: 'Laid off',
    head_sway: 'Head sway',
    tempo_fast: 'Rushed tempo',
    tempo_slow: 'Slow tempo',
    balance: 'Finish balance',
    posture: 'Posture at address',
  },

  // Reasons a check has no verdict ('unknown'), shown instead of a value.
  reason: {
    nopose: (what) => `Needs pose at ${what}`,
    nodata: (what) => what,
    hidden: (where) => `Clubhead hidden at ${where}`,
    unplaced: (where) => `Place the clubhead at ${where}`,
  },

  checkText: {
    posture_address: (t) => `Spine tilt ${r0(t)}° from vertical (25–40° is good)`,
    hands_between_planes_ok: 'Hands travel between shaft and shoulder planes',
    hands_between_planes: (cm, dir, where) =>
      `Hands ${r0(cm)} cm ${dir === 'steep' ? 'outside the shoulder plane (steep)' : 'inside the shaft plane (flat)'} at ${where}`,
    butt_extension_ok: 'Butt-end line lands between toes and ball',
    butt_extension_flat: (cm) => `Butt-end line lands ${r0(cm)} cm beyond the ball (flat)`,
    butt_extension_steep: (cm) => `Butt-end line lands ${r0(cm)} cm inside the toes (steep)`,
    top_direction_ok: 'Shaft points near the target line',
    top_direction_across: 'Shaft crossed the line (points right)',
    top_direction_laid_off: 'Shaft laid off (points left)',
    downswing_path_ok: 'Hands drop on or inside the backswing path',
    downswing_path: (cm) => `Hands ${r0(cm)} cm outside the backswing path (over the top)`,
    clubhead_vs_plane_ok: 'Clubhead returns to the address plane',
    clubhead_vs_plane_steep: (cm) => `Clubhead ${r0(cm)} cm above the plane (steep)`,
    clubhead_vs_plane_under: (cm) => `Clubhead ${r0(cm)} cm under the plane`,
    hands_height_impact_up: (cm) => `Hands ${r0(cm)} cm higher than at address`,
    hands_height_impact_down: (cm) => `Hands ${r0(cm)} cm lower than at address`,
    hands_out_impact_in: (cm) => `Hands ${r0(cm)} cm closer to the ball line than at address`,
    hands_out_impact_out: (cm) => `Hands ${r0(cm)} cm further from the ball line than at address`,
    shaft_angle_impact_up: (deg) => `Shaft ${r0(deg)}° more upright than at address`,
    shaft_angle_impact_down: (deg) => `Shaft ${r0(deg)}° flatter than at address`,
    spine_loss: (from, to, loss) => `Spine tilt ${r0(from)}° → ${r0(to)}° (${r0(loss)}° lost)`,
    hip_drift: (cm) => `Trail hip ${r0(cm)} cm toward the ball`,
    head_drift: (cm) => `Head moved ${r0(cm)} cm from address`,
    tempo: (back, down, ratio) => `Backswing ${back} : downswing ${down} frames = ${ratio}:1 (2.5–3.5 is good)`,
    finish_balance: (quiet, balanced) => {
      if (quiet && balanced) return 'Held the finish, weight over the lead leg';
      if (quiet) return 'Held still, but weight is not over the lead leg';
      if (balanced) return 'Weight over the lead leg, but the finish was not held still';
      return 'Finish was not held still and weight is not over the lead leg';
    },
  },
};
