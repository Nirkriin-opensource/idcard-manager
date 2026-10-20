CREATE TABLE purge_requests (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('audit','renders','jobs')), before_date timestamptz NOT NULL,
 manifest jsonb NOT NULL, summary jsonb NOT NULL, status text NOT NULL DEFAULT 'PREVIEW' CHECK(status IN ('PREVIEW','RUNNING','COMPLETED')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', completed_at timestamptz,
 UNIQUE(organization_id,id)
);
CREATE TABLE purge_files (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, request_id uuid NOT NULL, storage_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,request_id) REFERENCES purge_requests(organization_id,id), UNIQUE(organization_id,storage_key)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['purge_requests','purge_files'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id=nullif(current_setting(''app.org_id'',true),'''')::uuid) WITH CHECK (organization_id=nullif(current_setting(''app.org_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE FUNCTION retention_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request purge_requests; actor uuid; BEGIN
 IF TG_OP <> 'DELETE' THEN RAISE EXCEPTION 'History records are immutable'; END IF;
 IF TG_TABLE_NAME='audit_events' AND to_jsonb(OLD)->>'action'='retention.purge' THEN RAISE EXCEPTION 'Purge receipts are immutable'; END IF;
 actor=nullif(current_setting('app.actor_id',true),'')::uuid;
 SELECT * INTO request FROM purge_requests WHERE id=nullif(current_setting('app.purge_request',true),'')::uuid
 AND organization_id=OLD.organization_id AND actor_id=actor AND status='RUNNING' AND expires_at>now()
 AND kind=CASE WHEN TG_TABLE_NAME='audit_events' THEN 'audit' ELSE 'renders' END AND manifest->'ids' ? OLD.id::text;
 IF request.id IS NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=actor AND NOT u.disabled AND NOT u.must_change_password AND
 (u.super_admin OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id=OLD.organization_id AND m.role='ORG_ADMIN')))
 THEN RAISE EXCEPTION 'History records are immutable; use an authorized purge preview'; END IF;
 RETURN OLD;
END $$;
DROP TRIGGER immutable_card_renders ON card_renders;
CREATE TRIGGER immutable_card_renders BEFORE UPDATE OR DELETE ON card_renders FOR EACH ROW EXECUTE FUNCTION retention_delete_guard();
DROP TRIGGER immutable_audit ON audit_events;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION retention_delete_guard();
CREATE FUNCTION protect_purge_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='COMPLETED' THEN RAISE EXCEPTION 'Purge receipts are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_purge_receipt BEFORE UPDATE OR DELETE ON purge_requests FOR EACH ROW EXECUTE FUNCTION protect_purge_receipt();
CREATE INDEX purge_recent ON purge_requests(organization_id,created_at DESC);
