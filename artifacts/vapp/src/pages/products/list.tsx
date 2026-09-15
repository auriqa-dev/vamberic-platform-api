import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListProducts,
  type ProductStatus,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ProductStatusBadge } from "@/components/product-status-badge";
import { Search, Plus, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProductsList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductStatus | undefined>();

  // Use a simple timeout for debounce
  // Note: in a real app we'd use useDebounce from a hook library
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    data: products,
    isLoading,
    isError,
  } = useListProducts({
    search: debouncedSearch || undefined,
    status: statusFilter,
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Products
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage software and physical products.
          </p>
        </div>
        <Button onClick={() => setLocation("/products/new")}>
          <Plus className="w-4 h-4 mr-2" />
          Create Product
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="flex h-9 w-full sm:w-48 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          value={statusFilter || ""}
          onChange={(e) =>
            setStatusFilter((e.target.value as ProductStatus) || undefined)
          }
        >
          <option value="">All Statuses</option>
          <option value="idea">Idea</option>
          <option value="validation">Validation</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="retired">Retired</option>
        </select>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <div className="flex items-center justify-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" />
                    Loading products...
                  </div>
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-destructive"
                >
                  Error loading products.
                </TableCell>
              </TableRow>
            ) : products?.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-32 text-center text-muted-foreground"
                >
                  No products found matching your criteria.
                </TableCell>
              </TableRow>
            ) : (
              products?.map((product) => (
                <TableRow
                  key={product.id}
                  className="group cursor-pointer hover:bg-muted/30"
                  onClick={() => setLocation(`/products/${product.id}`)}
                >
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {product.name}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {product.slug}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="capitalize text-sm">
                      {product.productType}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="capitalize text-sm">
                      {product.commercialModel}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation(`/products/${product.id}`);
                      }}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
