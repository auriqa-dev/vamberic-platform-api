import { z } from "zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Product, ProductInput } from "@workspace/api-client-react";
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

const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  slug: z
    .string()
    .min(2, "Slug is required")
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Lowercase letters, numbers, and hyphens only",
    ),
  description: z.string().max(10000).optional(),
  status: z.enum(["idea", "validation", "active", "paused", "retired"]),
  productType: z.string().trim().min(1, "Product type is required").max(100),
  domains: z.array(z.string().trim().min(1).max(253)).max(50).optional(),
  commercialModel: z
    .string()
    .trim()
    .min(1, "Commercial model is required")
    .max(100),
  oneOffPurchaseAvailable: z.boolean().optional(),
  subscriptionAvailable: z.boolean().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "Must be 3-letter currency code (e.g. USD)")
    .optional()
    .or(z.literal("")),
  internalNotes: z.string().max(20000).optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormProps {
  initialData?: Product;
  onSubmit: (data: ProductInput) => void;
  isPending: boolean;
}

export function ProductForm({
  initialData,
  onSubmit,
  isPending,
}: ProductFormProps) {
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: initialData?.name || "",
      slug: initialData?.slug || "",
      description: initialData?.description || "",
      status: initialData?.status || "idea",
      productType: initialData?.productType || "software",
      domains: initialData?.domains || [],
      commercialModel: initialData?.commercialModel || "freemium",
      oneOffPurchaseAvailable: initialData?.oneOffPurchaseAvailable || false,
      subscriptionAvailable: initialData?.subscriptionAvailable || false,
      currency: initialData?.currency || "USD",
      internalNotes: initialData?.internalNotes || "",
    },
  });

  // Keep the text intact while typing; the form stores the parsed domain list.
  const [domainsText, setDomainsText] = useState(
    initialData?.domains.join(", ") || "",
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => {
          const submitData = { ...data };
          if (submitData.currency === "") submitData.currency = undefined;
          onSubmit(submitData);
        })}
        className="space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <h3 className="text-lg font-semibold border-b pb-2">Basic Info</h3>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Vamberic Cloud" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. vamberic-cloud" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Brief overview of the product..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <FormControl>
                    <select
                      className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      {...field}
                    >
                      <option value="idea">Idea</option>
                      <option value="validation">Validation</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="retired">Retired</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="space-y-6">
            <h3 className="text-lg font-semibold border-b pb-2">
              Commercial & Technical
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="productType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <FormControl>
                      <Input placeholder="software, hardware..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="commercialModel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <Input placeholder="freemium, enterprise..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="domains"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Domains (Comma separated)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="vamberic.com, app.vamberic.com"
                      value={domainsText}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDomainsText(val);
                        field.onChange(
                          val
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        );
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-4">
              <FormField
                control={form.control}
                name="oneOffPurchaseAvailable"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 w-full">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>One-off Purchase</FormLabel>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="subscriptionAvailable"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 w-full">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Subscription</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency Code</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="USD, EUR, GBP..."
                      maxLength={3}
                      className="uppercase"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-lg font-semibold border-b pb-2">Internal</h3>
          <FormField
            control={form.control}
            name="internalNotes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Internal Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Private notes for the team..."
                    className="min-h-[100px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

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
