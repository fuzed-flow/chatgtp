export function normalizePhaseOrder(phases = []) {
  return phases.map((phase, index) => (
    phase.sort_order === index ? phase : { ...phase, sort_order: index }
  ));
}
