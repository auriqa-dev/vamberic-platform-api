import {
  EntitlementSchema,
  type Entitlement,
  type Product,
  type Subscription,
  type Transaction,
} from "./schemas";
import type { CrmWorkspace } from "./crm-records";
import {
  CapabilitySchema,
  CapabilityInstanceSchema,
  CommercialPackageSchema,
  CommercialChargeSchema,
  type Capability,
  type CapabilityInstance,
  type CommercialPackage,
  type CommercialCharge,
} from "./commercial-records";
import { isPlatformId } from "./ids";

export interface CommercialModel {
  workspaces: readonly CrmWorkspace[];
  products: readonly Product[];
  capabilities: readonly Capability[];
  instances: readonly CapabilityInstance[];
  packages?: readonly CommercialPackage[];
  charges?: readonly CommercialCharge[];
  entitlements?: readonly Entitlement[];
  subscriptions?: readonly Subscription[];
  transactions?: readonly Transaction[];
}
function unique<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map(rows.map((row) => [row.id, row]));
  if (map.size !== rows.length)
    throw new Error("Duplicate commercial record identity");
  return map;
}
function invalid(): never {
  throw new Error(
    "Invalid commercial reference, dependency or workspace scope",
  );
}
function acyclic(edges: Map<string, readonly string[]>) {
  const visiting = new Set<string>();
  const done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("Capability dependency cycle");
    if (done.has(id)) return;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) visit(target);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of edges.keys()) visit(id);
}
function sameScope(a: CapabilityInstance, b: CapabilityInstance): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.scopeType === b.scopeType &&
    a.scopeProductId === b.scopeProductId
  );
}
function packageContains(p: CommercialPackage, i: CapabilityInstance): boolean {
  return (
    p.workspaceId === i.workspaceId &&
    p.capabilityIds.includes(i.capabilityId) &&
    p.capabilityInstanceIds.includes(i.id) &&
    (p.scopeType === "workspace" ||
      i.scopeType === "workspace" ||
      p.scopeProductId === i.scopeProductId)
  );
}
/** Pure complete-proposal validation for future trusted transactional writers.
 * Storage shape validation cannot enforce references, cycles or concurrent edits.
 * Callers must authorize and lock/validate referenced records before writing.
 */
export function validateCommercialModel(model: CommercialModel): void {
  const workspaces = unique(model.workspaces);
  const products = unique(model.products);
  const capabilities = unique(
    model.capabilities.map((c) => CapabilitySchema.parse(c)),
  );
  const instances = unique(
    model.instances.map((i) => CapabilityInstanceSchema.parse(i)),
  );
  const packages = unique(
    (model.packages ?? []).map((p) => CommercialPackageSchema.parse(p)),
  );
  const subscriptions = unique(model.subscriptions ?? []);
  const transactions = unique(model.transactions ?? []);
  const workspace = (id: string) => {
    if (!workspaces.has(id) || workspaces.get(id)?.archived) invalid();
  };
  const scope = (r: {
    workspaceId: string;
    scopeType: string;
    scopeProductId?: string;
  }) => {
    workspace(r.workspaceId);
    if (r.scopeType === "product") {
      const product = products.get(r.scopeProductId!);
      if (
        !product ||
        product.archived ||
        (product.workspaceId !== undefined &&
          product.workspaceId !== r.workspaceId)
      )
        invalid();
    }
  };
  for (const c of capabilities.values())
    for (const d of c.dependencies) {
      const target = capabilities.get(d.capabilityId);
      if (
        !target ||
        (d.scope === "workspace"
          ? !target.supportedScopeTypes.includes("workspace")
          : c.supportedScopeTypes.some(
              (s) => !target.supportedScopeTypes.includes(s),
            ))
      )
        invalid();
    }
  acyclic(
    new Map(
      [...capabilities.values()].map((c) => [
        c.id,
        c.dependencies.map((d) => d.capabilityId),
      ]),
    ),
  );
  for (const i of instances.values()) {
    scope(i);
    const c = capabilities.get(i.capabilityId);
    if (!c || !c.supportedScopeTypes.includes(i.scopeType)) invalid();
    const used = new Set<string>();
    for (const id of i.dependencyInstanceIds) {
      const target = instances.get(id);
      const rule = c.dependencies.find(
        (d) => d.capabilityId === target?.capabilityId,
      );
      if (
        !target ||
        !rule ||
        target.id === i.id ||
        used.has(target.capabilityId) ||
        target.workspaceId !== i.workspaceId ||
        (rule.scope === "workspace"
          ? target.scopeType !== "workspace"
          : !sameScope(i, target))
      )
        invalid();
      used.add(target.capabilityId);
    }
    if (
      i.status === "enabled" &&
      c.dependencies.some((d) => !used.has(d.capabilityId))
    )
      invalid();
  }
  acyclic(
    new Map(
      [...instances.values()].map((i) => [i.id, i.dependencyInstanceIds]),
    ),
  );
  for (const p of packages.values()) {
    scope(p);
    if (p.capabilityIds.some((id) => !capabilities.has(id))) invalid();
    for (const id of p.capabilityInstanceIds) {
      const i = instances.get(id);
      if (!i || !packageContains(p, i)) invalid();
    }
  }
  for (const raw of model.charges ?? []) {
    const charge = CommercialChargeSchema.parse(raw);
    workspace(charge.workspaceId);
    const instance = charge.capabilityInstanceId
      ? instances.get(charge.capabilityInstanceId)
      : undefined;
    const pack = charge.commercialPackageId
      ? packages.get(charge.commercialPackageId)
      : undefined;
    if (
      (charge.capabilityInstanceId &&
        (!instance || instance.workspaceId !== charge.workspaceId)) ||
      (charge.commercialPackageId &&
        (!pack || pack.workspaceId !== charge.workspaceId)) ||
      (instance && pack && !packageContains(pack, instance))
    )
      invalid();
    for (const [id, records] of [
      [charge.sourceSubscriptionId, subscriptions],
      [charge.sourceTransactionId, transactions],
    ] as const) {
      if (
        id &&
        (!records.has(id) ||
          records.get(id)?.workspaceId !== charge.workspaceId)
      )
        invalid();
    }
  }
  unique(model.charges ?? []);
  for (const raw of model.entitlements ?? []) {
    const e = EntitlementSchema.parse(raw);
    if (e.workspaceId) workspace(e.workspaceId);
    const instance = e.capabilityInstanceId
      ? instances.get(e.capabilityInstanceId)
      : undefined;
    if (
      e.capabilityInstanceId &&
      (!instance || instance.workspaceId !== e.workspaceId)
    )
      invalid();
    if (
      e.capabilityId &&
      !capabilities
        .get(e.capabilityId)
        ?.supportedScopeTypes.includes("workspace")
    )
      invalid();
    if (e.productId) {
      const product = products.get(e.productId);
      if (
        !product ||
        (product.workspaceId !== undefined &&
          product.workspaceId !== e.workspaceId)
      )
        invalid();
    }
    if (e.commercialPackageId) {
      const p = packages.get(e.commercialPackageId);
      if (
        !p ||
        p.workspaceId !== e.workspaceId ||
        e.productId ||
        (instance
          ? !packageContains(p, instance)
          : p.scopeType !== "workspace" ||
            !p.capabilityIds.includes(e.capabilityId!))
      )
        invalid();
    }
  }
}

