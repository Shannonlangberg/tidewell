/*
 * Input schemas for the Resources (brand library) MCP tools (zod raw shapes). Imports only zod: the category
 * list is written out and pinned to lib/hq/resources/rules.ts by brand-schemas.test.mts.
 */
import { z } from "zod";

export const BRAND_CATEGORY_VALUES = ["guidelines", "logos", "photos", "colours_type", "tokens", "ui_kit", "other"] as const;

const CATEGORY_TEXT =
  "guidelines (the brand book and guideline cards), logos (logo artwork), photos, colours_type (colour and type tokens, font loading, base styles), tokens (the rest of the design-system CSS), ui_kit (component code and the website UI kit), other";

export const listBrandResourcesShape = {
  category: z.enum(BRAND_CATEGORY_VALUES).optional().describe(`Optional. Only this category: ${CATEGORY_TEXT}.`),
  search: z.string().trim().min(2).max(100).optional().describe("Optional. Words to find in a resource's title, file name, description or tags, or a number like RES-0007."),
  page: z.number().int().min(1).max(40).optional().describe("Optional. Which page of 25 to return (default 1). The reply says how many pages there are."),
};

export const getBrandResourceShape = {
  resource: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("The resource: its number as HQ shows it (RES-0007), its id from an earlier result, or words of its title (if several match you get candidates to choose from)."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(60_000)
    .optional()
    .describe("Optional. For a text file longer than one reply carries: the character offset to continue from, as the previous reply said. Default 0."),
};

export const getBrandSummaryShape = {};
