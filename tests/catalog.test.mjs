import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const source = read('data/formal-field-coverage.json');
const plan = read('data/system-form-plan.json');
const matrix = read('data/leaf-example-matrix.json');
const systems = read('data/systems.normalized.json');
const queue = read('data/coordinator.normalized.json');
const coverage = read('data/coverage.normalized.json');
const examples = read('data/examples.normalized.json');
const summary = read('data/source-summary.normalized.json');
const leaves = new Map(source.leaf_control_catalog.map((leaf) => [leaf.id, leaf]));
const allFields = systems.flatMap((system) => system.fields).concat(queue);
const restricted = new Set(source.leaf_control_catalog.filter((leaf) => leaf.ui_visibility === 'restricted_coordinator_contact_block').map((leaf) => leaf.id));

test('all 21 source systems have their complete common and specific question routes', () => {
  assert.equal(systems.length, 22);
  assert.deepEqual(systems.filter(s=>s.id!=='SES').map((s) => s.id), plan.systems.map((s) => s.system_id));
  for (const sourceSystem of plan.systems) {
    const system = systems.find((s) => s.id === sourceSystem.system_id);
    assert.equal(system.department, sourceSystem.department_id);
    assert.equal(new Set(system.fields.map((f) => f.id)).size, system.fields.length);
    const expected = [...new Set([...sourceSystem.common_question_template_ids, ...sourceSystem.supplement_question_template_ids])].filter((id) => !['EP-C01-F02', 'EP-C01-F05'].includes(id));
    for (const id of expected) assert(system.fields.some((f) => f.id === id), `${system.id} lost ${id}`);
    assert(!system.fields.some((f) => ['EP-C01-F02', 'EP-C01-F05'].includes(f.id)));
  }
  assert(queue.some((f) => f.id === 'EP-C01-F05'), 'Project identity must be collected once');
  assert.equal(systems.find((s) => s.id === 'LV_BATTERY').department, 'HV');
  assert(!systems.some((s) => ['ASES', 'AUTOMATION_AI', 'COORDINATOR'].includes(s.id)));
});

test('every formal source control resolves once to a real field/column or restricted coordinator metadata', () => {
  assert.equal(coverage.entries.length, 725);
  assert.equal(new Set(coverage.entries.map((entry) => entry.id)).size, 725);
  assert.deepEqual(new Set(coverage.entries.map((entry) => entry.id)), new Set(leaves.keys()));
  for (const entry of coverage.entries) {
    const leaf = leaves.get(entry.id);
    assert.equal(entry.official.sheet, leaf.source_sheet);
    assert.deepEqual(entry.official.ranges, leaf.source_cells_or_ranges);
    if (entry.privateContact) {
      assert(restricted.has(entry.id));
      assert.equal(entry.fieldId, undefined);
      continue;
    }
    const fields = entry.systemId ? systems.find((s) => s.id === entry.systemId).fields : queue;
    const field = fields.find((f) => f.id === entry.fieldId);
    assert(field, `${entry.id}: dangling field ${entry.fieldId}`);
    assert(field.officialRefs.some((ref) => ref.id === entry.id));
    if (entry.columnId) {
      const column = field.columns.find((c) => c.id === entry.columnId);
      assert(column, `${entry.id}: dangling column ${entry.columnId}`);
      assert(column.officialRefs.some((ref) => ref.id === entry.id));
    }
  }
});

test('ASES technical inputs are usable in the accumulator route while ownership remains explicit', () => {
  const technical = source.leaf_control_catalog.filter((leaf) => leaf.source_document_id === 'ASES' && leaf.ui_visibility === 'shared_team_form');
  assert.equal(technical.length, 423);
  for (const leaf of technical) {
    const entry = coverage.entries.find((e) => e.id === leaf.id);
    assert.equal(entry.systemId, 'ACCUMULATOR');
    assert.equal(entry.collectionRoutingStatus, 'proposed_collection_route_owner_pending');
    assert.notEqual(entry.ownershipStatus, 'verified_system_team_scope');
  }
  for (const entry of coverage.entries.filter((e) => e.official.document === 'ASES' && e.disposition !== 'site_answer')) assert.equal(entry.systemId, null);
});

test('table columns have stable IDs, guidance, units, source choices and file requirements', () => {
  for (const field of allFields.filter((f) => f.kind === 'table')) {
    assert(field.columns.length > 0);
    assert.equal(new Set(field.columns.map((c) => c.id)).size, field.columns.length);
    for (const column of field.columns) {
      assert(column.id && column.label && column.prompt);
      assert.equal(column.required, !column.id.startsWith('SES') || !/-UNIT$|-SOURCE$/.test(column.id));
      const original = column.sourceControlIds?.map((id) => leaves.get(id)).find(Boolean);
      if (original) {
        assert.equal(column.unit ?? null, original.units ?? null);
        const sourceOptions = original.input_schema.source_literal_options;
        if (sourceOptions.length) assert.deepEqual(column.options.map((o) => o.value), sourceOptions.map((o) => String(o.source_value)));
      }
      if (column.type === 'file') {
        assert.equal(column.attachmentRequired, true);
        assert.equal(field.attachmentRequired, true);
      }
    }
  }
  const relays = queue.find((f) => f.id === 'CARD-FG-ESF-DS-05');
  const contact = relays.columns.find((c) => c.label === 'מצב המגעים ללא הזנה');
  assert(contact.options.find((o) => o.value === 'NO').label.includes('פתוח'));
  assert(contact.options.find((o) => o.value === 'NC').label.includes('סגור'));
});

