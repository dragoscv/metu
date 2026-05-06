/** Vercel — read deployments for a team or user (analytics ingestion). */
export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  createdAt: number;
}

export async function listDeployments(token: string, teamId?: string): Promise<VercelDeployment[]> {
  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('limit', '20');
  if (teamId) url.searchParams.set('teamId', teamId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Vercel API ${res.status}`);
  const json = (await res.json()) as { deployments: VercelDeployment[] };
  return json.deployments;
}
