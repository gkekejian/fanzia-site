import { requireOwnerPageUser } from "@/lib/auth/pageGuard";
import { AdminNav } from "@/components/AdminNav";
import { ProductsConsole } from "@/components/admin/ProductsConsole";

export default async function ProductsPage() {
  const user = await requireOwnerPageUser();
  return (
    <>
      <AdminNav userName={user.name} />
      <ProductsConsole />
    </>
  );
}
