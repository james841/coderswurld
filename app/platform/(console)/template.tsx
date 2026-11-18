import { PageTransition } from "@/components/motion";

/** The same soft arrival as the shop's back office, on every console page. */
export default function PlatformTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
