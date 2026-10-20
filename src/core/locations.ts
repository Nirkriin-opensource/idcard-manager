import type pg from "pg";
export async function locationFields(
  c: pg.PoolClient,
  org: string,
  personId: string,
) {
  const s = (
    await c.query(
      "SELECT location_enabled FROM organization_settings WHERE organization_id=$1",
      [org],
    )
  ).rows[0];
  if (!s?.location_enabled)
    return {
      "location.enabled": false,
      "location.address": "",
      "location.url": "",
      "location.map_asset_id": "",
    };
  const l = (
    await c.query(
      "SELECT * FROM locations l WHERE l.organization_id=$1 AND (unit_id IS NULL OR EXISTS(SELECT 1 FROM person_units pu WHERE pu.person_id=$2 AND pu.unit_id=l.unit_id)) ORDER BY (unit_id IS NULL),id LIMIT 1",
      [org, personId],
    )
  ).rows[0];
  return {
    "location.enabled": true,
    "location.address": l?.address || "",
    "location.url": l
      ? `https://www.openstreetmap.org/?mlat=${l.latitude}&mlon=${l.longitude}#map=16/${l.latitude}/${l.longitude}`
      : "",
    "location.map_asset_id": l?.map_asset_id || "",
  };
}
