CREATE TABLE collection_forms (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 title text NOT NULL, profession text NOT NULL, description text NOT NULL DEFAULT '',
 fields jsonb NOT NULL, active boolean NOT NULL DEFAULT false, closes_at timestamptz,
 public_key text NOT NULL UNIQUE, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE TABLE collection_submissions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, form_id uuid NOT NULL,
 definition jsonb NOT NULL, values jsonb NOT NULL, assets jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 person_id uuid, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,form_id) REFERENCES collection_forms(organization_id,id),
 FOREIGN KEY(organization_id,person_id) REFERENCES people(organization_id,id), UNIQUE(organization_id,id)
);
CREATE INDEX collection_inbox ON collection_submissions(organization_id,form_id,status,created_at DESC);
ALTER TABLE assets ADD COLUMN collection_private boolean NOT NULL DEFAULT false;
CREATE POLICY collection_privacy ON assets AS RESTRICTIVE FOR SELECT USING (
 NOT collection_private OR EXISTS (
  SELECT 1 FROM users u WHERE u.id=nullif(current_setting('app.actor_id',true),'')::uuid
  AND NOT u.disabled AND NOT u.must_change_password AND (u.super_admin OR EXISTS (
   SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.organization_id=assets.organization_id AND m.role='ORG_ADMIN'
  ))
 )
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['collection_forms','collection_submissions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id=nullif(current_setting(''app.org_id'',true),'''')::uuid) WITH CHECK (organization_id=nullif(current_setting(''app.org_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
