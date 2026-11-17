/**
 * Display-safe catalog derived from the supplied, immutable source registry.
 * Original registries remain under data/ for authenticated server export only.
 * No original registry is imported by this client-compatible module.
 */
import systemData from '@/data/systems.normalized.json';
import exampleData from '@/data/examples.normalized.json';
import coordinatorData from '@/data/coordinator.normalized.json';
import coverageData from '@/data/coverage.normalized.json';
import summaryData from '@/data/source-summary.normalized.json';
import sharedData from '@/data/shared-records.normalized.json';

export type FieldKind = 'text' | 'table' | 'file' | 'select';

export type OfficialRef = {
  id: string;
  document: string;
  sheet: string;
  ranges: string[];
  templateYear: number;
  templateHash: string;
  event: string;
  submission2027Verified: boolean;
};

export type FieldColumn = {
  id: string;
  label: string;
  prompt: string;
  unit?: string;
  exampleIds: string[];
  exampleStatus: string;
  exampleNote: string;
  officialRefs?: OfficialRef[];
  sourceControlIds?: string[];
  kind?: FieldKind;
  type?: FieldKind;
  required?: boolean;
  options?: { value: string; label: string }[];
  attachmentRequired?: boolean;
  sourceInputSchema?: Record<string, unknown>;
  sourceSlots?: { id: string; recordKey: string | null; sourceRanges: string[] }[];
};

export type Field = {
  id: string;
  label: string;
  prompt: string;
  kind: FieldKind;
  /** Same semantic kind, retained as an explicit server validation alias. */
  type: FieldKind;
  columns?: FieldColumn[];
  unit?: string;
  section: string;
  exampleIds: string[];
  exampleStatus: string;
  exampleNote: string;
  officialRefs?: OfficialRef[];
  required: true;
  options?: { value: string; label: string }[];
  attachmentRequired?: boolean;
  applicability?: string;
  condition?: string;
  sourceQuestionId?: string | null;
  sourceControlIds: string[];
  ruleRefs?: string[];
  originalKind?: string;
  evidenceRequests?: string[];
  sourceCardId?: string;
  sourceSectionId?: string;
  sourceInputSchema?: Record<string, unknown>;
  ownershipStatus?: string;
  collectionRoutingStatus?: string;
  routingTeam?: string;
  recordKeys?: string[];
  needsClarification?: boolean;
  applicabilityPolicy?: 'answer_or_reviewed_not_applicable';
};

export type System = {
  id: string;
  label: string;
  department: string;
  electricalDomain: string;
  interfaces: string[];
  fields: Field[];
  ownershipStatus?: string;
  collectionRoutingStatus?: string;
  sourceOfficialSectionCandidates?: string[];
};

export type Example = {
  id: string;
  title: string;
  image: string;
  caption: string;
  explanation: string;
  limitations: string;
  bundleImagePath: string;
  sourceTitle: string;
  sourcePage?: number | null;
  personNamesVisible: boolean;
};

export type CoverageEntry = {
  id: string;
  label: string;
  official: OfficialRef;
  section: string;
  sectionId: string;
  systemId: string | null;
  disposition: string;
  ownershipStatus: string;
  collectionRoutingStatus: string;
  routingTeam: string;
  privateContact: boolean;
  exampleStatus: string;
  inputSchema: Record<string, unknown>;
  requiredStatus: string;
  sourceTemplateCaution: string;
  fieldId?: string;
  columnId?: string;
  sourceRecordKey?: string | null;
};

export const schemaVersion = 'BIU-ELECTRICAL-COLLECTION-2027-1.0.0';
export const systems = systemData as unknown as System[];
export const examples = exampleData as unknown as Example[];
export const coordinatorQueue = coordinatorData as unknown as Field[];
export const sourceSummary = summaryData;
export const coverage = {
  ...coverageData,
  entries: coverageData.entries as unknown as CoverageEntry[],
};
export const sharedRecordDefinitions = sharedData;

/** Administrative route, deliberately excluded from the 21-system map/count. */
export const coordinatorSystem: System = {
  id: 'COORDINATOR',
  label: 'ריכוז מסמכים ושדות משותפים',
  department: 'COORDINATOR',
  electricalDomain: 'Shared documentation',
  interfaces: [],
  fields: coordinatorQueue,
  ownershipStatus: 'document_coordinator',
};

/** Owner routing is intentionally separate from optional navigation groups. */
export const departments = [
  { id: 'MECHANICS', label: 'מכאניקה — SES' },
  { id: 'LV', label: 'מתח נמוך' },
  { id: 'HV', label: 'מתח גבוה' },
  { id: 'DRIVE', label: 'מנוע ואינוורטר' },
  { id: 'LV_HV', label: 'ממשקים ואינטגרציה' },
];

export function getSystem(id: string): System | undefined {
  if (id === 'COORDINATOR') return coordinatorSystem;
  return systems.find((system) => system.id === id);
}

export function getFields(id: string): Field[] {
  return getSystem(id)?.fields ?? [];
}

export function getExample(id: string): Example | undefined {
  return examples.find((example) => example.id === id);
}

export function getField(systemId: string, fieldId: string): Field | undefined {
  return getFields(systemId).find((field) => field.id === fieldId);
}

/** Both directions preserve all official input IDs, including restricted metadata. */
export function getOfficialCoverage(fieldId: string, systemId?: string): CoverageEntry[] {
  return coverage.entries.filter((entry) => entry.fieldId === fieldId && (!systemId || entry.systemId === systemId));
}
