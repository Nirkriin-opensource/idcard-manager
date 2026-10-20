import PublicCollection from "../../../../components/PublicCollection";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Submit ID card details",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ org: string; token: string }>;
}) {
  const { org, token } = await params;
  return <PublicCollection org={org} token={token} />;
}
