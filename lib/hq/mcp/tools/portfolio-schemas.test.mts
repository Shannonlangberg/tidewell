import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AILO_STATUSES, FEE_BASES, HANDOVER_STEPS, HANDOVER_STEP_STATUSES, MANAGED_STATUSES, SERVICE_TYPES, START_STATUSES } from "../../portfolio/rules.ts";
import * as S from "./portfolio-schemas.ts";

test("the portfolio vocabularies in portfolio-schemas.ts match lib/hq/portfolio/rules.ts", () => {
  assert.deepEqual([...S.SERVICE_TYPE_VALUES], [...SERVICE_TYPES]);
  assert.deepEqual([...S.FEE_BASIS_VALUES], [...FEE_BASES]);
  assert.deepEqual([...S.MANAGED_STATUS_VALUES], [...MANAGED_STATUSES]);
  assert.deepEqual([...S.START_STATUS_VALUES], [...START_STATUSES]);
  assert.deepEqual([...S.AILO_STATUS_VALUES], [...AILO_STATUSES]);
  assert.deepEqual([...S.HANDOVER_STEP_VALUES], [...HANDOVER_STEPS]);
  assert.deepEqual([...S.HANDOVER_STEP_STATUS_VALUES], [...HANDOVER_STEP_STATUSES]);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("every portfolio tool field is described", () => {
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
});

test("the portfolio schemas refuse what the database would", () => {
  const create = z.object(S.createManagedPropertyShape);
  assert.equal(create.safeParse({ opportunity: "Pat", service_type: "long_term_residential" }).success, true);
  assert.equal(create.safeParse({ opportunity: "Pat", service_type: "holiday" }).success, false);
  assert.equal(create.safeParse({ opportunity: "Pat", service_type: "long_term_residential", status: "ended" }).success, false);
  assert.equal(create.safeParse({ opportunity: "Pat", service_type: "long_term_residential", fee_percent: 101 }).success, false);
  const step = z.object(S.setHandoverStepShape);
  assert.equal(step.safeParse({ property: "MP-0001", step: "review_and_approve", status: "done" }).success, false);
  assert.equal(step.safeParse({ property: "MP-0001", step: "welcome_pack_sent", status: "done" }).success, true);
  const upd = z.object(S.updateManagedPropertyShape);
  assert.equal(upd.safeParse({ property: "MP-0001", ended_on: "20/10/2026" }).success, false);
});
