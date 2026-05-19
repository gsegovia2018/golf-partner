// Pure helpers for applying a course-picker result to a setup-stage round.
// Shared by SetupScreen and OfficialCreateScreen so the two wizards behave
// identically. No I/O — unit-tested in isolation.

function deepHoles(holes) { return (holes || []).map((h) => ({ ...h })); }
function deepTees(tees) { return (tees || []).map((t) => ({ ...t })); }

// Course-derived fields, set whenever a round resolves to a concrete course.
// Deep-copies holes/tees so later edits never mutate the library's objects.
function courseFields(course) {
  return {
    courseId: course.id,
    courseName: course.name,
    holes: deepHoles(course.holes),
    tees: deepTees(course.tees),
    slope: course.slope ?? null,
    courseRating: course.rating ?? null,
    playerHandicaps: null,
    playerTees: null,
  };
}

// Apply a course-picker pick to a round. A 'course' pick resolves the round
// immediately; a 'club' pick leaves it unresolved (empty courseName) with the
// club's layouts attached for the layout dropdown.
export function applyCoursePick(round, pick) {
  if (pick.kind === 'course') {
    return {
      ...round,
      ...courseFields(pick.course),
      club: null, clubLayouts: null, layoutId: null,
    };
  }
  // pick.kind === 'club'
  return {
    ...round,
    club: { id: pick.club.id, name: pick.club.name },
    clubLayouts: pick.layouts,
    layoutId: null,
    courseId: null,
    courseName: '',
    holes: [],
    tees: [],
    playerHandicaps: null,
    playerTees: null,
  };
}

// Apply a layout choice (a course object) to a club-pending round, resolving
// it. `club` and `clubLayouts` are kept so the layout can be changed later.
export function applyLayoutChoice(round, layoutCourse) {
  return { ...round, ...courseFields(layoutCourse), layoutId: layoutCourse.id };
}
