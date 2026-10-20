ALTER TABLE assets ADD COLUMN deleted_at timestamptz;
CREATE INDEX assets_current_uploads ON assets(organization_id,created_at DESC) WHERE deleted_at IS NULL;
