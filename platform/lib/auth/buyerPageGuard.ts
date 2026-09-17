import { redirect } from "next/navigation";
import { getCurrentBuyer, type AuthedBuyer } from "./buyerSession";

/** Server-side guard for member (buyer) pages — the page-level counterpart to lib/auth/buyerActor.ts's API-route guard. */
export async function requireBuyerPageUser(): Promise<AuthedBuyer> {
  const buyer = await getCurrentBuyer();
  if (!buyer) redirect("/member/login");
  return buyer;
}
