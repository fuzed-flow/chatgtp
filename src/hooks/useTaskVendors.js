import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { VENDOR_CATEGORIES } from "@/lib/vendorCategories";
import { toast } from "sonner";

const VENDOR_MANAGEMENT_ROLES = ["owner", "admin", "manager", "office", "office_admin", "project_manager"];

export function useTaskVendors({ companyId, role }) {
  const queryClient = useQueryClient();
  const canCreateVendor = VENDOR_MANAGEMENT_ROLES.includes(role);

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, name, category")
        .eq("company_id", companyId)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const createVendorMutation = useMutation({
    mutationFn: async ({ name, category }) => {
      if (!canCreateVendor) throw new Error("You do not have permission to add vendors.");
      const safeName = name?.trim();
      if (!safeName) throw new Error("Enter the subcontractor or vendor name.");
      const safeCategory = VENDOR_CATEGORIES.includes(category) ? category : "Other";
      const { data, error } = await supabase
        .from("vendors")
        .insert([{ company_id: companyId, name: safeName, category: safeCategory }])
        .select("id, name, category")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (vendor) => {
      queryClient.setQueryData(["vendors", companyId], current => {
        const rows = Array.isArray(current) ? current : [];
        if (rows.some(item => item.id === vendor.id)) return rows;
        return [...rows, vendor].sort((left, right) => (left.name || "").localeCompare(right.name || ""));
      });
      queryClient.invalidateQueries({ queryKey: ["vendors", companyId] });
      toast.success("Subcontractor added and selected");
    },
  });

  return {
    vendors,
    canCreateVendor,
    createVendor: createVendorMutation.mutateAsync,
    isCreatingVendor: createVendorMutation.isPending,
  };
}
