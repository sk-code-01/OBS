import { clickhouse } from "./client";

function slugifyProject(email: string, projectId: string): string {
  const local = email.split("@")[0] ?? "workspace";
  const safe = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `${safe || "workspace"}-${projectId.slice(0, 6)}`;
}

export async function createProject(projectId: string, email: string): Promise<void> {
  const local = email.split("@")[0] ?? "workspace";
  await clickhouse.insert({
    table: "projects",
    values: [
      {
        id: projectId,
        slug: slugifyProject(email, projectId),
        name: `${local}'s project`,
        created_at: new Date().toISOString(),
        deleted_at: null,
      },
    ],
    format: "JSONEachRow",
  });
}
