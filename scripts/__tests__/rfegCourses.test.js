const {
  regionForPostalCode, teeLabel, parseOptionText, parseClubPage, skipReason,
  courseName, findExisting, holesKey, siKey, stableUuid,
} = require('../lib/rfegCourses');

const PARS = [5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4, 5, 3, 4];
const MEN_SI = [2, 12, 16, 8, 6, 10, 14, 18, 4, 5, 7, 1, 13, 17, 9, 11, 15, 3];
const WOMEN_SI = [2, 10, 14, 12, 4, 8, 16, 18, 6, 1, 7, 9, 17, 13, 11, 5, 15, 3];

// One row in the federation layout: 9 holes, IDA sum, 9 holes, VUELTA, TOTAL.
const row = (label, cells) => {
  const td = (v) => `<td>${v}</td>`;
  const sum = '<td class="holes-table-col-suma">0</td>';
  return `<tr><td class="holes-table-col-label">${label}</td>${cells.slice(0, 9).map(td).join('')}${sum}`
    + `${cells.slice(9).map(td).join('')}${sum}${sum}</tr>`;
};
const panel = (id, si, metres, vc, vs) => `<div class="holes-table-panel" id="${id}" style="display:none">`
  + `<table class="holes-table"><tbody>${row('Par', PARS)}${row('Hdcp', si)}${row('Metros', metres)}</tbody></table>`
  + `<div class="holes-table-footer"><span>Vc: ${vc}</span><span>Vs: ${vs}</span></div></div>`;

const long = PARS.map(() => 350);
const short = PARS.map(() => 300);
const PAGE = `<h1 class="x">Aloha Golf</h1>
<iframe title="Urb. Aloha Golf, S/n, 29660 Marbella, M&aacute;laga, Espa&ntilde;a"></iframe>
<select class="holes-table-dropdown">
<option value="rcpanel_1_0_0">ALOHA - Aloha - AMARILLAS (F) 🟡</option>
<option value="rcpanel_1_0_1">ALOHA - Aloha - AMARILLAS (M) 🟡</option>
<option value="rcpanel_1_0_2">ALOHA - Aloha - BLANCAS (M) ⚪</option>
</select>
${panel('rcpanel_1_0_0', WOMEN_SI, short, '77.6', '139')}
${panel('rcpanel_1_0_1', MEN_SI, short, '71.5', '132')}
${panel('rcpanel_1_0_2', MEN_SI, long, '73.1', '-')}`;

describe('regionForPostalCode', () => {
  test('maps the province prefix to the autonomous community', () => {
    expect(regionForPostalCode('29660')).toBe('Andalusia');
    expect(regionForPostalCode('08190')).toBe('Catalonia');
    expect(regionForPostalCode('38660')).toBe('Canary Islands');
  });

  test('returns null for anything that is not a Spanish postal code', () => {
    expect(regionForPostalCode('AD700')).toBeNull();
    expect(regionForPostalCode('99000')).toBeNull();
    expect(regionForPostalCode(null)).toBeNull();
  });
});

test('teeLabel capitalises like the existing Spanish tees', () => {
  expect(teeLabel('AMARILLAS')).toBe('Amarillas');
  expect(teeLabel(' AZUL CLARO ')).toBe('Azul claro');
});

test('parseOptionText splits recorrido, tee and sex', () => {
  expect(parseOptionText('LA CALA - Campo Asia - ROJAS (F) 🔴'))
    .toEqual({ recorrido: 'LA CALA - Campo Asia', tee: 'ROJAS', sex: 'F' });
  expect(parseOptionText('no tee here')).toBeNull();
});

describe('parseClubPage', () => {
  const club = parseClubPage(PAGE);

  test('reads the club name, postal code, city and region', () => {
    expect(club).toMatchObject({ name: 'Aloha Golf', postalCode: '29660', city: 'Marbella', region: 'Andalusia' });
  });

  test('drops company suffixes from the club name', () => {
    expect(parseClubPage('<h1>Islantilla Golf Resort, S.l</h1>').name).toBe('Islantilla Golf Resort');
    expect(parseClubPage('<h1>Club de Golf Soria S.a.</h1>').name).toBe('Club de Golf Soria');
  });

  test('prefers the contact block postal code; the town only comes from the map title', () => {
    const contact = '<h2>Ubicación y Contacto</h2><p>Autovia A7 Km 150</p><p>29680</p><p>Malaga</p>';
    expect(parseClubPage(`<h1>Estepona Golf</h1>${contact}`))
      .toMatchObject({ postalCode: '29680', city: null, region: 'Andalusia' });
    expect(parseClubPage(PAGE.replace('<select', `${contact}<select`)))
      .toMatchObject({ postalCode: '29680', city: null });
  });

  test('takes holes from a men\'s panel, not the women\'s stroke index', () => {
    const [r] = club.recorridos;
    expect(r.recorrido).toBe('ALOHA - Aloha');
    expect(r.holes.map((h) => h.par)).toEqual(PARS);
    expect(r.holes.map((h) => h.strokeIndex)).toEqual(MEN_SI);
  });

  test('merges men and women into one row per colour, longest first', () => {
    const [r] = club.recorridos;
    expect(r.tees.map((t) => t.label)).toEqual(['Blancas', 'Amarillas']);
    expect(r.tees[1]).toMatchObject({ rating: 71.5, slope: 132, ratingWomen: 77.6, slopeWomen: 139 });
    expect(r.tees[1].yardages[18]).toBe(300);
  });

  test('an unrated value reads as null', () => {
    expect(club.recorridos[0].tees[0]).toMatchObject({ rating: 73.1, slope: null });
  });
});

