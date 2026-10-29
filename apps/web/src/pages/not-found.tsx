import { Link } from "react-router";
import { Page } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <Page>
      <div className="mx-auto max-w-xl py-16">
        <h1 className="text-2xl font-bold">There's no page here</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Check the address, or start from a new audit.</p>
        <Button asChild className="mt-6">
          <Link to="/">New audit</Link>
        </Button>
      </div>
    </Page>
  );
}
