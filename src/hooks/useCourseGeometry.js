import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  findCourseGeometry, subscribeCourseGeometry, getCourseGeometryVersion,
} from '../lib/geo';
import { ensureCourseGeometry } from '../store/courseGeometryStore';

// The geometry entry for a course name, re-resolved whenever geo.js changes,
// and a request for that course's holes/hazards/greens if they aren't loaded
// yet (they load on demand — see courseGeometryStore). The entry may be
// index-only (no holes/greens) until then.
export function useCourseGeometry(courseName) {
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  useEffect(() => {
    if (courseName) ensureCourseGeometry(courseName);
  }, [courseName]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => findCourseGeometry(courseName), [courseName, geomVersion]);
}
