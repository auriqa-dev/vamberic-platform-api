import { z } from "zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Product,
  ProductUpdate,
  ProductType,
  LifecycleStatus,
  OperatingMode,
  BusinessModel,
  RevenueModel,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Loader2 } from "lucide-react";
import { productLabel } from "@/lib/product-labels";

const currencies = Intl.supportedValuesOf("currency");
const date = z.string().date().or(z.literal(""));
const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Lowercase letters, numbers, and hyphens only",
    ),
  description: z.string().max(10000),
  productType: z.nativeEnum(ProductType).or(z.literal("")),
  lifecycleStatus: z.nativeEnum(LifecycleStatus).or(z.literal("")),
  operatingMode: z.nativeEnum(OperatingMode).or(z.literal("")),
  businessModel: z.nativeEnum(BusinessModel).or(z.literal("")),
  revenueModels: z.array(z.nativeEnum(RevenueModel)),
  currency: z
    .string()
    .refine(
      (value) => value === "" || currencies.includes(value),
      "Choose a valid currency",
    ),
  primaryDomain: z.string().trim().max(253),
  additionalDomains: z.array(z.string().trim().min(1).max(253)).max(50),
  plannedLaunchDate: date,
  actualLaunchDate: date,
  launchHypothesis: z.string().max(20000),
  successMeasures: z.string().max(20000),
  internalNotes: z.string().max(20000),
});
type Values = z.infer<typeof schema>;