function activeGrant(e: Entitlement, workspaceId: string, at: Date): boolean {
  // Whole-instance access does not expand customer/feature/usage-limited grants.
  return (
    e.workspaceId === workspaceId &&
    !e.personId &&
    !e.organisationId &&
    !e.archived &&
    e.status === "active" &&
    e.activeFrom <= at &&
    (!e.activeUntil || at < e.activeUntil) &&
    e.quantity !== 0 &&
    (!e.scope || Object.keys(e.scope).length === 0)
  );
}
/** Functional access only; the caller must separately authorize actor/workspace.
 * Exact instance grants are required for product scope. A capability-level grant
 * can serve workspace instances only, never all Products by implication.
 * Payment/charges/packages never grant access or override entitlement state.
 */
export function hasCapabilityInstanceEntitlement(
  model: Pick<
    CommercialModel,
    "workspaces" | "products" | "capabilities" | "instances"
  >,
  records: readonly Entitlement[],
  instanceId: string,
  workspaceId: string,
  at = new Date(),
): boolean {
  if (
    !isPlatformId(workspaceId, "workspace") ||
    !isPlatformId(instanceId, "capinstance") ||
    !Number.isFinite(at.getTime())
  )
    return false;
  try {
    validateCommercialModel({
      workspaces: model.workspaces,
      products: model.products,
      capabilities: model.capabilities,
      instances: model.instances,
    });
  } catch {
    return false;
  }
  const instances = new Map(model.instances.map((i) => [i.id, i]));
  const capabilities = new Map(model.capabilities.map((c) => [c.id, c]));
  const grants = records.flatMap((raw) => {
    const result = EntitlementSchema.safeParse(raw);
    return result.success ? [result.data] : [];
  });
  if (new Set(grants.map((e) => e.id)).size !== grants.length) return false;
  const results = new Map<string, boolean>();
  function enabled(id: string): boolean {
    if (results.has(id)) return results.get(id)!;
    const instance = instances.get(id);
    const capability = instance && capabilities.get(instance.capabilityId);
    if (
      !instance ||
      !capability ||
      instance.workspaceId !== workspaceId ||
      instance.archived ||
      capability.archived ||
      instance.status !== "enabled"
    )
      return false;
    const granted = grants.some(
      (e) =>
        activeGrant(e, workspaceId, at) &&
        (e.capabilityInstanceId === id ||
          (instance.scopeType === "workspace" &&
            e.capabilityId === instance.capabilityId)),
    );
    const result =
      granted && (instance.dependencyInstanceIds ?? []).every(enabled);
    results.set(id, result);
    return result;
  }
  return enabled(instanceId);
}
