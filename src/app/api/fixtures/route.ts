import { listFixtures } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

/** Agent definitions available to the generator. Dropping a new JSON file in
 *  /fixtures makes it appear here — no code changes. */
export async function GET() {
  const fixtures = await listFixtures();
  return Response.json({
    fixtures: fixtures.map((f) => ({
      id: f.id,
      name: f.name,
      sampleInputs: f.sampleInputs,
      hasMockResult: Boolean(f.mockResult),
      toolCount: f.definition.tools.length,
    })),
  });
}
