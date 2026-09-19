import { Router, type IRouter } from "express";
import { readProduct } from "../domain/product-migration";
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
    ...product,
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

    const db = await mongo.database();
    const products = (
      await getDomainCollections(db)
        .products.find({})
        .sort({ updatedAt: -1 })
        .toArray()
    ).map(readProduct);
    const search = query.data.search?.toLowerCase();
    const filtered = products.filter(
      (product) =>
        (!query.data.lifecycleStatus ||
          product.lifecycleStatus === query.data.lifecycleStatus) &&
        (!search ||
          [product.name, product.slug, product.productType ?? ""].some(
            (value) => value.toLowerCase().includes(search),
          )),
    );
    res.json(ListProductsResponse.parse(filtered.map(productResponse)));
  });

  router.post("/api/v1/products", async (req, res): Promise<void> => {
    const body = CreateProductBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid product details" });
      return;
    }

    const now = new Date();
    const input = ProductInsertSchema.safeParse({
      currency: "GBP",
      ...body.data,
      id: generatePlatformId("product"),
    });
    if (!input.success) {
      res.status(400).json({ error: "Invalid product details" });
      return;
    }
    const product = ProductSchema.parse({
      ...input.data,
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

    res
      .status(201)
      .json(CreateProductResponse.parse(productResponse(readProduct(product))));
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
    res.json(GetProductResponse.parse(productResponse(readProduct(product))));
  });

  router.patch("/api/v1/products/:id", async (req, res): Promise<void> => {
    const params = UpdateProductParams.safeParse(req.params);
    const body = UpdateProductBody.safeParse(req.body);
    if (
      !params.success ||
      !body.success ||
      Object.keys(body.data).length === 0
    ) {
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

    const result = ProductSchema.safeParse({
      ...readProduct(current),
      ...body.data,
      updatedAt: new Date(),
    });
    if (!result.success) {
      res.status(400).json({ error: "Invalid product update" });
      return;
    }
    const updated = result.data;

    try {
      const write = await products.updateOne(
        { id: current.id, updatedAt: current.updatedAt },
        { $set: updated },
      );
      if (!write.matchedCount) {
        res
          .status(409)
          .json({ error: "Product changed during update; reload and retry" });
        return;
      }
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
