export const FIXTURE_CLOCK = { now: '2026-11-18T23:59:59', utcOffsetMinutes: 0 };
export const CHORES_RESPONSE = { items: Array.from({ length: 8 }, (_, index) => ({ uid: `chore-${index}`, summary: `Fixture chore ${index + 1}`, status: index < 6 ? 'needs_action' : 'completed', due: '2026-11-18', description: null })) };
