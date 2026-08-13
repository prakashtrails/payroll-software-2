// listUsers({ perPage: 1000 }) only returns page 1 — past 1000 total platform
// auth users, an existing account silently stops being found. This pages
// through until the email is found or results run out.
export async function findUserByEmail(
  adminClient: { auth: { admin: { listUsers: (opts: { page: number; perPage: number }) => Promise<{ data: { users: { id: string; email?: string }[] } | null; error: { message: string } | null }> } } },
  email: string,
) {
  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) return null;
  }
}
