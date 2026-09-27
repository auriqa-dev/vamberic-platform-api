import { OpportunityHighlights } from "../../components/portfolio-panels";
import { productLabel } from "../../lib/product-labels";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProduct,
  useListOpportunities,
  useCreateProduct,
  useUpdateProduct,
  getGetProductQueryKey,
  getListProductsQueryKey,
  getGetDashboardSummaryQueryKey,
  type ProductInput,
  type ProductUpdate,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ProductForm } from "@/components/product-form";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProductDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isNew = !params.id || params.id === "new";
  const id = isNew ? "" : params.id!;

  const {
    data: product,
    isLoading,
    isError,
  } = useGetProduct(id, {
    query: {
      enabled: !isNew,
      queryKey: getGetProductQueryKey(id),
    },
  });

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (data: ProductUpdate) => {
    if (isNew) {
      createMutation.mutate(
        { data: data as ProductInput },
        {
          onSuccess: (newProduct) => {
            toast({
              title: "Product created",
              description: `${newProduct.name} has been successfully created.`,
            });
            queryClient.invalidateQueries({
              queryKey: getListProductsQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetDashboardSummaryQueryKey(),
            });
            setLocation(`/products/${newProduct.id}`);
          },
          onError: (err) => {
            toast({
              title: "Error creating product",
              description: err.message || "An unexpected error occurred.",
              variant: "destructive",
            });
          },
        },
      );
    } else {
      updateMutation.mutate(
        { id, data },
        {
          onSuccess: (updatedProduct) => {
            toast({
              title: "Product updated",
              description: "Changes have been saved successfully.",
            });
            queryClient.setQueryData(getGetProductQueryKey(id), updatedProduct);
            queryClient.invalidateQueries({
              queryKey: getListProductsQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetDashboardSummaryQueryKey(),
            });
          },
          onError: (err) => {
            toast({
              title: "Error updating product",
              description: err.message || "An unexpected error occurred.",
              variant: "destructive",
            });
          },
        },
      );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/products")}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {isNew ? "Create Product" : product?.name || "Edit Product"}
          </h1>
          {!isNew && product && (
            <p className="text-muted-foreground font-mono text-sm mt-1">
              {product.id}
            </p>
          )}
        </div>
      </div>

      {!isNew && product && !isError && (
        <>
          <p className="text-sm text-muted-foreground">
            {productLabel(product.lifecycleStatus)} ·{" "}
            {productLabel(product.operatingMode)} ·{" "}
            {productLabel(product.businessModel)}
          </p>
          <ProductPortfolioContext productId={product.id} name={product.name} />
        </>
      )}
      <div className="bg-card p-6 md:p-8 rounded-xl border border-border shadow-sm">
        {isLoading && !isNew ? (
          <div className="space-y-8">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : isError ? (
          <div className="text-center py-12 text-destructive">
            Failed to load product. It may be unavailable or the API could not
            be reached.
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-6">
              {isNew ? "Product details" : "Edit Product details"}
            </h2>
            <ProductForm
              key={id || "new"}
              initialData={product}
              onSubmit={handleSubmit}
              isPending={isPending}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ProductPortfolioContext({
  productId,
  name,
}: {
  productId: string;
  name: string;
}) {
  const q = useListOpportunities({ productId, limit: 5, offset: 0 });
  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex justify-between gap-3">
        <h2 className="text-lg font-semibold">Opportunities for {name}</h2>
        <Link
          className="text-primary text-sm hover:underline"
          href={`/opportunities?productId=${encodeURIComponent(productId)}`}
        >
          View all
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        The five most recent opportunities and their linked people and
        organisations.
      </p>
      {q.isError ? (
        <p role="alert">
          Could not load opportunities.{" "}
          <button
            className="text-primary underline"
            onClick={() => void q.refetch()}
          >
            Try again
          </button>
        </p>
      ) : q.data ? (
        <OpportunityHighlights
          opportunities={q.data.items}
          productName={name}
        />
      ) : (
        <p role="status">Loading opportunities…</p>
      )}
    </section>
  );
}
