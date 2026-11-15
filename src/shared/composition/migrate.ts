/**
 * Rewrites a stored document so the current compiler accepts what an earlier Studio wrote and the app now rejects.
 * Pure and idempotent: a document that needs nothing comes back unchanged with no changes listed.
 */
const removedBedroomBedFields = ['tonightScript', 'outsideScheduleScript'] as const;
const removedBedroomEnvironmentFields = ['scheduleSetTopic', 'hotFlashBrokerScript', 'householdAwayScript'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface CompositionMigration {
  document: unknown;
  /** One line per rewrite, with the pointer it applies to. */
  changes: string[];
}

/** Removes the five `bedroom-config@1` fields the app dropped (scripts and topics now resolve from the house document). */
export function migrateComposition(input: unknown): CompositionMigration {
  const document = structuredClone(input);
  const changes: string[] = [];
  const sources = record(document) && Array.isArray(document.dataSources) ? document.dataSources : [];
  sources.forEach((source, index) => {
    if (!record(source) || source.model !== 'bedroom-config@1' || !record(source.inputs)) return;
    const base = `/dataSources/${index}/inputs`;
    const beds = Array.isArray(source.inputs.beds) ? source.inputs.beds : [];
    beds.forEach((bed, bedIndex) => {
      if (!record(bed) || !record(bed.configuration)) return;
      for (const field of removedBedroomBedFields) {
        if (Object.hasOwn(bed.configuration, field)) { delete bed.configuration[field]; changes.push(`remove ${base}/beds/${bedIndex}/configuration/${field}`); }
      }
    });
    if (record(source.inputs.environment)) {
      for (const field of removedBedroomEnvironmentFields) {
        if (Object.hasOwn(source.inputs.environment, field)) { delete source.inputs.environment[field]; changes.push(`remove ${base}/environment/${field}`); }
      }
    }
  });
  return { document, changes };
}
