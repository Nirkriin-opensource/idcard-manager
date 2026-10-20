import { handle } from "../../../core/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handle(req, (await context.params).path);
}
export { route as GET, route as POST, route as PUT, route as DELETE };
