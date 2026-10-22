import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <Container className="grid gap-6 py-16" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-16 w-full max-w-3xl" />
      <Skeleton className="h-24 w-full max-w-2xl" />
    </Container>
  );
}