export function ProductForm({
  initialData,
  onSubmit,
  isPending,
}: {
  initialData?: Product;
  onSubmit: (data: ProductUpdate) => void;
  isPending: boolean;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(
      schema.superRefine((data, ctx) => {
        if (!initialData)
          for (const field of ["productType", "lifecycleStatus"] as const) {
            if (!data[field])
              ctx.addIssue({
                code: "custom",
                path: [field],
                message: "Choose a value",
              });
          }
      }),
    ),
    defaultValues: {
      name: initialData?.name ?? "",
      slug: initialData?.slug ?? "",
      description: initialData?.description ?? "",
      productType: initialData ? (initialData.productType ?? "") : "software",
      lifecycleStatus: initialData
        ? (initialData.lifecycleStatus ?? "")
        : "idea",
      operatingMode: initialData?.operatingMode ?? "",
      businessModel: initialData?.businessModel ?? "",
      revenueModels: initialData?.revenueModels ?? [],
      currency: initialData ? (initialData.currency ?? "") : "GBP",
      primaryDomain: initialData?.primaryDomain ?? "",
      additionalDomains: initialData?.additionalDomains ?? [],
      plannedLaunchDate: initialData?.plannedLaunchDate ?? "",
      actualLaunchDate: initialData?.actualLaunchDate ?? "",
      launchHypothesis: initialData?.launchHypothesis ?? "",
      successMeasures: initialData?.successMeasures ?? "",
      internalNotes: initialData?.internalNotes ?? "",
    },
  });
  const [domainsText, setDomainsText] = useState(
    initialData?.additionalDomains.join(", ") ?? "",
  );
  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm";
  const textField = (
    name:
      | "name"
      | "slug"
      | "description"
      | "primaryDomain"
      | "plannedLaunchDate"
      | "actualLaunchDate"
      | "launchHypothesis"
      | "successMeasures"
      | "internalNotes",
    label: string,
    multiline = false,
    type = "text",
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea {...field} className="min-h-[100px]" />
            ) : (
              <Input {...field} type={type} />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  const select = (
    name:
      | "productType"
      | "lifecycleStatus"
      | "businessModel"
      | "operatingMode"
      | "currency",
    label: string,
    options: readonly string[],
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <select {...field} className={selectClass}>
              <option value="">
                {name === "productType" || name === "lifecycleStatus"
                  ? "Choose a value"
                  : "Not specified"}
              </option>
              {options.map((value) => (
                <option key={value} value={value}>
                  {name === "currency" ? value : productLabel(value)}
                </option>
              ))}
            </select>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
  return (
    <Form {...form}>
      <form
        className="space-y-8"
        onSubmit={form.handleSubmit((data) =>
          onSubmit({
            ...data,
            productType: data.productType || undefined,
            lifecycleStatus: data.lifecycleStatus || undefined,
            operatingMode: data.operatingMode || null,
            businessModel: data.businessModel || null,
            currency: data.currency || null,
            primaryDomain: data.primaryDomain || null,
            plannedLaunchDate: data.plannedLaunchDate || null,
            actualLaunchDate: data.actualLaunchDate || null,
            launchHypothesis: data.launchHypothesis || null,
            successMeasures: data.successMeasures || null,
          }),
        )}
      >
        {!!initialData?.migrationWarnings?.length && (
          <aside className="rounded-md border p-4 text-sm space-y-2">
            <p className="font-semibold">
              Previous product information needs review
            </p>
            <ul className="list-disc pl-5">
              {initialData.migrationWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <p>
              Original information is retained. Choose the appropriate values
              when known.
            </p>
          </aside>
        )}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b pb-2">
            Product Identity
          </h3>
          {textField("name", "Product Name")}
          {textField("slug", "Slug")}
          {textField("description", "Description", true)}
          <div className="grid md:grid-cols-2 gap-4">
            {select("productType", "Product Type", Object.values(ProductType))}
            {select(
              "lifecycleStatus",
              "Lifecycle Status",
              Object.values(LifecycleStatus),
            )}
          </div>
        </section>
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b pb-2">
            Market & Commercial
          </h3>
          {select(
            "businessModel",
            "Business Model",
            Object.values(BusinessModel),
          )}
          <FormField
            control={form.control}
            name="revenueModels"
            render={({ field }) => (
              <FormItem>
                <fieldset>
                  <legend className="text-sm font-medium mb-2">
                    Revenue Model — select all that apply
                  </legend>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.values(RevenueModel).map((value) => (
                      <label
                        key={value}
                        className="flex gap-2 items-center rounded-md border p-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={field.value.includes(value)}
                          onBlur={field.onBlur}
                          onChange={(event) =>
                            field.onChange(
                              event.target.checked
                                ? [...field.value, value]
                                : field.value.filter((item) => item !== value),
                            )
                          }
                        />
                        {productLabel(value)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <FormMessage />
              </FormItem>
            )}
          />
          {select("currency", "Currency", currencies)}
          {textField("primaryDomain", "Primary Domain")}
          <p className="text-sm text-muted-foreground">
            Enter a domain such as example.com; https:// is not required.
          </p>
          <FormField
            control={form.control}
            name="additionalDomains"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Additional Domains (comma separated)</FormLabel>
                <FormControl>
                  <Input
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={domainsText}
                    onChange={(event) => {
                      setDomainsText(event.target.value);
                      field.onChange(
                        event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      );
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b pb-2">
            Launch & Validation
          </h3>
          {textField("plannedLaunchDate", "Planned Launch Date", false, "date")}
          {textField("actualLaunchDate", "Actual Launch Date", false, "date")}
          {textField("launchHypothesis", "Purpose / Hypothesis", true)}
          {textField("successMeasures", "Success Measures", true)}
          {select(
            "operatingMode",
            "Operating Mode",
            Object.values(OperatingMode),
          )}
          <p className="text-sm text-muted-foreground">
            Active: investing in growth or development. Maintain: routine
            upkeep. Listen: monitoring demand with little or no active
            investment. This is separate from lifecycle status.
          </p>
        </section>
        <section className="space-y-4">
          <h3 className="text-lg font-semibold border-b pb-2">Internal</h3>
          {textField("internalNotes", "Internal Notes", true)}
        </section>
        <div className="flex justify-end pt-4 border-t">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initialData ? "Save Changes" : "Create Product"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
