ALTER TABLE organizations ADD COLUMN appearance jsonb NOT NULL DEFAULT '{}';
ALTER TABLE generation_jobs ADD COLUMN style_snapshot jsonb;
CREATE TABLE app_branding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  name text NOT NULL DEFAULT 'iD card',
  organization_id uuid,
  logo_asset_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,logo_asset_id) REFERENCES assets(organization_id,id),
  CHECK ((organization_id IS NULL) = (logo_asset_id IS NULL))
);
INSERT INTO app_branding(singleton) VALUES(true);
