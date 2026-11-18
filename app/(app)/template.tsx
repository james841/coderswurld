import { PageTransition } from "@/components/motion";

/**
 * A template re-mounts on every navigation (a layout does not), which is what
 * lets each back-office page make the same short, soft arrival. The side menu
 * and top bar live in the layout above and stay perfectly still — only the
 * content that actually changed moves.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
