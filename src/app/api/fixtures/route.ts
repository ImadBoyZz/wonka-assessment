import { listFixtures } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

/** Agent definitions available to the generator. A new JSON file in /fixtures
 *  appears here automatically. */
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
