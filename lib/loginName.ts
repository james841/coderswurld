/** "  Blessing   OKAFOR " -> "blessing okafor": how a name is matched at sign-in. */
export function toLoginName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
