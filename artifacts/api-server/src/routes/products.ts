import { Router, type IRouter } from "express";
import type { Filter } from "mongodb";
import {
  CreateProductBody,
  CreateProductResponse,
  GetProductParams,
  GetProductResponse,
  ListProductsQueryParams,
  ListProductsResponse,
  UpdateProductBody,
  UpdateProductParams,
  UpdateProductResponse,
} from "@workspace/api-zod";
import {
  ProductInsertSchema,
  ProductSchema,
  generatePlatformId,
  type Product,
} from "../domain";
import { getDomainCollections } from "../db";
import type { MongoService } from "../services/mongo";

function productResponse(product: Product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    ...(product.description === undefined
      ? {}
      : { description: product.description }),
    status: product.status,
    productType: product.productType,
    domains: product.domains,
    commercialModel: product.commercialModel,
    oneOffPurchaseAvailable: product.oneOffPurchaseAvailable,
    subscriptionAvailable: product.subscriptionAvailable,
    ...(product.currency === undefined ? {} : { currency: product.currency }),
    ...(product.internalNotes === undefined
      ? {}
      : { internalNotes: product.internalNotes }),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export function createProductsRouter(mongo: MongoService): IRouter {
  const router: IRouter = Router();

  router.get("/api/v1/products", async (req, res): Promise<void> => {
    const query = ListProductsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "Invalid product filters" });
      return;
    }

    const filter: Filter<Product> = {};
    if (query.data.status) filter.status = query.data.status;
    if (query.data.search) {
      const escaped = query.data.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { slug: { $regex: escaped, $options: "i" } },
        { productType: { $regex: escaped, $options: "i" } },
      ];
    }

    const db = await mongo.database();
    const products = await getDomainCollections(db)
      .products.find(filter)
      .sort({ updatedAt: -1 })
      .toArray();
    res.json(ListProductsResponse.parse(products.map(productResponse)));
  });

  router.post("/api/v1/products", async (req, res): Promise<void> => {
    const body = CreateProductBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid product details" });
      return;
    }

    const now = new Date();
    const product = ProductSchema.parse({
      ...ProductInsertSchema.parse({
        ...body.data,
        id: generatePlatformId("product"),
      }),
      createdAt: now,
      updatedAt: now,
    });

    try {
      const db = await mongo.database();
      await getDomainCollections(db).products.insertOne(product);
    } catch (error: unknown) {
      if (isDuplicateKey(error)) {
        res
          .status(409)
          .json({ error: "A product with this slug already exists" });
        return;
      }
      throw error;
    }

    res.status(201).json(CreateProductResponse.parse(productResponse(product)));
  });

  router.get("/api/v1/products/:id", async (req, res): Promise<void> => {
    const params = GetProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid product ID" });
      return;
    }

    const db = await mongo.database();
    const product = await getDomainCollections(db).products.findOne({
      id: params.data.id,
    });
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(GetProductResponse.parse(productResponse(product)));
  });

  router.patch("/api/v1/products/:id", async (req, res): Promise<void> => {
    const params = UpdateProductParams.safeParse(req.params);
    const body = UpdateProductBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid product update" });
      return;
    }

    const db = await mongo.database();
    const products = getDomainCollections(db).products;
    const current = await products.findOne({ id: params.data.id });
    if (!current) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const updated = ProductSchema.parse({
      ...current,
      ...body.data,
      updatedAt: new Date(),
    });

    try {
      await products.replaceOne({ id: current.id }, updated);
    } catch (error: unknown) {
      if (isDuplicateKey(error)) {
        res
          .status(409)
          .json({ error: "A product with this slug already exists" });
        return;
      }
      throw error;
    }

    res.json(UpdateProductResponse.parse(productResponse(updated)));
  });

  return router;
}
