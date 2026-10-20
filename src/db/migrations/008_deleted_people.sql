ALTER TABLE people ADD COLUMN deleted_at timestamptz;
CREATE INDEX people_current_directory ON people(organization_id,name,id) WHERE deleted_at IS NULL;