test('repeating material/fastener slots are grouped without losing any official locations', () => {
  for (const card of source.ui_card_catalog.filter((card) => card.display_mode === 'repeating_records')) {
    const field = allFields.find((f) => f.id === card.id);
    assert(field, `Missing repeated group ${card.id}`);
    assert.equal(field.kind, 'table');
    assert.deepEqual(new Set(field.sourceControlIds), new Set(card.leaf_control_ids));
    assert.equal(field.columns.length, card.display_columns.length);
  }
});

test('TSAL schematic is one saved requirement with the exact formal source alias', () => {
  const tsal = systems.find((s) => s.id === 'TSAL');
  assert(!tsal.fields.some((f) => f.id === 'LC-ESF-S07-M47'));
  const field = tsal.fields.find((f) => f.id === 'EP-C09-F01');
  assert(field.officialRefs.some((ref) => ref.id === 'LC-ESF-S07-M47'));
  assert.equal(field.attachmentRequired, true);
  assert.equal(tsal.fields.find((f) => f.id === 'EP-TSAL-Q06').attachmentRequired, true);
});

test('examples retain relevant/partial/gap distinctions and all 41 images are protected real assets', () => {
  assert.equal(examples.length, 41);
  const imageBytes = read('private-data/example-images.json');
  assert([0,41].includes(Object.keys(imageBytes).length));
  const exampleIds = new Set(examples.map((example) => example.id));
  for (const example of examples) {
    assert.equal(example.image, `/api/examples/${example.id}`);
    assert(example.caption && example.explanation && example.limitations);
    assert.equal(example.personNamesVisible, false);
    if(!imageBytes[example.id])continue;
    const image = Buffer.from(imageBytes[example.id], 'base64');
    assert(image.length > 100);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  for (const field of allFields) {
    for (const item of [field, ...(field.columns ?? [])]) {
      assert(item.exampleNote);
      item.exampleIds.forEach((id) => assert(exampleIds.has(id), `Dangling example ${id}`));
      if (item.exampleStatus === 'example_gap') assert.equal(item.exampleIds.length, 0);
    }
  }
  assert.equal(matrix.summary.complete_example_coverage, false);
  assert.deepEqual(coverage.exampleSummary, matrix.summary);
  assert.equal(summary.exampleGaps, 441);
});

test('no team form contains contact fields, seeded answers or preselected source defaults', () => {
  for (const field of allFields) {
    assert(!field.sourceControlIds.some((id) => restricted.has(id) || id === 'SC-EP-C01-F02'));
    assert.equal(field.answer, undefined);
    assert.equal(field.defaultValue, undefined);
    assert.equal(field.required, true);
    assert.equal(field.applicabilityPolicy, 'answer_or_reviewed_not_applicable');
    assert.equal(field.type, field.kind);
  }
  assert.equal(coverage.entries.filter((entry) => entry.privateContact).length, 4);
  assert(!/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(JSON.stringify({ systems, queue, examples })));
});

test('2027 rules are distinct from historical ESF/ASES templates and source hashes are unchanged', () => {
  assert.equal(summary.engineeringYear, 2027);
  assert.equal(summary.italy2027SubmissionVerified, false);
  assert.equal(coverage.italy2027SubmissionVerified, false);
  assert.equal(summary.templateVersions.ESF, 'FEI2023 Ver01');
  assert.equal(summary.templateVersions.ASES, 'FS26 v1.0');
  for (const entry of coverage.entries) {
    assert.equal(entry.official.templateYear, entry.official.document === 'ESF' ? 2023 : 2026);
    assert.equal(entry.official.submission2027Verified, false);
  }
  for (const name of ['formal-field-coverage.json', 'leaf-example-matrix.json', 'system-form-plan.json']) {
    const copied = readFileSync(new URL(`data/${name}`, root));
    assert.equal(createHash('sha256').update(copied).digest('hex'), read('data/public-source-hashes.json')[name]);
  }
});

test('coordinator is an explicit administrative alias, excluded from the 21-system summary', () => {
  const implementation = readFileSync(new URL('lib/catalog.ts', root), 'utf8');
  assert(implementation.includes("if (id === 'COORDINATOR') return coordinatorSystem"));
  assert.equal(summary.systems, 22);
  assert(!systems.some((system) => system.id === 'COORDINATOR'));
});