describe('skipReason', () => {
  const [r] = parseClubPage(PAGE).recorridos;

  test('keeps a complete, rated layout', () => {
    expect(skipReason(r)).toBeNull();
  });

  test('skips temporary and competition set-ups but keeps look-alike real layouts', () => {
    for (const name of ['VILLAITANA SENIORS FGCV', 'PEDREÑA PROV.  H 12', 'ABAMA  H6',
      'RCG TENERIFE PROVISIONAL H 11', 'SOTOVERDE Cto España Benjamin CyL', 'DESERT SPRINGS - Alternativo',
      'CAMPO LA SELLA  R & A STUDENT TOUR SERIES', 'GOLF DEL SUR VERANO 2026', 'LA CAÑADA - Provisional obras H17']) {
      expect(skipReason({ ...r, recorrido: name })).toMatch(/temporary/);
    }
    for (const name of ['CAMIRAL TOUR', 'CAMIRAL- A Stadium + B Tour', 'CALDES - Combinacion',
      'LAURO - Pequecircuito', 'CERRADA RIOSECO', 'LA CALA - Campo Asia']) {
      expect(skipReason({ ...r, recorrido: name })).toBeNull();
    }
  });

  test('skips broken stroke indexes and unrated layouts', () => {
    expect(skipReason({ ...r, holes: r.holes.map((h) => ({ ...h, strokeIndex: 1 })) })).toMatch(/stroke/);
    expect(skipReason({ ...r, tees: [{ rating: 70, slope: null }] })).toBe('no rated tee');
  });
});

test('courseName appends the layout only for multi-layout clubs', () => {
  expect(courseName('Aloha Golf', 'ALOHA - Aloha', 1)).toBe('Aloha Golf');
  expect(courseName('Aloha Golf', 'ALOHA - P&P', 2)).toBe('Aloha Golf — P&P');
  expect(courseName('Santa Elena', 'HACIENDA ALAMO  B + B', 2)).toBe('Santa Elena — Hacienda Alamo B + B');
  expect(courseName('Santa Ponsa', 'SANTA PONSA - Santa Ponsa III', 2)).toBe('Santa Ponsa — Santa Ponsa III');
  expect(courseName('León', 'LEON GOLF-PROSACYR', 2)).toBe('León — Leon Golf-Prosacyr');
});

describe('findExisting', () => {
  const [r] = parseClubPage(PAGE).recorridos;
  const pars = holesKey(r.holes);

  test('matches identical par and stroke index whatever the name', () => {
    const hit = { name: 'Something else', pars, si: siKey(r.holes) };
    expect(findExisting(r, 'Aloha Golf', [hit])).toBe(hit);
  });

  test('matches same par plus a shared name word when the stroke index changed', () => {
    const hit = { name: 'Aloha Golf Club', pars, si: '1,2,3' };
    expect(findExisting(r, 'Aloha Golf', [hit])).toBe(hit);
  });

  test('matches a stale library scorecard: two holes off, or the nines swapped', () => {
    const twoOff = { name: 'Aloha', pars: `44${pars.slice(2)}`, si: '' };
    expect(findExisting(r, 'Aloha Golf', [twoOff])).toBe(twoOff);
    const swapped = { name: 'Aloha', pars: pars.slice(9) + pars.slice(0, 9), si: '' };
    expect(findExisting(r, 'Aloha Golf', [swapped])).toBe(swapped);
  });

  test('tolerates a one-letter spelling difference in a longer name word', () => {
    const peralada = { name: 'Peralada Golf', pars, si: '1,2,3' };
    expect(findExisting(r, 'Golf Club Perelada', [peralada])).toBe(peralada);
  });

  test('does not match on par alone, a layout word, or a name with different pars', () => {
    expect(findExisting(r, 'Aloha Golf', [{ name: 'Golf Club', pars, si: '1,2,3' }])).toBeNull();
    expect(findExisting(r, 'Aloha Golf', [{ name: 'Aloha', pars: '4'.repeat(18), si: '' }])).toBeNull();
    const school = { name: 'Escuela de la Real Federación de Golf Madrid — P&P', pars, si: '1,2,3' };
    expect(findExisting(r, 'Escuela Pública de Golf de Villanueva de la Serena', [school])).toBeNull();
    const p3 = { ...r, recorrido: 'VALDERRAMA - Pares 3' };
    expect(findExisting(p3, 'Real Club Valderrama', [{ name: 'Forus — Pares 3', pars, si: '1,2,3' }])).toBeNull();
  });
});

test('stableUuid is deterministic and uuid-shaped', () => {
  expect(stableUuid('a')).toBe(stableUuid('a'));
  expect(stableUuid('a')).not.toBe(stableUuid('b'));
  expect(stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
