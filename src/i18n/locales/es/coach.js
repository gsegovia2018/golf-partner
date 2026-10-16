// Spanish catalogue: Coach v2 (causes, swing link, weekly plan). See docs/i18n.md and its golf glossary.
// Cause sentences continue a lead-in (lead.likely / lead.consistent / lead.possible),
// so each body is a noun phrase that reads after "La mayor parte viene de",
// "Encaja con" and "Una posibilidad:".
export default {
  // ── Causes: lead-ins ───────────────────────────────────────────────────
  'stats.my.coach.cause.lead.likely': 'La mayor parte viene de',
  'stats.my.coach.cause.lead.consistent': 'Encaja con',
  'stats.my.coach.cause.lead.possible': 'Una posibilidad:',

  // ── Causes: putting ────────────────────────────────────────────────────
  'stats.my.coach.cause.putting.lag': 'putts desde {bucket} m que acaban en tres putts ({count} de {total}, {pct}%), con un promedio de {avgPutts} putts.',
  'stats.my.coach.cause.putting.lag.bench': 'putts desde {bucket} m que acaban en tres putts ({count} de {total}, {pct}%), con un promedio de {avgPutts} putts (un hándicap de {hcp} promedia {expected}).',
  'stats.my.coach.cause.putting.short': 'putts cortos desde {bucket} m, con un promedio de {avgPutts} putts en {total} intentos.',
  'stats.my.coach.cause.putting.short.bench': 'putts cortos desde {bucket} m, con un promedio de {avgPutts} putts en {total} intentos (un hándicap de {hcp} promedia {expected}).',
  'stats.my.coach.cause.putting.general.bench': 'el putt en general, con {per18} putts por cada 18 hoyos (un hándicap de {hcp} promedia {benchPer18}) y {threePutts} tres putts (promedio {benchThreePutts}).',

  // ── Causes: approach ───────────────────────────────────────────────────
  'stats.my.coach.cause.approach.short': 'golpes de aproximación desde {bucket} m que se quedan cortos ({count} de {total} fallos, {pct}%; el {missPct}% de las aproximaciones desde esa distancia no caen en el green).',
  'stats.my.coach.cause.approach.side': 'golpes de aproximación desde {bucket} m que fallan a la {side} ({count} de {total} fallos, {pct}%).',
  'stats.my.coach.cause.approach.side.cost': 'golpes de aproximación desde {bucket} m que fallan a la {side} ({count} de {total} fallos, {pct}%; un fallo a la {side} da {cost} puntos Stableford menos que uno en el green).',
  'stats.my.coach.cause.approach.bunker': 'golpes de aproximación desde {bucket} m que acaban en búnker ({count} de {total} fallos, {pct}%; tus salvados de arena son del {sandPct}% en {sandAttempts} intentos).',
  'stats.my.coach.cause.approach.distance': 'golpes de aproximación desde {bucket} m, que cuestan {cost} golpes cada uno en {shots} intentos.',
  'stats.my.coach.cause.approach.distance.bench': 'golpes de aproximación desde {bucket} m, que cuestan {cost} golpes cada uno en {shots} intentos (más de lo que suele perder un hándicap de {hcp}).',

  // ── Causes: off the tee ────────────────────────────────────────────────
  'stats.my.coach.cause.tee.trouble.driver': 'salidas que acaban en búnker o en zona difícil ({count} de {total}, {pct}%).',
  'stats.my.coach.cause.tee.penalty.driver': 'salidas con el driver que acaban en penalización ({count} de {total} hoyos, {pct}%).',
  'stats.my.coach.cause.tee.penalty.driver.bench': 'salidas con el driver que acaban en penalización ({count} de {total} hoyos, {pct}%; un hándicap de {hcp} promedia el {benchPct}%).',
  'stats.my.coach.cause.tee.side': 'salidas que fallan a la {side} ({count} de {misses} fallos, {pct}% de todas las salidas).',
  'stats.my.coach.cause.tee.side.bench': 'salidas que fallan a la {side} ({count} de {misses} fallos, {pct}% de todas las salidas; un hándicap de {hcp} falla así el {benchPct}%).',
  'stats.my.coach.cause.tee.distance.bench': 'salidas cortas: {distance} m frente a {benchDistance} m para un hándicap de {hcp}, en {drives} salidas.',

  // ── Causes: short game and penalties ───────────────────────────────────
  'stats.my.coach.cause.short.sand': 'salvados de arena ({sandPct}% en {sandAttempts} intentos, frente al {nonSandPct}% desde otras posiciones en {nonSandAttempts} intentos).',
  'stats.my.coach.cause.short.chip.bench': 'up & down ({pct}% en {attempts} intentos, frente al {expectedPct}% esperado para un hándicap de {hcp}).',
  'stats.my.coach.cause.penalty.tee': 'penalizaciones desde la salida ({count} de tus {total} penalizaciones).',
  'stats.my.coach.cause.penalty.tee.bench': 'penalizaciones desde la salida ({count} de tus {total} penalizaciones, {perRound} por vuelta frente a {benchPerRound} de un hándicap de {hcp}).',
  'stats.my.coach.cause.penalty.other': 'penalizaciones en otros golpes ({count} de tus {total} penalizaciones).',
  'stats.my.coach.cause.penalty.other.bench': 'penalizaciones en otros golpes ({count} de tus {total} penalizaciones, {perRound} por vuelta frente a {benchPerRound} de un hándicap de {hcp}).',

  // ── Swing link ─────────────────────────────────────────────────────────
  'stats.my.coach.swing.linked.consistent': 'Tu swing con el {club} grabado el {date} muestra {fault}, el fallo que suele provocar esto.',
  'stats.my.coach.swing.linked.possible': 'Tu swing con el {club} grabado el {date} podría mostrar {fault}, que a veces provoca esto.',
  'stats.my.coach.swing.stale.consistent': 'Tu swing con el {club} grabado el {date} mostró {fault}, pero ya es antiguo.',
  'stats.my.coach.swing.stale.possible': 'Tu swing con el {club} grabado el {date} pudo mostrar {fault}, pero ya es antiguo.',
  'stats.my.coach.swing.wrongClub': 'Tu último swing es con el {lastClub}. Graba uno con el {club} para comprobarlo.',
  'stats.my.coach.swing.none': 'Todavía no hay ningún swing grabado con el {club}.',
  'stats.my.coach.swing.swingOnly': 'Tu swing con el {club} grabado el {date} mostró {fault}. No está ligado a este fallo, pero merece una mirada.',
  'stats.my.coach.swing.secondSignal': 'El mismo swing también muestra {fault}, que puede sumarse a este fallo.',
  'stats.my.coach.swing.cta.record': 'Graba un swing con el {club}',

  // ── Weekly plan: areas and sessions ────────────────────────────────────
  'stats.my.coach.plan.area.offTheTee': 'Salidas',
  'stats.my.coach.plan.area.approach': 'Approach',
  'stats.my.coach.plan.area.aroundGreen': 'Juego corto',
  'stats.my.coach.plan.area.putting': 'Putts',
  'stats.my.coach.plan.area.penalties': 'Penalizaciones',
  'stats.my.coach.plan.session.range': {
    one: 'Campo de prácticas, {minutes} min, {count} ejercicio',
    other: 'Campo de prácticas, {minutes} min, {count} ejercicios',
  },
  'stats.my.coach.plan.session.shortGame': {
    one: 'Juego corto, {minutes} min, {count} ejercicio',
    other: 'Juego corto, {minutes} min, {count} ejercicios',
  },
  'stats.my.coach.plan.session.putting': {
    one: 'Putts, {minutes} min, {count} ejercicio',
    other: 'Putts, {minutes} min, {count} ejercicios',
  },
  'stats.my.coach.plan.session.course': {
    one: 'En el campo, {minutes} min, {count} ejercicio',
    other: 'En el campo, {minutes} min, {count} ejercicios',
  },

  // ── Weekly plan: why a session is there ────────────────────────────────
  'stats.my.coach.plan.why.focus': '{area} es tu foco, la mayor fuga ahora mismo.',
  'stats.my.coach.plan.why.tie': '{area} está igualada con la segunda fuga, así que recibe el mismo tiempo.',
  'stats.my.coach.plan.why.second': '{area} es la segunda mayor fuga.',
  'stats.my.coach.plan.why.keep': '{area} ya te ayuda, así que recibe menos tiempo.',
  'stats.my.coach.plan.why.swing': 'Trabajo de swing junto a {area}, por el fallo que muestra tu swing.',
  'stats.my.coach.plan.why.collect.insufficient': 'Aún no hay datos suficientes para elegir un foco.',
  'stats.my.coach.plan.why.collect.noLeak': 'Aún no hay una fuga clara, así que esta semana toca reunir datos.',

  // ── Weekly plan: the on-course task for the next round ─────────────────
  'stats.my.coach.plan.course.putting.lag': 'En el campo, anota cada putt desde {bucket} m y cuenta los tres putts.',
  'stats.my.coach.plan.course.putting.short': 'En el campo, anota cada putt desde {bucket} m y cuenta los que fallas.',
  'stats.my.coach.plan.course.putting.general': 'En el campo, cuenta tus putts en cada hoyo.',
  'stats.my.coach.plan.course.approach.short': 'En el campo, anota cada aproximación desde {bucket} m que se queda corta.',
  'stats.my.coach.plan.course.approach.bunker': 'En el campo, anota cada aproximación desde {bucket} m que acaba en búnker.',
  'stats.my.coach.plan.course.approach.distance': 'En el campo, anota el palo y el resultado de cada aproximación desde {bucket} m.',
  'stats.my.coach.plan.course.approach.side': 'En el campo, anota cada aproximación desde {bucket} m que falla a la {side}.',
  'stats.my.coach.plan.course.tee.trouble': 'En el campo, anota cada salida que acaba en búnker o en zona difícil.',
  'stats.my.coach.plan.course.tee.distance': 'En el campo, anota la distancia de cada salida y si quedó en calle.',
  'stats.my.coach.plan.course.tee.side': 'En el campo, anota cada salida que falla a la {side}.',
  'stats.my.coach.plan.course.short.sand': 'En el campo, anota cada golpe desde búnker y si saliste con up & down.',
  'stats.my.coach.plan.course.short.chip': 'En el campo, anota cada chip y si lo resolviste con up & down.',
  'stats.my.coach.plan.course.penalty.tee': 'Antes de cada salida, di en voz alta la zona que quieres evitar.',
  'stats.my.coach.plan.course.penalty.other': 'En el campo, elige la opción segura antes de cada golpe que pueda costar una penalización.',
  'stats.my.coach.plan.course.area.offTheTee': 'En el campo, anota dónde acaba cada salida.',
  'stats.my.coach.plan.course.area.approach': 'En el campo, anota la distancia y el resultado de cada aproximación.',
  'stats.my.coach.plan.course.area.aroundGreen': 'En el campo, anota si cada chip o golpe de búnker sale con up & down.',
  'stats.my.coach.plan.course.area.putting': 'En el campo, cuenta tus putts en cada green.',
  'stats.my.coach.plan.course.area.penalties': 'En el campo, di qué zona evitas antes de cada golpe que pueda costar una penalización.',
  'stats.my.coach.plan.course.collect': 'En el campo, anota tus golpes con detalle para que el próximo plan tenga datos.',

  // ── Weekly plan: what to log next ──────────────────────────────────────
  'stats.my.coach.plan.log.possible': 'Registra {rounds} vueltas más con detalle de golpes para confirmarlo.',
  'stats.my.coach.plan.log.insufficient': '{area}: aún faltan datos de golpes para ordenarlo.',
  'stats.my.coach.plan.log.collect': 'Registra más golpes para ver dónde pierdes golpes.',

  // ── Weekly plan: what changed on re-plan ───────────────────────────────
  'stats.my.coach.plan.replanned': 'Plan actualizado tras tu vuelta del {date}. {what}.',
  'stats.my.coach.plan.changed.topLeak': 'Nueva mayor fuga: {area}',
  'stats.my.coach.plan.changed.cause': 'Nueva causa en {area}',
  'stats.my.coach.plan.changed.second': 'Nueva segunda fuga: {area}',
  'stats.my.coach.plan.changed.keep': 'Nueva zona para mantener: {area}',
  'stats.my.coach.plan.changed.level': 'Nivel de foco {level} de 3',
  'stats.my.coach.plan.changed.tieStarted': 'Dos fugas están igualadas, así que ambas tienen tiempo',
  'stats.my.coach.plan.changed.tieEnded': 'Una fuga vuelve a ir claramente por delante',
  'stats.my.coach.plan.changed.swingAdded': 'Ejercicio de swing añadido',
  'stats.my.coach.plan.changed.swingRemoved': 'Ejercicio de swing quitado',
  'stats.my.coach.plan.changed.collect': 'Aún no hay datos para elegir un foco',
  'stats.my.coach.plan.changed.leakFound': 'Ya hay una fuga clara para entrenar',
  'stats.my.coach.plan.changed.and': '{a}; {b}',
};
