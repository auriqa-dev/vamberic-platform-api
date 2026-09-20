import { Router, type IRouter } from "express";
import type { Filter } from "mongodb";
import {
  ListPeopleQueryParams,
  ListPeopleResponse,
  GetPersonParams,
  GetPersonResponse,
  ListOrganisationsQueryParams,
  ListOrganisationsResponse,
  GetOrganisationParams,
  GetOrganisationResponse,
  ListOpportunitiesQueryParams,
  ListOpportunitiesResponse,
  GetOpportunityParams,
  GetOpportunityResponse,
} from "@workspace/api-zod";
import type { Person, Organisation, Opportunity } from "../domain";
import { getDomainCollections } from "../db";
import { crmReader, literalSearch } from "../services/crm";
import type { MongoService } from "../services/mongo";

const active = { archived: { $ne: true } } as const;
export function createCrmRouter(mongo: MongoService): IRouter {
  const router: IRouter = Router();
  // All six handlers are mounted behind the application's Cognito middleware.
  router.use(
    ["/api/v1/people", "/api/v1/organisations", "/api/v1/opportunities"],
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  router.get("/api/v1/people", async (req, res) => {
    const query = ListPeopleQueryParams.strict().safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid people filters" });
      return;
    }
    const { search, limit, offset } = query.data;
    const c = getDomainCollections(await mongo.database());
    const filter: Filter<Person> = { ...active };
    if (search?.trim()) {
      const match = literalSearch(search.trim());
      const contacts = await c.contact_points
        .find({ ...active, type: "email", normalizedValue: match })
        .toArray();
      filter.$or = [
        { firstName: match },
        { lastName: match },
        { displayName: match },
        { id: { $in: contacts.map((p) => p.personId) } },
      ];
    }
    const [rows, total] = await Promise.all([
      c.people
        .find(filter)
        .sort({ createdAt: -1, id: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      c.people.countDocuments(filter),
    ]);
    res.json(
      ListPeopleResponse.parse({
        items: await Promise.all(rows.map(crmReader(c).person)),
        total,
        limit,
        offset,
      }),
    );
  });
  router.get("/api/v1/organisations", async (req, res) => {
    const query = ListOrganisationsQueryParams.strict().safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid organisation filters" });
      return;
    }
    const { search, limit, offset } = query.data;
    const c = getDomainCollections(await mongo.database());
    const filter: Filter<Organisation> = { ...active };
    if (search?.trim()) {
      const match = literalSearch(search.trim());
      filter.$or = [{ name: match }, { domain: match }];
    }
    const [rows, total] = await Promise.all([
      c.organisations
        .find(filter)
        .sort({ createdAt: -1, id: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      c.organisations.countDocuments(filter),
    ]);
    res.json(
      ListOrganisationsResponse.parse({
        items: await Promise.all(rows.map(crmReader(c).organisation)),
        total,
        limit,
        offset,
      }),
    );
  });
  router.get("/api/v1/opportunities", async (req, res) => {
    const query = ListOpportunitiesQueryParams.strict().safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid opportunity filters" });
      return;
    }
    const { search, status, stage, productId, limit, offset } = query.data;
    const c = getDomainCollections(await mongo.database());
    const filter: Filter<Opportunity> = {
      ...active,
      ...(status ? { status } : {}),
      ...(stage ? { stage } : {}),
      ...(productId ? { productId } : {}),
      ...(search?.trim() ? { name: literalSearch(search.trim()) } : {}),
    };
    const [rows, total] = await Promise.all([
      c.opportunities
        .find(filter)
        .sort({ createdAt: -1, id: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      c.opportunities.countDocuments(filter),
    ]);
    res.json(
      ListOpportunitiesResponse.parse({
        items: await Promise.all(rows.map(crmReader(c).opportunity)),
        total,
        limit,
        offset,
      }),
    );
  });
  router.get("/api/v1/people/:id", async (req, res) => {
    const params = GetPersonParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid person ID" });
      return;
    }
    const c = getDomainCollections(await mongo.database());
    const row = await c.people.findOne({ ...active, id: params.data.id });
    if (!row) {
      res.status(404).json({ error: "Person not found" });
      return;
    }
    res.json(GetPersonResponse.parse(await crmReader(c).personDetail(row)));
  });
  router.get("/api/v1/organisations/:id", async (req, res) => {
    const params = GetOrganisationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid organisation ID" });
      return;
    }
    const c = getDomainCollections(await mongo.database());
    const row = await c.organisations.findOne({
      ...active,
      id: params.data.id,
    });
    if (!row) {
      res.status(404).json({ error: "Organisation not found" });
      return;
    }
    res.json(
      GetOrganisationResponse.parse(await crmReader(c).organisationDetail(row)),
    );
  });
  router.get("/api/v1/opportunities/:id", async (req, res) => {
    const params = GetOpportunityParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid opportunity ID" });
      return;
    }
    const c = getDomainCollections(await mongo.database());
    const row = await c.opportunities.findOne({
      ...active,
      id: params.data.id,
    });
    if (!row) {
      res.status(404).json({ error: "Opportunity not found" });
      return;
    }
    res.json(
      GetOpportunityResponse.parse(await crmReader(c).opportunityDetail(row)),
    );
  });
  return router;
}
