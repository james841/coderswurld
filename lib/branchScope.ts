/**
 * Which branch a user is held to on reports and exports.
 *
 * Every user row carries a home branch, owners included, so "has a branch"
 * does not mean "may only see that branch". Main admins and sub-admins see
 * the whole business; everyone else stays on their own branch when they have one.
 */
const ORG_WIDE = new Set(["MAIN_ADMIN", "SUB_ADMIN"]);

export function pinnedBranch<B>(session: { user: { role: string }; branch: B | null }): B | null {
  return ORG_WIDE.has(session.user.role) ? null : session.branch;
}
