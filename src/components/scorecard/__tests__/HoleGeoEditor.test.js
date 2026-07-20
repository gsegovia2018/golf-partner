import React from 'react';
import { render } from '@testing-library/react-native';
import { HoleGeoEditor } from '../HoleGeoEditor';

// The map itself is a WebView/iframe — out of scope for this test. Capture the
// data prop so we can assert which hole's points the editor seeded.
let lastMapData = null;
jest.mock('../HoleMapView', () => ({
  HoleMapView: (props) => { lastMapData = props.data; return null; },
}));

const HOLES = {
  1: { greenFront: [38.10, -0.10], greenCenter: [38.11, -0.11], greenBack: [38.12, -0.12], start: [38.13, -0.13], green: [], hazards: [] },
  5: { greenFront: [38.50, -0.50], greenCenter: [38.51, -0.51], greenBack: [38.52, -0.52], start: [38.53, -0.53], green: [], hazards: [] },
};

jest.mock('../../../lib/geo', () => ({
  holeFeatures: (courseName, holeNumber) => HOLES[holeNumber] ?? null,
  findCourseGeometry: () => ({ key: 'course-1' }),
  subscribeCourseGeometry: () => () => {},
  getCourseGeometryVersion: () => 1,
}));
jest.mock('../../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../../store/courseGeometryStore', () => ({ hydrateCourseGeometry: jest.fn() }));
jest.mock('../../../store/tileCache', () => ({ courseKeyFor: (name) => `key:${name}` }));

const baseProps = { courseName: 'Lomas Bosque', onClose: jest.fn(), onSaved: jest.fn() };

describe('HoleGeoEditor point seeding', () => {
  beforeEach(() => { lastMapData = null; });

  it('seeds points for the hole being edited, not the first mounted hole', () => {
    // Mirrors HoleView: the editor mounts hidden on hole 1, then the user
    // swipes to hole 5 and taps edit.
    const { rerender } = render(<HoleGeoEditor {...baseProps} visible={false} holeNumber={1} />);
    rerender(<HoleGeoEditor {...baseProps} visible holeNumber={5} />);

    expect(lastMapData.greenFront).toEqual(HOLES[5].greenFront);
    expect(lastMapData.greenCenter).toEqual(HOLES[5].greenCenter);
    expect(lastMapData.greenBack).toEqual(HOLES[5].greenBack);
    expect(lastMapData.tee).toEqual(HOLES[5].start);
  });

  it('re-seeds when reopened on a different hole', () => {
    const { rerender } = render(<HoleGeoEditor {...baseProps} visible holeNumber={1} />);
    expect(lastMapData.greenCenter).toEqual(HOLES[1].greenCenter);

    rerender(<HoleGeoEditor {...baseProps} visible={false} holeNumber={1} />);
    rerender(<HoleGeoEditor {...baseProps} visible holeNumber={5} />);

    expect(lastMapData.greenCenter).toEqual(HOLES[5].greenCenter);
    expect(lastMapData.tee).toEqual(HOLES[5].start);
  });
});
